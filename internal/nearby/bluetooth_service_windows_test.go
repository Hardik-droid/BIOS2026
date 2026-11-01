//go:build windows

package nearby

import (
	"bytes"
	"context"
	"encoding/binary"
	"errors"
	"runtime"
	"strings"
	"syscall"
	"testing"
	"unsafe"
)

// These tests construct SDP data and reject invalid requests without opening
// Bluetooth sockets, registering services, or changing radio state.
func TestBluetoothDocumentServiceIdentityUnchanged(t *testing.T) {
	wantID := [16]byte{0x70, 0x56, 0x1a, 0xd7, 0xec, 0xe6, 0x22, 0x4a, 0x87, 0xf1, 0xb0, 0xed, 0x9b, 0x5d, 0xc3, 0x21}
	if serviceID != wantID {
		t.Fatal("document Bluetooth service UUID changed")
	}
	want := [30]byte{0x20, 0, 0x66, 0x55, 0x44, 0x33, 0x22, 0x11, 0, 0, 0x70, 0x56, 0x1a, 0xd7, 0xec, 0xe6, 0x22, 0x4a, 0x87, 0xf1, 0xb0, 0xed, 0x9b, 0x5d, 0xc3, 0x21, 7, 0, 0, 0}
	if got := addressBytes(0x112233445566, 7, true); got != want {
		t.Fatalf("document service SOCKADDR_BTH changed: %x", got)
	}
	bind := addressBytes(0, 0xffffffff, false)
	if binary.LittleEndian.Uint16(bind[:2]) != 32 || binary.LittleEndian.Uint32(bind[26:]) != 0xffffffff || !bytes.Equal(bind[10:26], make([]byte, 16)) {
		t.Fatalf("default Bluetooth bind address changed: %x", bind)
	}
}

func TestBluetoothServiceAddressIsIndependent(t *testing.T) {
	id := [16]byte{1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16}
	got := addressBytesForService(0xaabbccddeeff, 19, id)
	if binary.LittleEndian.Uint16(got[:2]) != 32 || binary.LittleEndian.Uint64(got[2:10]) != 0xaabbccddeeff || binary.LittleEndian.Uint32(got[26:]) != 19 {
		t.Fatalf("service address has incorrect family/address/channel: %x", got)
	}
	if !bytes.Equal(got[10:26], id[:]) {
		t.Fatalf("custom service UUID was not encoded in Windows GUID order: %x", got[10:26])
	}
	id[0] = 99
	if got[10] != 1 {
		t.Fatal("service address aliases the caller's UUID")
	}
	if got == addressBytes(0xaabbccddeeff, 19, true) {
		t.Fatal("custom service reused the document service identity")
	}
}

func TestBluetoothListenerOwnsServiceRegistrationMemory(t *testing.T) {
	id := [16]byte{1, 2, 3}
	first, err := newServiceListener(id, "First independent service")
	if err != nil {
		t.Fatal(err)
	}
	id[0] = 4
	second, err := newServiceListener(id, "Second independent service")
	if err != nil {
		t.Fatal(err)
	}
	id[0] = 9
	runtime.GC()
	for _, listener := range []*Listener{first, second} {
		if listener.query.ClassID != uintptr(unsafe.Pointer(&listener.service)) || listener.query.Name != uintptr(unsafe.Pointer(&listener.name[0])) || listener.query.Addresses != uintptr(unsafe.Pointer(&listener.info)) {
			t.Fatal("registration does not reference listener-owned UUID/name/address data")
		}
		if listener.info.Local.Address != uintptr(unsafe.Pointer(&listener.address)) || listener.info.Remote.Address != uintptr(unsafe.Pointer(&listener.address)) {
			t.Fatal("registration socket addresses are not listener-owned")
		}
	}
	if first.service != ([16]byte{1, 2, 3}) || second.service != ([16]byte{4, 2, 3}) {
		t.Fatal("listener service UUID aliases caller input or another listener")
	}
	if first.query.ClassID == second.query.ClassID || first.query.Name == second.query.Name || first.query.Addresses == second.query.Addresses {
		t.Fatal("independent service registrations share mutable memory")
	}
	if syscall.UTF16ToString(first.name) != "First independent service" || syscall.UTF16ToString(second.name) != "Second independent service" {
		t.Fatal("independent service names were overwritten")
	}
	runtime.KeepAlive(first)
	runtime.KeepAlive(second)
}

func TestBluetoothServiceValidationPrecedesRadioAccess(t *testing.T) {
	id := [16]byte{1}
	for _, test := range []struct {
		name        string
		id          [16]byte
		serviceName string
		want        string
	}{
		{"zero UUID", [16]byte{}, "Service", "UUID must not be zero"},
		{"empty name", id, "", "must not be empty"},
		{"blank name", id, " \t\n", "must not be empty"},
		{"embedded NUL", id, "First\x00Second", "must not contain NUL"},
		{"long allocation", id, strings.Repeat("a", 1025), "too long"},
		{"long encoded name", id, strings.Repeat("a", 257), "too long"},
		{"long supplementary name", id, strings.Repeat("\U0001f4bb", 129), "too long"},
	} {
		t.Run(test.name, func(t *testing.T) {
			listener, err := ListenService(test.id, test.serviceName)
			if listener != nil || err == nil || !strings.Contains(err.Error(), test.want) {
				t.Fatalf("got listener %v, error %v; want validation error %q before radio access", listener, err, test.want)
			}
		})
	}
	for _, name := range []string{strings.Repeat("a", 256), strings.Repeat("\U0001f4bb", 128)} {
		listener, err := newServiceListener(id, name)
		if err != nil || len(listener.name) != 257 {
			t.Fatalf("256 UTF-16 code-unit name rejected: %v", err)
		}
	}
	conn, err := DialService(context.Background(), "001122334455", [16]byte{})
	if conn != nil || err == nil || !strings.Contains(err.Error(), "UUID must not be zero") {
		t.Fatalf("zero dial UUID was not rejected before radio access: %v", err)
	}
}

func TestBluetoothServiceDialCancellationAndAddressValidation(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	for _, dial := range []func() error{
		func() error { _, err := Dial(ctx, "001122334455"); return err },
		func() error { _, err := DialService(ctx, "001122334455", [16]byte{1}); return err },
	} {
		if err := dial(); !errors.Is(err, context.Canceled) {
			t.Fatalf("canceled dial should return without radio access: %v", err)
		}
	}
	for _, address := range []string{"", "00:11:22:33:44:55", "GG1122334455"} {
		if conn, err := DialService(context.Background(), address, [16]byte{1}); conn != nil || err == nil {
			t.Fatalf("invalid address %q was accepted", address)
		}
	}
}
