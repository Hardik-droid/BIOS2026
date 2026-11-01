//go:build compute_experiment

package computeexp

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/base64"
	"errors"
	"io"
	"math/big"
	"net"
	"os"
	"strings"
	"time"
)

const computeALPN = "localfirst-compute-v1"
const computeInvitationPrefix = "LFC1-"
const computeAuthTimeout = 15 * time.Second

// Identity is an ephemeral compute-only invitation. Its bearer secret grants
// session authentication; authorization to run a job is a separate decision.
type Identity struct {
	Certificate tls.Certificate
	Secret      []byte
	Invitation  string
	Expires     time.Time
}

// NewIdentity creates a fresh certificate, certificate pin, and 256-bit bearer.
// No identity, private key, or bearer is persisted by this package.
func NewIdentity() (Identity, error) {
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return Identity{}, errors.New("Could not create compute identity.")
	}
	serial, err := rand.Int(rand.Reader, new(big.Int).Lsh(big.NewInt(1), 128))
	if err != nil {
		return Identity{}, errors.New("Could not create compute identity.")
	}
	if serial.Sign() == 0 {
		serial.SetInt64(1)
	}
	now := time.Now().UTC().Truncate(time.Second)
	expires := now.Add(10 * time.Minute)
	template := &x509.Certificate{
		SerialNumber: serial,
		Subject:      pkix.Name{CommonName: "LocalFirst experimental compute"},
		NotBefore:    now.Add(-time.Minute),
		NotAfter:     expires,
		KeyUsage:     x509.KeyUsageDigitalSignature,
		ExtKeyUsage:  []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
	}
	der, err := x509.CreateCertificate(rand.Reader, template, template, &key.PublicKey, key)
	if err != nil {
		return Identity{}, errors.New("Could not create compute identity.")
	}
	leaf, err := x509.ParseCertificate(der)
	if err != nil {
		return Identity{}, errors.New("Could not create compute identity.")
	}
	secret := make([]byte, 32)
	if _, err := rand.Read(secret); err != nil {
		return Identity{}, errors.New("Could not create compute identity.")
	}
	pin := sha256.Sum256(der)
	var invitation [64]byte
	copy(invitation[:32], pin[:])
	copy(invitation[32:], secret)
	return Identity{
		Certificate: tls.Certificate{Certificate: [][]byte{der}, PrivateKey: key, Leaf: leaf},
		Secret:      secret,
		Invitation:  computeInvitationPrefix + base64.RawURLEncoding.EncodeToString(invitation[:]),
		Expires:     expires,
	}, nil
}

func parseComputeInvitation(invitation string) (pin, secret [32]byte, err error) {
	if len(invitation) != len(computeInvitationPrefix)+base64.RawURLEncoding.EncodedLen(64) || !strings.HasPrefix(invitation, computeInvitationPrefix) {
		return pin, secret, errors.New("Invalid compute invitation.")
	}
	encoded := invitation[len(computeInvitationPrefix):]
	data, decodeErr := base64.RawURLEncoding.Strict().DecodeString(encoded)
	if decodeErr != nil || len(data) != 64 || base64.RawURLEncoding.EncodeToString(data) != encoded {
		return pin, secret, errors.New("Invalid compute invitation.")
	}
	copy(pin[:], data[:32])
	copy(secret[:], data[32:])
	return pin, secret, nil
}

func computeClientTLSConfig(pin [32]byte) *tls.Config {
	return &tls.Config{
		MinVersion: tls.VersionTLS13,
		MaxVersion: tls.VersionTLS13,
		NextProtos: []string{computeALPN},
		// Offline identities are self-signed. Exact certificate pin verification
		// below replaces public-CA and DNS verification; there is no fallback.
		InsecureSkipVerify: true,
		VerifyConnection: func(state tls.ConnectionState) error {
			if state.Version != tls.VersionTLS13 || state.NegotiatedProtocol != computeALPN || len(state.PeerCertificates) != 1 {
				return errors.New("Invalid compute TLS identity.")
			}
			certificate := state.PeerCertificates[0]
			now := time.Now()
			if now.Before(certificate.NotBefore) || !now.Before(certificate.NotAfter) {
				return errors.New("Compute invitation expired or is not yet valid.")
			}
			actual := sha256.Sum256(certificate.Raw)
			if subtle.ConstantTimeCompare(actual[:], pin[:]) != 1 {
				return errors.New("Invalid compute TLS identity.")
			}
			return nil
		},
	}
}

func computeDeadline(ctx context.Context, started, expires time.Time) time.Time {
	deadline := started.Add(computeAuthTimeout)
	if limit, ok := ctx.Deadline(); ok && limit.Before(deadline) {
		deadline = limit
	}
	if !expires.IsZero() && expires.Before(deadline) {
		deadline = expires
	}
	return deadline
}

