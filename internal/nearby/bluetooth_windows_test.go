//go:build windows

package nearby

import (
	"bytes"
	"context"
	"errors"
	"io"
	"net"
	"os"
	"syscall"
	"testing"
	"time"
	"unsafe"
)

// These sockets exercise the Windows socket wrapper over loopback TCP only.
// They do not exercise Bluetooth radios, pairing, SDP, or RFCOMM transfer.
func nativeTestConn(t *testing.T) (*Conn, net.Conn) {
	t.Helper()
	listener, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	if err := initSockets(); err != nil {
		t.Fatal(err)
	}
	handle, err := syscall.Socket(syscall.AF_INET, syscall.SOCK_STREAM, syscall.IPPROTO_TCP)
	if err != nil {
		t.Fatal(err)
	}
	address := &syscall.SockaddrInet4{Port: listener.Addr().(*net.TCPAddr).Port, Addr: [4]byte{127, 0, 0, 1}}
	if err := makeNonblocking(handle); err != nil {
		syscall.Closesocket(handle)
		t.Fatal(err)
	}
	conn := newConn(handle, "native-socket-test")
	t.Cleanup(func() { conn.Close() })
	err = syscall.Connect(handle, address)
	if err != nil && !errors.Is(err, syscall.Errno(10035)) {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	if err := conn.finishConnect(ctx); err != nil {
		t.Fatal(err)
	}
	peer, err := listener.Accept()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { peer.Close() })
	return conn, peer
}

func TestNativeDeadlineIsAbsoluteAcrossReads(t *testing.T) {
	conn, peer := nativeTestConn(t)
	if err := conn.SetReadDeadline(time.Now().Add(150 * time.Millisecond)); err != nil {
		t.Fatal(err)
	}
	stop := make(chan struct{})
	defer close(stop)
	go func() {
		ticker := time.NewTicker(15 * time.Millisecond)
		defer ticker.Stop()
		for {
			select {
			case <-stop:
				return
			case <-ticker.C:
				if _, err := peer.Write([]byte{1}); err != nil {
					return
				}
			}
		}
	}()
	start := time.Now()
	n, err := io.ReadFull(conn, make([]byte, 100))
	if !errors.Is(err, os.ErrDeadlineExceeded) || n == 0 {
		t.Fatalf("read %d bytes, error %v; wanted partial data and absolute deadline", n, err)
	}
	if elapsed := time.Since(start); elapsed > 500*time.Millisecond {
		t.Fatalf("trickled data extended the deadline to %s", elapsed)
	}
}

func TestNativeDeadlineChangeInterruptsReadAndCanBeCleared(t *testing.T) {
	conn, peer := nativeTestConn(t)
	result := make(chan error, 1)
	go func() {
		_, err := conn.Read(make([]byte, 1))
		result <- err
	}()
	if err := conn.SetReadDeadline(time.Now().Add(-time.Second)); err != nil {
		t.Fatal(err)
	}
	select {
	case err := <-result:
		if !errors.Is(err, os.ErrDeadlineExceeded) {
			t.Fatalf("read error %v, wanted deadline", err)
		}
	case <-time.After(time.Second):
		t.Fatal("deadline change did not interrupt pending read")
	}
	if err := conn.SetReadDeadline(time.Time{}); err != nil {
		t.Fatal(err)
	}
	if _, err := peer.Write([]byte{7}); err != nil {
		t.Fatal(err)
	}
	var data [1]byte
	if _, err := io.ReadFull(conn, data[:]); err != nil || data[0] != 7 {
		t.Fatalf("cleared deadline could not read: %v, %v", data, err)
	}
}

func TestNativeCloseInterruptsReadAndRejectsLaterOperations(t *testing.T) {
	conn, _ := nativeTestConn(t)
	result := make(chan error, 1)
	go func() {
		_, err := conn.Read(make([]byte, 1))
		result <- err
	}()
	if err := conn.Close(); err != nil {
		t.Fatal(err)
	}
	select {
	case err := <-result:
		if !errors.Is(err, net.ErrClosed) {
			t.Fatalf("read error %v, wanted closed connection", err)
		}
	case <-time.After(time.Second):
		t.Fatal("Close did not interrupt pending read")
	}
	if _, err := conn.Read(make([]byte, 1)); !errors.Is(err, net.ErrClosed) {
		t.Fatalf("read after Close: %v", err)
	}
	if _, err := conn.Write([]byte{1}); !errors.Is(err, net.ErrClosed) {
		t.Fatalf("write after Close: %v", err)
	}
	if err := conn.SetDeadline(time.Time{}); !errors.Is(err, net.ErrClosed) {
		t.Fatalf("deadline after Close: %v", err)
	}
}

func TestNativeTCPWrapperCannotAuthorizeShortPairing(t *testing.T) {
	conn, _ := nativeTestConn(t)
	if conn.authenticatedBluetoothPeer() != "" || authenticatedPeer(conn) != "" {
		t.Fatal("TCP socket wrapper acquired native authenticated Bluetooth authority")
	}
}

func TestNativeWriteSendsTheEntireBuffer(t *testing.T) {
	conn, peer := nativeTestConn(t)
	if err := syscall.SetsockoptInt(conn.handle, syscall.SOL_SOCKET, syscall.SO_SNDBUF, 1024); err != nil {
		t.Fatal(err)
	}
	if err := conn.SetWriteDeadline(time.Now().Add(5 * time.Second)); err != nil {
		t.Fatal(err)
	}
	data := bytes.Repeat([]byte("partial native writes must preserve every byte"), 16384)
	received := make([]byte, len(data))
	result := make(chan error, 1)
	go func() {
		_ = peer.SetReadDeadline(time.Now().Add(5 * time.Second))
		_, err := io.ReadFull(peer, received)
		result <- err
	}()
	n, err := conn.Write(data)
	if err != nil || n != len(data) {
		t.Fatalf("Write = %d, %v; wanted %d bytes", n, err, len(data))
	}
	if err := <-result; err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(data, received) {
		t.Fatal("native writes dropped or reordered bytes")
	}
}

func TestWindowsBluetoothABILayouts(t *testing.T) {
	if unsafe.Sizeof(deviceInfo{}) != 560 || unsafe.Sizeof(radioInfo{}) != 520 {
		t.Fatalf("Bluetooth ABI sizes: device %d, radio %d", unsafe.Sizeof(deviceInfo{}), unsafe.Sizeof(radioInfo{}))
	}
	if unsafe.Offsetof(deviceInfo{}.Address) != 8 || unsafe.Offsetof(radioInfo{}.Address) != 8 {
		t.Fatal("Bluetooth addresses require eight-byte alignment")
	}
	if len(addressBytes(0, 0, false)) != 30 {
		t.Fatal("SOCKADDR_BTH requires thirty-byte packed layout")
	}
}
