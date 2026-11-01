//go:build relay_experiment

package nearby

import (
	"context"
	"encoding/base64"
	"errors"
	"io"
	"net"
	"strings"
	"time"
)

// NewRelayedHub is included only with the explicit relay_experiment build tag.
// Its document TLS authentication is the same as direct sharing. Only the raw
// dial path changes; relayCode is a distinct admission secret, never DBT1.
func NewRelayedHub(relayCode string) (*Hub, error) {
	return newRelayedHub(relayCode, dialExperimentalRelay)
}

// The private dial seam permits protocol-only tests over loopback streams.
// Normal experimental builds always supply the native Bluetooth dial above.
func newRelayedHub(relayCode string, dial func(context.Context, string) (net.Conn, error)) (*Hub, error) {
	token, err := parseRelayCode(relayCode)
	if err != nil {
		return nil, err
	}
	hub := NewHub()
	hub.allowShortPairing = false // Windows pairing proves the relay hop, not the remote document endpoint.
	hub.dial = func(ctx context.Context, address string) (net.Conn, error) {
		raw, err := dial(ctx, address)
		if err != nil {
			return nil, err
		}
		if err := admitRelay(ctx, raw, token); err != nil {
			raw.Close()
			return nil, err
		}
		return raw, nil
	}
	return hub, nil
}

func parseRelayCode(code string) ([]byte, error) {
	code = strings.TrimSpace(code)
	if len(code) != 48 || !strings.HasPrefix(code, "DRL1-") {
		return nil, errors.New("Enter the DRL1 relay access code from the incoming relay phone, not a document invitation.")
	}
	token, err := base64.RawURLEncoding.Strict().DecodeString(code[5:])
	if err != nil || len(token) != 32 {
		return nil, errors.New("Invalid relay access code.")
	}
	return token, nil
}

func admitRelay(ctx context.Context, raw net.Conn, token []byte) error {
	if len(token) != 32 {
		return errors.New("Invalid relay access policy.")
	}
	deadline := time.Now().Add(12 * time.Second)
	if prior, ok := ctx.Deadline(); ok && prior.Before(deadline) {
		deadline = prior
	}
	if err := raw.SetDeadline(deadline); err != nil {
		return err
	}
	stop := context.AfterFunc(ctx, func() { raw.Close() })
	defer stop()
	if err := ctx.Err(); err != nil {
		return err
	}
	header := append([]byte("DRL1"), token...)
	defer clear(header)
	for len(header) > 0 {
		n, err := raw.Write(header)
		if err != nil {
			return errors.New("Relay admission failed.")
		}
		if n == 0 {
			return io.ErrShortWrite
		}
		header = header[n:]
	}
	var ready [1]byte
	if _, err := io.ReadFull(raw, ready[:]); err != nil || ready[0] != 1 {
		return errors.New("The relay did not establish its outgoing link.")
	}
	return raw.SetDeadline(time.Time{})
}
