//go:build windows

// Package nearby carries document updates over native Bluetooth RFCOMM, never IP.
package nearby

import (
	"context"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"net"
	"os"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
)

var btDLL = windows.NewLazySystemDLL("bthprops.cpl")
var wsDLL = windows.NewLazySystemDLL("ws2_32.dll")
var serviceID = [16]byte{0x70, 0x56, 0x1a, 0xd7, 0xec, 0xe6, 0x22, 0x4a, 0x87, 0xf1, 0xb0, 0xed, 0x9b, 0x5d, 0xc3, 0x21}
var startup sync.Once
var startupErr error

type deviceInfo struct {
	Size                                 uint32
	_                                    [4]byte // Windows aligns BTH_ADDR to eight bytes on both x86 and x64.
	Address                              uint64
	Class                                uint32
	Connected, Remembered, Authenticated int32
	LastSeen, LastUsed                   [8]uint16
	Name                                 [248]uint16
}
type searchParams struct {
	Size                                                   uint32
	Authenticated, Remembered, Unknown, Connected, Inquiry int32
	Timeout                                                byte
	Radio                                                  syscall.Handle
}
type radioInfo struct {
	Size                     uint32
	_                        [4]byte
	Address                  uint64
	Name                     [248]uint16
	Class                    uint32
	Subversion, Manufacturer uint16
}

func RadioStatus() Radio {
	params := uint32(4)
	var radio syscall.Handle
	find, _, err := btDLL.NewProc("BluetoothFindFirstRadio").Call(uintptr(unsafe.Pointer(&params)), uintptr(unsafe.Pointer(&radio)))
	if find == 0 {
		return Radio{Error: fmt.Sprintf("No active Bluetooth radio. Turn Bluetooth on in Windows Settings (%v).", err)}
	}
	defer btDLL.NewProc("BluetoothFindRadioClose").Call(find)
	defer syscall.CloseHandle(radio)
	info := radioInfo{Size: uint32(unsafe.Sizeof(radioInfo{}))}
	code, _, _ := btDLL.NewProc("BluetoothGetRadioInfo").Call(uintptr(radio), uintptr(unsafe.Pointer(&info)))
	if code != 0 {
		return Radio{Error: fmt.Sprintf("Bluetooth radio information failed (%d).", code)}
	}
	return Radio{Available: true, Name: syscall.UTF16ToString(info.Name[:])}
}

// PairedDevices only enumerates OS-authenticated devices. It never pairs silently.
func PairedDevices() ([]Device, error) {
	if status := RadioStatus(); !status.Available {
		return nil, errors.New(status.Error)
	}
	params := searchParams{Authenticated: 1}
	params.Size = uint32(unsafe.Sizeof(params))
	info := deviceInfo{Size: uint32(unsafe.Sizeof(deviceInfo{}))}
	find, _, err := btDLL.NewProc("BluetoothFindFirstDevice").Call(uintptr(unsafe.Pointer(&params)), uintptr(unsafe.Pointer(&info)))
	if find == 0 {
		if err == syscall.Errno(259) {
			return []Device{}, nil
		}
		return nil, fmt.Errorf("Could not read paired Bluetooth devices: %w", err)
	}
	defer btDLL.NewProc("BluetoothFindDeviceClose").Call(find)
	devices := []Device{}
	seen := map[uint64]bool{}
	for {
		if info.Authenticated != 0 && !seen[info.Address] {
			devices = append(devices, Device{Address: fmt.Sprintf("%012X", info.Address), Name: syscall.UTF16ToString(info.Name[:])})
			seen[info.Address] = true
		}
		ok, _, err := btDLL.NewProc("BluetoothFindNextDevice").Call(find, uintptr(unsafe.Pointer(&info)))
		if ok == 0 {
			if err != syscall.Errno(259) {
				return nil, fmt.Errorf("Bluetooth device enumeration failed: %w", err)
			}
			break
		}
	}
	sort.Slice(devices, func(i, j int) bool { return devices[i].Name < devices[j].Name })
	return devices, nil
}

