//go:build compute_experiment && !windows && !unix

package runtime

import (
	"errors"
	"os/exec"
)

func startManaged(*exec.Cmd) (func() error, func(), error) {
	return nil, nil, errors.New("contained training subprocesses require Windows or Unix")
}
