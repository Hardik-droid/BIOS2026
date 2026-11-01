//go:build compute_experiment

package computeexp

import (
	"bytes"
	"encoding/binary"
	"encoding/json"
	"errors"
	"io"
	"net"
	"strings"
	"sync"
	"testing"
	"time"
)

type shortComputeWriteConn struct {
	net.Conn
	limit int
}

func (conn shortComputeWriteConn) Write(data []byte) (int, error) {
	if len(data) > conn.limit {
		data = data[:conn.limit]
	}
	if len(data) == 0 {
		return 0, nil
	}
	return conn.Conn.Write(data)
}

type countedComputeConn struct {
	net.Conn
	read, written int
}

func (conn *countedComputeConn) Read(data []byte) (int, error) {
	n, err := conn.Conn.Read(data)
	conn.read += n
	return n, err
}

func (conn *countedComputeConn) Write(data []byte) (int, error) {
	n, err := conn.Conn.Write(data)
	conn.written += n
	return n, err
}

func computeFramingPipe(t *testing.T) (net.Conn, net.Conn) {
	t.Helper()
	left, right := net.Pipe()
	if err := left.SetDeadline(time.Now().Add(2 * time.Second)); err != nil {
		t.Fatal(err)
	}
	if err := right.SetDeadline(time.Now().Add(2 * time.Second)); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = left.Close(); _ = right.Close() })
	return left, right
}

func computeTestWire(payload string) []byte {
	data := make([]byte, 4+len(payload))
	binary.BigEndian.PutUint32(data[:4], uint32(len(payload)))
	copy(data[4:], payload)
	return data
}

func readComputeTestWire(t *testing.T, data []byte) (Frame, error) {
	t.Helper()
	reader, writer := computeFramingPipe(t)
	go func() { _ = writeComputeBytes(writer, data); _ = writer.Close() }()
	return NewChannel(reader).Read()
}

func TestComputeChannelHandlesPartialWritesAndTypedBodies(t *testing.T) {
	left, right := computeFramingPipe(t)
	sender := NewChannel(shortComputeWriteConn{Conn: left, limit: 3})
	receiver := NewChannel(right)
	sent := make(chan error, 1)
	go func() {
		sent <- sender.Send("job/offer", struct {
			Name string `json:"name"`
		}{Name: "Small local training job"})
	}()
	frame, err := receiver.Read()
	if err != nil {
		t.Fatal(err)
	}
	var body struct {
		Name string `json:"name"`
	}
	if err := Decode(frame, "job/offer", &body); err != nil || body.Name != "Small local training job" {
		t.Fatalf("framing changed a valid message: %v", err)
	}
	if err := <-sent; err != nil {
		t.Fatal(err)
	}
}

func TestComputeChannelSerializesConcurrentSends(t *testing.T) {
	left, right := computeFramingPipe(t)
	sender, receiver := NewChannel(left), NewChannel(right)
	const count = 16
	var waiting sync.WaitGroup
	sendErrors := make(chan error, count)
	for index := range count {
		waiting.Add(1)
		go func(index int) {
			defer waiting.Done()
			sendErrors <- sender.Send("progress", struct {
				Index int `json:"index"`
			}{index})
		}(index)
	}
	seen := make(map[int]bool)
	for range count {
		frame, err := receiver.Read()
		if err != nil {
			t.Fatal(err)
		}
		var body struct {
			Index int `json:"index"`
		}
		if err := Decode(frame, "progress", &body); err != nil || seen[body.Index] {
			t.Fatalf("concurrent frames interleaved or duplicated: %v", err)
		}
		seen[body.Index] = true
	}
	waiting.Wait()
	for range count {
		if err := <-sendErrors; err != nil {
			t.Fatal(err)
		}
	}
}

func TestComputeFrameLengthLimitBeforePayloadRead(t *testing.T) {
	for _, length := range []uint32{0, MaxFrameBytes + 1, 0xffffffff} {
		reader, writer := computeFramingPipe(t)
		counted := &countedComputeConn{Conn: reader}
		var header [4]byte
		binary.BigEndian.PutUint32(header[:], length)
		go func() { _ = writeComputeBytes(writer, header[:]) }()
		if _, err := NewChannel(counted).Read(); err == nil || err.Error() != "Invalid compute frame length." {
			t.Fatalf("invalid frame length reached payload reading: %v", err)
		}
		if counted.read != 4 {
			t.Fatal("invalid frame length caused a payload read")
		}
	}
}

