//go:build !windows

package nearby

import (
	"context"
	"errors"
	"net"
)

var unsupported = errors.New("The native Bluetooth bridge requires Windows.")

func RadioStatus() Radio               { return Radio{Error: unsupported.Error()} }
func PairedDevices() ([]Device, error) { return nil, unsupported }

type Listener struct{ Channel uint32 }

func Listen() (*Listener, error)                                      { return nil, unsupported }
func ListenService([16]byte, string) (*Listener, error)               { return nil, unsupported }
func (l *Listener) Close() error                                      { return nil }
func (l *Listener) Accept() (net.Conn, error)                         { return nil, unsupported }
func (l *Listener) Addr() net.Addr                                    { return nil }
func Dial(context.Context, string) (net.Conn, error)                  { return nil, unsupported }
func DialService(context.Context, string, [16]byte) (net.Conn, error) { return nil, unsupported }