func initSockets() error {
	startup.Do(func() { var data syscall.WSAData; startupErr = syscall.WSAStartup(0x202, &data) })
	return startupErr
}

// Use the last error captured by Go at the syscall boundary, as Go's own Winsock
// wrappers do. A later WSAGetLastError can lose it to thread migration or lazy
// procedure lookup. uintptr arguments retain their allocations across this Go
// wrapper, just as syscall.LazyProc.Call does.
//
//go:uintptrescapes
func socketCall(name string, args ...uintptr) (uintptr, error) {
	result, _, err := wsDLL.NewProc(name).Call(args...)
	if int32(result) == -1 {
		return result, fmt.Errorf("Bluetooth %s failed. Check Bluetooth, pairing and the other app: %w", name, err)
	}
	return result, nil
}

//go:uintptrescapes
func checkedCall(name string, args ...uintptr) error {
	_, err := socketCall(name, args...)
	return err
}

// SOCKADDR_BTH is explicitly packed to 30 bytes in Microsoft's ws2bth.h.
func addressBytes(address uint64, port uint32, service bool) [30]byte {
	if service {
		return addressBytesForService(address, port, serviceID)
	}
	return addressBytesForService(address, port, [16]byte{})
}

func addressBytesForService(address uint64, port uint32, id [16]byte) [30]byte {
	var result [30]byte
	binary.LittleEndian.PutUint16(result[:2], 32)
	binary.LittleEndian.PutUint64(result[2:10], address)
	copy(result[10:26], id[:])
	binary.LittleEndian.PutUint32(result[26:30], port)
	return result
}
func newSocket() (syscall.Handle, error) {
	if err := initSockets(); err != nil {
		return 0, err
	}
	handle, err := syscall.Socket(32, syscall.SOCK_STREAM, 3)
	if err != nil {
		return 0, err
	}
	for _, option := range []uintptr{0x80000001, 2} {
		enabled := uint32(1)
		if err := checkedCall("setsockopt", uintptr(handle), 3, option, uintptr(unsafe.Pointer(&enabled)), 4); err != nil {
			syscall.Closesocket(handle)
			return 0, err
		}
	}
	if err := makeNonblocking(handle); err != nil {
		syscall.Closesocket(handle)
		return 0, err
	}
	return handle, nil
}

func makeNonblocking(handle syscall.Handle) error {
	enabled := uint32(1)
	return checkedCall("ioctlsocket", uintptr(handle), 0x8004667e, uintptr(unsafe.Pointer(&enabled))) // FIONBIO
}

type socketAddress struct {
	Address uintptr
	Length  int32
}
type csAddrInfo struct {
	Local, Remote        socketAddress
	SocketType, Protocol int32
}
type querySet struct {
	Size                            uint32
	Name, ClassID, Version, Comment uintptr
	Namespace                       uint32
	Provider, Context               uintptr
	NumberProtocols                 uint32
	Protocols, QueryString          uintptr
	NumberAddresses                 uint32
	Addresses                       uintptr
	OutputFlags                     uint32
	Blob                            uintptr
}
type Listener struct {
	handle   syscall.Handle
	service  [16]byte
	address  [30]byte
	info     csAddrInfo
	query    querySet
	name     []uint16
	mu       sync.Mutex
	closed   bool
	changed  chan struct{}
	closeErr error
	Channel  uint32
}

func Listen() (*Listener, error) {
	return ListenService(serviceID, "LocalFirst offline document collaboration")
}