func computeSecureError(ctx context.Context, err error) error {
	if contextErr := ctx.Err(); contextErr != nil {
		return contextErr
	}
	var timeout net.Error
	if errors.As(err, &timeout) && timeout.Timeout() {
		return os.ErrDeadlineExceeded
	}
	// Never expose certificate contents, invitation bytes, or peer data in errors.
	return errors.New("Compute session authentication failed.")
}

// AcceptSecure authenticates a compute client over an already connected stream.
// It closes raw on every failure. After success the caller owns cancellation and
// must close the returned connection (or raw) to interrupt subsequent work.
func AcceptSecure(ctx context.Context, raw net.Conn, id Identity) (net.Conn, error) {
	if raw == nil {
		return nil, errors.New("Compute transport is unavailable.")
	}
	success := false
	defer func() {
		if !success {
			_ = raw.Close()
		}
	}()
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if id.Expires.IsZero() || !time.Now().Before(id.Expires) {
		return nil, errors.New("Compute invitation expired.")
	}
	if len(id.Secret) != 32 || len(id.Certificate.Certificate) != 1 || id.Certificate.PrivateKey == nil {
		return nil, errors.New("Invalid compute identity.")
	}
	deadline := computeDeadline(ctx, time.Now(), id.Expires)
	if err := raw.SetDeadline(deadline); err != nil {
		return nil, computeSecureError(ctx, err)
	}
	secured := tls.Server(raw, &tls.Config{
		Certificates:           []tls.Certificate{id.Certificate},
		MinVersion:             tls.VersionTLS13,
		MaxVersion:             tls.VersionTLS13,
		NextProtos:             []string{computeALPN},
		SessionTicketsDisabled: true,
	})
	if err := secured.HandshakeContext(ctx); err != nil {
		return nil, computeSecureError(ctx, err)
	}
	state := secured.ConnectionState()
	if state.Version != tls.VersionTLS13 || state.NegotiatedProtocol != computeALPN || !time.Now().Before(id.Expires) {
		return nil, errors.New("Compute session authentication failed.")
	}
	var secret [32]byte
	if _, err := io.ReadFull(secured, secret[:]); err != nil {
		return nil, computeSecureError(ctx, err)
	}
	if subtle.ConstantTimeCompare(secret[:], id.Secret) != 1 || !time.Now().Before(id.Expires) {
		return nil, errors.New("Compute session authentication failed.")
	}
	if err := writeComputeBytes(secured, []byte{1}); err != nil {
		return nil, computeSecureError(ctx, err)
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if !time.Now().Before(id.Expires) {
		return nil, errors.New("Compute invitation expired.")
	}
	if err := raw.SetDeadline(time.Time{}); err != nil {
		return nil, computeSecureError(ctx, err)
	}
	success = true
	return secured, nil
}

// DialSecure verifies the exact pinned compute identity before sending the
// bearer. Its handshake and bearer exchange share one absolute deadline. A
// context without a deadline should be paired with caller-driven raw.Close for
// prompt cancellation during the bearer exchange; no watcher is started here.
func DialSecure(ctx context.Context, raw net.Conn, invitation string) (net.Conn, error) {
	if raw == nil {
		return nil, errors.New("Compute transport is unavailable.")
	}
	success := false
	defer func() {
		if !success {
			_ = raw.Close()
		}
	}()
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	pin, secret, err := parseComputeInvitation(invitation)
	if err != nil {
		return nil, err
	}
	started := time.Now()
	if err := raw.SetDeadline(computeDeadline(ctx, started, time.Time{})); err != nil {
		return nil, computeSecureError(ctx, err)
	}
	secured := tls.Client(raw, computeClientTLSConfig(pin))
	if err := secured.HandshakeContext(ctx); err != nil {
		return nil, computeSecureError(ctx, err)
	}
	state := secured.ConnectionState()
	if state.Version != tls.VersionTLS13 || state.NegotiatedProtocol != computeALPN || len(state.PeerCertificates) != 1 {
		return nil, errors.New("Compute session authentication failed.")
	}
	expires := state.PeerCertificates[0].NotAfter
	if err := raw.SetDeadline(computeDeadline(ctx, started, expires)); err != nil {
		return nil, computeSecureError(ctx, err)
	}
	if err := writeComputeBytes(secured, secret[:]); err != nil {
		return nil, computeSecureError(ctx, err)
	}
	var acknowledgement [1]byte
	if _, err := io.ReadFull(secured, acknowledgement[:]); err != nil {
		return nil, computeSecureError(ctx, err)
	}
	if acknowledgement[0] != 1 || !time.Now().Before(expires) {
		return nil, errors.New("Compute session authentication failed.")
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if err := raw.SetDeadline(time.Time{}); err != nil {
		return nil, computeSecureError(ctx, err)
	}
	success = true
	return secured, nil
}
