//go:build compute_experiment

package main

import (
	"bytes"
	"context"
	"strings"
	"testing"
)

func TestHelpAndInvalidCommandsHaveNoSideEffects(t *testing.T) {
	var out bytes.Buffer
	if err := run(context.Background(), []string{"help"}, strings.NewReader(""), &out); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out.String(), "Bluetooth-only") || !strings.Contains(out.String(), "does not start, upgrade, or stop the office app") {
		t.Fatal("missing scope information")
	}
	for _, args := range [][]string{{"anything"}, {"probe"}, {"worker"}, {"submit"}, {"devices", "unexpected"}} {
		if err := run(context.Background(), args, strings.NewReader(""), &out); err == nil {
			t.Errorf("invalid arguments accepted: %v", args)
		}
	}
}
