//go:build compute_experiment && windows

package runtime

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strconv"
	"testing"
	"time"

	"golang.org/x/sys/windows"
)

func TestWindowsCancellationKillsDescendants(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	pidFile := filepath.Join(t.TempDir(), "child.pid")
	done := make(chan error, 1)
	go func() {
		_, err := execute(ctx, helperCommand(t, "parent", pidFile))
		done <- err
	}()
	var pid int
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		if data, err := os.ReadFile(pidFile); err == nil {
			pid, _ = strconv.Atoi(string(data))
			if pid > 0 {
				break
			}
		}
		time.Sleep(20 * time.Millisecond)
	}
	if pid == 0 {
		t.Fatal("contained interpreter did not launch its test descendant")
	}
	handle, err := windows.OpenProcess(windows.SYNCHRONIZE|windows.PROCESS_QUERY_LIMITED_INFORMATION, false, uint32(pid))
	if err != nil {
		t.Fatalf("could not inspect live descendant: %v", err)
	}
	defer windows.CloseHandle(handle)
	cancel()
	select {
	case err := <-done:
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("process cancellation = %v", err)
		}
	case <-time.After(4 * time.Second):
		t.Fatal("process tree did not terminate promptly")
	}
	state, err := windows.WaitForSingleObject(handle, 2000)
	if err != nil || state != windows.WAIT_OBJECT_0 {
		t.Fatalf("descendant remained alive after cancellation: state %d, error %v", state, err)
	}
}
