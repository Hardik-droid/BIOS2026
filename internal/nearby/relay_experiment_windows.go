//go:build windows && relay_experiment

package nearby

import (
	"context"
	"encoding/hex"
	"errors"
	"net"
	"strconv"
	"strings"
	"syscall"
	"unsafe"
)

// GUID 5bb53883-7094-461b-9d28-f7189bb4cb62 in Windows GUID byte order.
var experimentalRelayService = [16]byte{0x83, 0x38, 0xb5, 0x5b, 0x94, 0x70, 0x1b, 0x46, 0x9d, 0x28, 0xf7, 0x18, 0x9b, 0xb4, 0xcb, 0x62}

func dialExperimentalRelay(ctx context.Context, address string) (net.Conn, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if len(address) != 12 {
		return nil, errors.New("Select the paired Android relay phone.")
	}
	if _, err := hex.DecodeString(address); err != nil {
		return nil, errors.New("Invalid Bluetooth relay address.")
	}
	devices, err := PairedDevices()
	if err != nil {
		return nil, err
	}
	paired := false
	for _, device := range devices {
		if strings.EqualFold(device.Address, address) {
			paired = true
			break
		}
	}
	if !paired {
		return nil, errors.New("Pair the Android relay phone in Windows Bluetooth Settings first.")
	}
	value, _ := strconv.ParseUint(address, 16, 48)
	handle, err := newSocket()
	if err != nil {
		return nil, err
	}
	conn := newConn(handle, address)
	addr := addressBytes(value, 0, true)
	copy(addr[10:26], experimentalRelayService[:])
	err = checkedCall("connect", uintptr(handle), uintptr(unsafe.Pointer(&addr)), 30)
	if errors.Is(err, syscall.Errno(10035)) {
		err = conn.finishConnect(ctx)
	}
	if ctx.Err() != nil {
		err = ctx.Err()
	}
	if err != nil {
		conn.Close()
		return nil, err
	}
	return conn, nil
}
