//go:build !windows && relay_experiment

package nearby

import (
	"context"
	"errors"
	"net"
)

func dialExperimentalRelay(context.Context, string) (net.Conn, error) {
	return nil, errors.New("The experimental native relay connector requires Windows.")
}
