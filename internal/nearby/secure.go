package nearby

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"errors"
	"io"
	"math/big"
	"strings"
	"time"
)

const MaxFrame = 2 * 1024 * 1024

type Document struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}
type packet struct {
	Type     string          `json:"type"`
	Secret   string          `json:"secret,omitempty"`
	Document *Document       `json:"document,omitempty"`
	Session  string          `json:"session,omitempty"`
	Message  json.RawMessage `json:"message,omitempty"`
}

func makeIdentity() (tls.Certificate, []byte, string, error) {
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return tls.Certificate{}, nil, "", err
	}
	serial, err := rand.Int(rand.Reader, new(big.Int).Lsh(big.NewInt(1), 128))
	if err != nil {
		return tls.Certificate{}, nil, "", err
	}
	template := &x509.Certificate{SerialNumber: serial, Subject: pkix.Name{CommonName: "Diwan Bluetooth session"}, NotBefore: time.Now().Add(-time.Minute), NotAfter: time.Now().Add(24 * time.Hour), KeyUsage: x509.KeyUsageDigitalSignature, ExtKeyUsage: []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth}}
	der, err := x509.CreateCertificate(rand.Reader, template, template, &key.PublicKey, key)
	if err != nil {
		return tls.Certificate{}, nil, "", err
	}
	pin := sha256.Sum256(der)
	secret := make([]byte, 32)
	if _, err := rand.Read(secret); err != nil {
		return tls.Certificate{}, nil, "", err
	}
	invitation := "DBT1-" + base64.RawURLEncoding.EncodeToString(append(pin[:], secret...))
	return tls.Certificate{Certificate: [][]byte{der}, PrivateKey: key}, secret, invitation, nil
}
func clientIdentity(invitation string) (*tls.Config, string, error) {
	if !strings.HasPrefix(invitation, "DBT1-") {
		return nil, "", errors.New("Paste the complete DBT1 invitation from the hosting laptop.")
	}
	data, err := base64.RawURLEncoding.DecodeString(strings.TrimPrefix(invitation, "DBT1-"))
	if err != nil || len(data) != 64 {
		return nil, "", errors.New("The Bluetooth invitation is incomplete or invalid.")
	}
	pin := append([]byte(nil), data[:32]...)
	config := &tls.Config{MinVersion: tls.VersionTLS13, InsecureSkipVerify: true, // The invitation pins the exact self-signed certificate below.
		VerifyConnection: func(state tls.ConnectionState) error {
			if len(state.PeerCertificates) != 1 {
				return errors.New("Unexpected Bluetooth certificate.")
			}
			actual := sha256.Sum256(state.PeerCertificates[0].Raw)
			if subtle.ConstantTimeCompare(actual[:], pin) != 1 {
				return errors.New("Bluetooth identity does not match this invitation.")
			}
			return nil
		},
	}
	return config, base64.RawURLEncoding.EncodeToString(data[32:]), nil
}
func writePacket(writer io.Writer, message packet) error {
	data, err := json.Marshal(message)
	if err != nil {
		return err
	}
	if len(data) == 0 || len(data) > MaxFrame {
		return errors.New("Bluetooth message exceeds the supported size.")
	}
	buffer := make([]byte, 4+len(data))
	binary.BigEndian.PutUint32(buffer, uint32(len(data)))
	copy(buffer[4:], data)
	for len(buffer) > 0 {
		n, err := writer.Write(buffer)
		if err != nil {
			return err
		}
		if n == 0 {
			return io.ErrShortWrite
		}
		buffer = buffer[n:]
	}
	return nil
}
func readPacket(reader io.Reader) (packet, error) {
	var header [4]byte
	if _, err := io.ReadFull(reader, header[:]); err != nil {
		return packet{}, err
	}
	size := binary.BigEndian.Uint32(header[:])
	if size == 0 || size > MaxFrame {
		return packet{}, errors.New("Invalid Bluetooth frame length.")
	}
	data := make([]byte, size)
	if _, err := io.ReadFull(reader, data); err != nil {
		return packet{}, err
	}
	var message packet
	if err := json.Unmarshal(data, &message); err != nil {
		return packet{}, errors.New("Invalid Bluetooth message.")
	}
	return message, nil
}