func TestComputeFrameTruncationAndEnvelopeValidation(t *testing.T) {
	for _, test := range []struct {
		name string
		wire []byte
	}{
		{"empty stream", nil},
		{"truncated prefix", []byte{0, 0}},
		{"truncated payload", []byte{0, 0, 0, 4, '{', '}'}},
		{"not an object", computeTestWire(`[]`)},
		{"unknown envelope field", computeTestWire(`{"type":"ping","body":{},"secret_extra":"private"}`)},
		{"trailing value", computeTestWire(`{"type":"ping","body":{}} {}`)},
		{"invalid syntax", computeTestWire(`{"type":"ping","body":`)},
		{"missing body", computeTestWire(`{"type":"ping"}`)},
		{"missing type", computeTestWire(`{"body":{}}`)},
		{"wrong type field casing", computeTestWire(`{"Type":"ping","body":{}}`)},
		{"duplicate type", computeTestWire(`{"type":"ping","type":"job","body":{}}`)},
		{"duplicate body", computeTestWire(`{"type":"ping","body":{},"body":{}}`)},
		{"empty type", computeTestWire(`{"type":"","body":{}}`)},
		{"numeric type", computeTestWire(`{"type":42,"body":{}}`)},
		{"unsupported type character", computeTestWire(`{"type":"job1","body":{}}`)},
		{"long type", computeTestWire(`{"type":"` + strings.Repeat("a", 33) + `","body":{}}`)},
	} {
		t.Run(test.name, func(t *testing.T) {
			if _, err := readComputeTestWire(t, test.wire); err == nil {
				t.Fatal("invalid wire message was accepted")
			}
		})
	}
	if _, err := readComputeTestWire(t, nil); !errors.Is(err, io.EOF) {
		t.Fatal("clean stream end lost its EOF identity")
	}
	if _, err := readComputeTestWire(t, []byte{0, 0}); !errors.Is(err, io.ErrUnexpectedEOF) {
		t.Fatal("truncated prefix lost its unexpected-EOF identity")
	}
}

func TestComputeFrameBoundaryAndRejectedSends(t *testing.T) {
	left, right := computeFramingPipe(t)
	counted := &countedComputeConn{Conn: left}
	sender := NewChannel(counted)
	for _, kind := range []string{"", "UPPER", "job1", "has space", strings.Repeat("a", 33)} {
		if err := sender.Send(kind, struct{}{}); err == nil {
			t.Fatal("invalid outgoing frame type was accepted")
		}
	}
	if err := sender.Send("data", strings.Repeat("x", MaxFrameBytes)); err == nil {
		t.Fatal("oversized outgoing frame was accepted")
	}
	if err := sender.Send("data", make(chan int)); err == nil {
		t.Fatal("unencodable outgoing frame was accepted")
	}
	if counted.written != 0 {
		t.Fatal("invalid outgoing frame emitted protocol bytes")
	}
	const envelopeBytes = len(`{"type":"data","body":""}`)
	body := strings.Repeat("x", MaxFrameBytes-envelopeBytes)
	sent := make(chan error, 1)
	go func() { sent <- sender.Send("data", body) }()
	frame, err := NewChannel(right).Read()
	if err != nil {
		t.Fatal(err)
	}
	var decoded string
	if err := Decode(frame, "data", &decoded); err != nil || decoded != body {
		t.Fatal("maximum-size valid frame was not preserved")
	}
	if err := <-sent; err != nil {
		t.Fatal(err)
	}
	if counted.written != 4+MaxFrameBytes {
		t.Fatal("boundary frame did not have the expected exact encoded size")
	}
}

type sensitiveComputeMarshal struct{}

func (sensitiveComputeMarshal) MarshalJSON() ([]byte, error) {
	return nil, errors.New("private training data must not appear in errors")
}

func TestComputeDecodeIsStrictAndDoesNotEchoBody(t *testing.T) {
	for _, body := range []string{
		`{"name":"private","unknown_private_field":"private"}`,
		`{"name":"private"} {"name":"private"}`,
		`{"name":"private"} trailing-private`,
		`{"name":`,
	} {
		frame := Frame{Type: "job", Body: json.RawMessage(body)}
		var destination struct {
			Name string `json:"name"`
		}
		if err := Decode(frame, "job", &destination); err == nil || strings.Contains(err.Error(), "private") {
			t.Fatal("body decoding accepted invalid input or echoed its data")
		}
	}
	if err := Decode(Frame{Type: "job", Body: json.RawMessage(`{}`)}, "cancel", new(any)); err == nil {
		t.Fatal("unexpected message type was accepted")
	}
	left, _ := computeFramingPipe(t)
	if err := NewChannel(left).Send("job", sensitiveComputeMarshal{}); err == nil || strings.Contains(err.Error(), "private") {
		t.Fatal("encoding error echoed private body information")
	}
}

func TestComputeChannelRejectsZeroProgressWrites(t *testing.T) {
	left, _ := computeFramingPipe(t)
	err := NewChannel(shortComputeWriteConn{Conn: left, limit: 0}).Send("ping", struct{}{})
	if !errors.Is(err, io.ErrShortWrite) {
		t.Fatalf("zero-progress writer was not rejected: %v", err)
	}
	var buffer bytes.Buffer
	if err := writeComputeBytes(&buffer, []byte("complete")); err != nil || buffer.String() != "complete" {
		t.Fatal("full-write helper changed valid data")
	}
}