// newServiceListener owns all memory referenced by its SDP query. Building it
// does not open a socket or inspect a radio, including for invalid input.
func newServiceListener(id [16]byte, name string) (*Listener, error) {
	if id == ([16]byte{}) {
		return nil, errors.New("Bluetooth service UUID must not be zero.")
	}
	if strings.TrimSpace(name) == "" {
		return nil, errors.New("Bluetooth service name must not be empty.")
	}
	// Bound allocation as well as the encoded SDP name (256 UTF-16 code units,
	// excluding its terminator). Four UTF-8 bytes can encode at most two units.
	if len(name) > 4*256 {
		return nil, errors.New("Bluetooth service name is too long.")
	}
	encodedName, err := syscall.UTF16FromString(name)
	if err != nil {
		return nil, errors.New("Bluetooth service name must not contain NUL.")
	}
	if len(encodedName) > 257 {
		return nil, errors.New("Bluetooth service name is too long.")
	}
	l := &Listener{service: id, name: encodedName, address: addressBytes(0, 0xffffffff, false), changed: make(chan struct{})}
	l.info = csAddrInfo{Local: socketAddress{uintptr(unsafe.Pointer(&l.address)), 30}, Remote: socketAddress{uintptr(unsafe.Pointer(&l.address)), 30}, SocketType: 1, Protocol: 3}
	l.query = querySet{Size: uint32(unsafe.Sizeof(querySet{})), Name: uintptr(unsafe.Pointer(&l.name[0])), ClassID: uintptr(unsafe.Pointer(&l.service)), Namespace: 16, NumberAddresses: 1, Addresses: uintptr(unsafe.Pointer(&l.info))}
	return l, nil
}

// ListenService advertises an independent RFCOMM service while retaining the
// authenticated, encrypted transport used by Listen. id uses Windows GUID byte
// order. The caller must retain and close the returned listener.
func ListenService(id [16]byte, name string) (*Listener, error) {
	l, err := newServiceListener(id, name)
	if err != nil {
		return nil, err
	}
	if status := RadioStatus(); !status.Available {
		return nil, errors.New(status.Error)
	}
	handle, err := newSocket()
	if err != nil {
		return nil, err
	}
	l.handle = handle
	fail := func(err error) (*Listener, error) { syscall.Closesocket(handle); return nil, err }
	if err := checkedCall("bind", uintptr(handle), uintptr(unsafe.Pointer(&l.address)), 30); err != nil {
		return fail(err)
	}
	length := int32(30)
	if err := checkedCall("getsockname", uintptr(handle), uintptr(unsafe.Pointer(&l.address)), uintptr(unsafe.Pointer(&length))); err != nil {
		return fail(err)
	}
	l.Channel = binary.LittleEndian.Uint32(l.address[26:])
	if err := checkedCall("listen", uintptr(handle), 1); err != nil {
		return fail(err)
	}
	if err := checkedCall("WSASetServiceW", uintptr(unsafe.Pointer(&l.query)), 0, 0); err != nil {
		return fail(err)
	}
	runtime.KeepAlive(l)
	return l, nil
}
func (l *Listener) Close() error {
	l.mu.Lock()
	defer l.mu.Unlock()
	if !l.closed {
		l.closed = true
		l.closeErr = checkedCall("WSASetServiceW", uintptr(unsafe.Pointer(&l.query)), 2, 0)
		if err := syscall.Closesocket(l.handle); l.closeErr == nil {
			l.closeErr = err
		}
		close(l.changed)
		runtime.KeepAlive(l)
	}
	return l.closeErr
}
func (l *Listener) Accept() (net.Conn, error) {
	for {
		l.mu.Lock()
		if l.closed {
			l.mu.Unlock()
			return nil, net.ErrClosed
		}
		var addr [30]byte
		length := int32(30)
		handle, err := socketCall("accept", uintptr(l.handle), uintptr(unsafe.Pointer(&addr)), uintptr(unsafe.Pointer(&length)))
		l.mu.Unlock()
		if errors.Is(err, syscall.Errno(10035)) { // WSAEWOULDBLOCK
			waitSocket(l.changed, time.Time{})
			continue
		}
		if err != nil {
			return nil, err
		}
		if err := makeNonblocking(syscall.Handle(handle)); err != nil {
			syscall.Closesocket(syscall.Handle(handle))
			return nil, err
		}
		conn := newConn(syscall.Handle(handle), fmt.Sprintf("%012X", binary.LittleEndian.Uint64(addr[2:10])))
		conn.bluetoothAuthenticated = true // Accepted by an AF_BTH socket requiring authentication and encryption.
		return conn, nil
	}
}
func (l *Listener) Addr() net.Addr { return btAddr("local-bluetooth") }
func Dial(ctx context.Context, address string) (net.Conn, error) {
	return DialService(ctx, address, serviceID)
}

// DialService connects to a separately advertised service on an OS-paired
// device. id uses Windows GUID byte order; no pairing is performed implicitly.
func DialService(ctx context.Context, address string, id [16]byte) (net.Conn, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if id == ([16]byte{}) {
		return nil, errors.New("Bluetooth service UUID must not be zero.")
	}
	if len(address) != 12 || strings.ContainsAny(address, ":- ") {
		return nil, errors.New("Choose a paired Bluetooth device.")
	}
	value, err := strconv.ParseUint(address, 16, 48)
	if err != nil {
		return nil, errors.New("Invalid Bluetooth address.")
	}
	devices, err := PairedDevices()
	if err != nil {
		return nil, err
	}
	paired := false
	for _, device := range devices {
		if strings.EqualFold(device.Address, address) {
			paired = true
		}
	}
	if !paired {
		return nil, errors.New("Pair these laptops in Windows Bluetooth Settings before connecting.")
	}
	handle, err := newSocket()
	if err != nil {
		return nil, err
	}
	conn := newConn(handle, address)
	addr := addressBytesForService(value, 0, id)
	err = checkedCall("connect", uintptr(handle), uintptr(unsafe.Pointer(&addr)), 30)
	if errors.Is(err, syscall.Errno(10035)) { // WSAEWOULDBLOCK: connect is pending.
		err = conn.finishConnect(ctx)
	}
	if ctx.Err() != nil {
		err = ctx.Err()
	}
	if err != nil {
		conn.Close()
		return nil, err
	}
	conn.bluetoothAuthenticated = true
	return conn, nil
}

type Conn struct {
	handle                      syscall.Handle
	peer                        string
	bluetoothAuthenticated      bool
	mu                          sync.Mutex
	write                       sync.Mutex
	closed                      bool
	changed                     chan struct{}
	readDeadline, writeDeadline time.Time
}

func newConn(handle syscall.Handle, peer string) *Conn {
	return &Conn{handle: handle, peer: peer, changed: make(chan struct{})}
}

func (c *Conn) authenticatedBluetoothPeer() string {
	c.mu.Lock()
	closed := c.closed
	c.mu.Unlock()
	if !c.bluetoothAuthenticated || closed {
		return ""
	}
	devices, err := PairedDevices()
	if err != nil {
		return ""
	}
	for _, device := range devices {
		if strings.EqualFold(device.Address, c.peer) {
			c.mu.Lock()
			closed = c.closed
			c.mu.Unlock()
			if closed {
				return ""
			}
			return c.peer
		}
	}
	return ""
}

// Nonblocking socket operations are serialized with Close. No Winsock call can
// use a numeric handle after Windows has recycled it for a newer connection.
// Waiting outside the lock also makes deadline changes interrupt pending I/O.
func (c *Conn) transfer(buffer []byte, read bool) (int, error) {
	if len(buffer) == 0 {
		return 0, nil
	}
	if len(buffer) > 0x7fffffff {
		buffer = buffer[:0x7fffffff]
	}
	for {
		c.mu.Lock()
		if c.closed {
			c.mu.Unlock()
			return 0, net.ErrClosed
		}
		deadline, operation := c.writeDeadline, "send"
		if read {
			deadline, operation = c.readDeadline, "recv"
		}
		if !deadline.IsZero() && !time.Now().Before(deadline) {
			c.mu.Unlock()
			return 0, os.ErrDeadlineExceeded
		}
		result, err := socketCall(operation, uintptr(c.handle), uintptr(unsafe.Pointer(&buffer[0])), uintptr(len(buffer)), 0)
		changed := c.changed
		c.mu.Unlock()
		if errors.Is(err, syscall.Errno(10035)) {
			waitSocket(changed, deadline)
			continue
		}
		if err != nil {
			return 0, err
		}
		if read && result == 0 {
			return 0, io.EOF
		}
		return int(result), nil
	}
}
func (c *Conn) Read(buffer []byte) (int, error) { return c.transfer(buffer, true) }
func (c *Conn) Write(buffer []byte) (int, error) {
	c.write.Lock()
	defer c.write.Unlock()
	total := 0
	for len(buffer) > 0 {
		n, err := c.transfer(buffer, false)
		total += n
		buffer = buffer[n:]
		if err != nil {
			return total, err
		}
		if n == 0 {
			return total, io.ErrShortWrite
		}
	}
	return total, nil
}
func (c *Conn) Close() error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.closed {
		return nil
	}
	c.closed = true
	_ = checkedCall("shutdown", uintptr(c.handle), 2)
	err := syscall.Closesocket(c.handle)
	close(c.changed)
	return err
}

func waitSocket(changed <-chan struct{}, deadline time.Time) {
	delay := 10 * time.Millisecond
	if !deadline.IsZero() {
		if remaining := time.Until(deadline); remaining < delay {
			delay = remaining
		}
	}
	if delay <= 0 {
		return
	}
	timer := time.NewTimer(delay)
	defer timer.Stop()
	select {
	case <-changed:
	case <-timer.C:
	}
}

// fd_set stores pointer-sized SOCKETs, with native padding after its count.
type fdSet struct {
	Count   uint32
	Handles [1]syscall.Handle
}
type timeValue struct{ Seconds, Microseconds int32 }

func (c *Conn) finishConnect(ctx context.Context) error {
	for {
		if err := ctx.Err(); err != nil {
			return err
		}
		c.mu.Lock()
		if c.closed {
			c.mu.Unlock()
			return net.ErrClosed
		}
		write, except := fdSet{Count: 1, Handles: [1]syscall.Handle{c.handle}}, fdSet{Count: 1, Handles: [1]syscall.Handle{c.handle}}
		timeout := timeValue{}
		ready, err := socketCall("select", 0, 0, uintptr(unsafe.Pointer(&write)), uintptr(unsafe.Pointer(&except)), uintptr(unsafe.Pointer(&timeout)))
		if err == nil && ready != 0 {
			var code uint32
			length := int32(4)
			err = checkedCall("getsockopt", uintptr(c.handle), 0xffff, 0x1007, uintptr(unsafe.Pointer(&code)), uintptr(unsafe.Pointer(&length))) // SO_ERROR
			if err == nil && code != 0 {
				err = fmt.Errorf("Bluetooth connect failed: %w", syscall.Errno(code))
			}
		}
		c.mu.Unlock()
		if err != nil || ready != 0 {
			return err
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(10 * time.Millisecond):
		}
	}
}

type btAddr string

func (a btAddr) Network() string     { return "bluetooth-rfcomm" }
func (a btAddr) String() string      { return string(a) }
func (c *Conn) LocalAddr() net.Addr  { return btAddr("local") }
func (c *Conn) RemoteAddr() net.Addr { return btAddr(c.peer) }
func (c *Conn) deadline(t time.Time, read, write bool) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.closed {
		return net.ErrClosed
	}
	if read {
		c.readDeadline = t
	}
	if write {
		c.writeDeadline = t
	}
	close(c.changed)
	c.changed = make(chan struct{})
	return nil
}
func (c *Conn) SetReadDeadline(t time.Time) error  { return c.deadline(t, true, false) }
func (c *Conn) SetWriteDeadline(t time.Time) error { return c.deadline(t, false, true) }
func (c *Conn) SetDeadline(t time.Time) error      { return c.deadline(t, true, true) }
