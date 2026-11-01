//go:build compute_experiment

package computeexp

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"net"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	training "localfirst/internal/computeexp/runtime"
)

func testRequest() Request {
	return Request{ID: strings.Repeat("ab", 16), ScriptSHA256: strings.Repeat("cd", 32), Device: "cpu", Epochs: 2, BatchSize: 16, LearningRate: 0.001}
}

func testWorker(t *testing.T) WorkerOptions {
	t.Helper()
	return WorkerOptions{Config: training.Config{ScriptSHA256: testRequest().ScriptSHA256, MaxSeconds: 5, MaxOutputBytes: MaxOutputBytes}, WorkDir: t.TempDir(), Approve: func(context.Context, Request) (bool, error) { return true, nil }}
}

// This validates the real TLS protocol over a simulated stream. The injected
// runner is explicitly a fixture, not evidence of PyTorch or physical Bluetooth.
func TestTLSJobTransferSimulatedStream(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	id, err := NewIdentity()
	if err != nil {
		t.Fatal(err)
	}
	left, right := net.Pipe()
	opts := testWorker(t)
	data := bytes.Repeat([]byte("example-data\x00\xff"), 6000)
	input := filepath.Join(t.TempDir(), "dataset.bin")
	if err := os.WriteFile(input, data, 0600); err != nil {
		t.Fatal(err)
	}
	manifest, err := HashFile(input, MaxInputBytes)
	if err != nil {
		t.Fatal(err)
	}
	request := testRequest()
	request.Input = &manifest
	workerResult := make(chan error, 1)
	go func() {
		conn, err := AcceptSecure(ctx, right, id)
		if err != nil {
			workerResult <- err
			return
		}
		workerResult <- serve(ctx, conn, opts, func(ctx context.Context, _ training.Config, j training.Job, inputPath, output string) (training.Result, error) {
			got, err := os.ReadFile(inputPath)
			if err != nil || !bytes.Equal(got, data) {
				return training.Result{}, errors.New("fixture input changed")
			}
			if j.Device != "cpu" || j.ID != request.ID {
				return training.Result{}, errors.New("fixture params changed")
			}
			if err := os.Mkdir(filepath.Join(output, "nested"), 0700); err != nil {
				return training.Result{}, err
			}
			if err := os.WriteFile(filepath.Join(output, "nested", "weights.bin"), data, 0600); err != nil {
				return training.Result{}, err
			}
			if err := os.WriteFile(filepath.Join(output, "empty.txt"), nil, 0600); err != nil {
				return training.Result{}, err
			}
			return training.Result{ExitCode: 0, DurationMS: 10, Log: "private dataset path: never transfer this log"}, nil
		})
	}()
	client, err := DialSecure(ctx, left, id.Invitation)
	if err != nil {
		t.Fatal(err)
	}
	out := filepath.Join(t.TempDir(), "results")
	result, err := Submit(ctx, client, request, input, out, nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := <-workerResult; err != nil {
		t.Fatal(err)
	}
	got, err := os.ReadFile(filepath.Join(out, "nested", "weights.bin"))
	if err != nil || !bytes.Equal(got, data) {
		t.Fatalf("artifact mismatch: %v", err)
	}
	if len(result.Files) != 2 || result.Runtime.Log != "" {
		t.Fatal("unexpected files or private log leaked")
	}
	if _, err := os.Stat(filepath.Join(out, "TRANSFER-COMPLETE.txt")); err != nil {
		t.Fatal(err)
	}
	jobs, _ := filepath.Glob(filepath.Join(opts.WorkDir, "job-*", "worker-report.json"))
	if len(jobs) != 1 {
		t.Fatal("worker report missing")
	}
	log, _ := os.ReadFile(jobs[0])
	if !bytes.Contains(log, []byte("private dataset path")) {
		t.Fatal("local log not retained")
	}
}

func TestApprovalAndScriptPinPreventExecution(t *testing.T) {
	for _, scenario := range []string{"reject", "no-handler", "wrong-hash"} {
		t.Run(scenario, func(t *testing.T) {
			ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
			defer cancel()
			opts := testWorker(t)
			switch scenario {
			case "reject":
				opts.Approve = func(context.Context, Request) (bool, error) { return false, nil }
			case "no-handler":
				opts.Approve = nil
			case "wrong-hash":
				opts.Config.ScriptSHA256 = strings.Repeat("ef", 32)
			}
			var runs atomic.Int32
			left, right := net.Pipe()
			done := make(chan error, 1)
			go func() {
				done <- serve(ctx, right, opts, func(context.Context, training.Config, training.Job, string, string) (training.Result, error) {
					runs.Add(1)
					return training.Result{}, nil
				})
			}()
			_, err := Submit(ctx, left, testRequest(), "", filepath.Join(t.TempDir(), "results"), nil)
			if err == nil {
				t.Fatal("rejected job succeeded")
			}
			if err := <-done; err == nil {
				t.Fatal("worker did not reject")
			}
			if runs.Load() != 0 {
				t.Fatal("unapproved code executed")
			}
			if entries, _ := os.ReadDir(opts.WorkDir); len(entries) != 0 {
				t.Fatal("rejected job allocated files")
			}
		})
	}
}

func TestSenderDisconnectCancelsRunner(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	left, right := net.Pipe()
	started := make(chan struct{})
	cancelled := make(chan struct{})
	done := make(chan error, 1)
	go func() {
		done <- serve(ctx, right, testWorker(t), func(ctx context.Context, _ training.Config, _ training.Job, _, _ string) (training.Result, error) {
			close(started)
			<-ctx.Done()
			close(cancelled)
			return training.Result{}, ctx.Err()
		})
	}()
	channel := NewChannel(left)
	if err := channel.Send("job", testRequest()); err != nil {
		t.Fatal(err)
	}
	var status Status
	if err := readExpected(channel, "status", &status); err != nil {
		t.Fatal(err)
	}
	var ready receipt
	if err := readExpected(channel, "ready", &ready); err != nil {
		t.Fatal(err)
	}
	<-started
	left.Close()
	select {
	case <-cancelled:
	case <-ctx.Done():
		t.Fatal("disconnect left the runner running")
	}
	if err := <-done; err == nil {
		t.Fatal("disconnect reported success")
	}
}

func TestFailedRunnerLeavesLocalLogAndIncompleteClient(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	left, right := net.Pipe()
	opts := testWorker(t)
	done := make(chan error, 1)
	go func() {
		done <- serve(ctx, right, opts, func(context.Context, training.Config, training.Job, string, string) (training.Result, error) {
			return training.Result{ExitCode: 2, Log: "private failure detail"}, errors.New("fixture failure")
		})
	}()
	out := filepath.Join(t.TempDir(), "results")
	if _, err := Submit(ctx, left, testRequest(), "", out, nil); err == nil {
		t.Fatal("failed runner succeeded")
	}
	<-done
	if _, err := os.Stat(filepath.Join(out, "INCOMPLETE.txt")); err != nil {
		t.Fatal("missing incomplete marker")
	}
	logs, _ := filepath.Glob(filepath.Join(opts.WorkDir, "job-*", "worker-report.json"))
	if len(logs) != 1 {
		t.Fatal("failure log not retained")
	}
}

func TestManifestRejectsTraversalCollisionsAndOversize(t *testing.T) {
	hash := strings.Repeat("ab", 32)
	for _, path := range []string{"../secret", "/absolute", "C:/secret", "nested\\secret", "a/./b", "a//b", "NUL.bin", "com1.txt", "a/trailing.", "x/../y", "job-result.json", "INCOMPLETE.txt", "a\x00b"} {
		if err := validateArtifacts([]Artifact{{Path: path, Size: 1, SHA256: hash}}, MaxOutputBytes); err == nil {
			t.Errorf("accepted unsafe path %q", path)
		}
	}
	for _, files := range [][]Artifact{
		{{Path: "weights.bin", Size: 1, SHA256: hash}, {Path: "WEIGHTS.bin", Size: 1, SHA256: hash}},
		{{Path: "parent", Size: 1, SHA256: hash}, {Path: "parent/child", Size: 1, SHA256: hash}},
		{{Path: "a", Size: MaxOutputBytes, SHA256: hash}, {Path: "b", Size: 1, SHA256: hash}},
		{{Path: "a", Size: -1, SHA256: hash}},
	} {
		if err := validateArtifacts(files, MaxOutputBytes); err == nil {
			t.Fatal("accepted invalid manifest")
		}
	}
}

func TestCorruptAndOutOfOrderChunksNeverPublish(t *testing.T) {
	for _, index := range []int{0, 1} {
		t.Run(string(rune('0'+index)), func(t *testing.T) {
			left, right := net.Pipe()
			defer left.Close()
			defer right.Close()
			right.SetDeadline(time.Now().Add(time.Second))
			left.SetDeadline(time.Now().Add(time.Second))
			path := filepath.Join(t.TempDir(), "artifact.bin")
			done := make(chan error, 1)
			hash := sha256.Sum256([]byte("expected"))
			go func() { done <- receiveFile(NewChannel(right), path, 8, hex.EncodeToString(hash[:])) }()
			_ = NewChannel(left).Send("chunk", chunk{Index: index, Data: []byte("tampered")})
			if err := <-done; err == nil {
				t.Fatal("corruption accepted")
			}
			if _, err := os.Stat(path); !os.IsNotExist(err) {
				t.Fatal("unverified artifact published")
			}
		})
	}
}

func TestExistingResultDirectoryUntouched(t *testing.T) {
	out := t.TempDir()
	existing := filepath.Join(out, "keep.txt")
	os.WriteFile(existing, []byte("keep"), 0600)
	left, right := net.Pipe()
	defer right.Close()
	if _, err := Submit(context.Background(), left, testRequest(), "", out, nil); err == nil {
		t.Fatal("existing output directory accepted")
	}
	data, err := os.ReadFile(existing)
	if err != nil || string(data) != "keep" {
		t.Fatal("existing file changed")
	}
}

func TestJobSpecRejectsExecutableArguments(t *testing.T) {
	path := filepath.Join(t.TempDir(), "job.json")
	for _, body := range []string{
		`{"script_sha256":"` + testRequest().ScriptSHA256 + `","device":"cpu","epochs":1,"batch_size":1,"learning_rate":0.01,"args":["-c","untrusted"]}`,
		`{"script_sha256":"` + testRequest().ScriptSHA256 + `","device":"cpu","epochs":1,"batch_size":1,"learning_rate":0.01} {}`,
	} {
		os.WriteFile(path, []byte(body), 0600)
		if _, err := ReadJobSpec(path); err == nil {
			t.Fatal("unsafe spec accepted")
		}
	}
}

func TestTransferLimits(t *testing.T) {
	r := testRequest()
	r.Input = &Input{Size: MaxInputBytes + 1, SHA256: r.ScriptSHA256}
	if r.Validate() == nil {
		t.Fatal("oversized input accepted")
	}
	root := t.TempDir()
	f, err := os.Create(filepath.Join(root, "large.bin"))
	if err != nil {
		t.Fatal(err)
	}
	f.Truncate(100)
	f.Close()
	if _, err := collectArtifacts(root, 99); err == nil {
		t.Fatal("oversized output accepted")
	}
	if _, err := HashFile(filepath.Join(root, "large.bin"), 99); err == nil {
		t.Fatal("oversized sender input accepted")
	}
}

func TestOutputGrowthCancelsRunner(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Second)
	defer cancel()
	left, right := net.Pipe()
	opts := testWorker(t)
	opts.Config.MaxOutputBytes = 64
	done := make(chan error, 1)
	go func() {
		done <- serve(ctx, right, opts, func(ctx context.Context, _ training.Config, _ training.Job, _, out string) (training.Result, error) {
			if err := os.WriteFile(filepath.Join(out, "too-large.bin"), make([]byte, 65), 0600); err != nil {
				return training.Result{}, err
			}
			<-ctx.Done()
			return training.Result{ExitCode: -1}, ctx.Err()
		})
	}()
	out := filepath.Join(t.TempDir(), "results")
	if _, err := Submit(ctx, left, testRequest(), "", out, nil); err == nil {
		t.Fatal("oversized job succeeded")
	}
	if err := <-done; err == nil {
		t.Fatal("worker missed output quota")
	}
	logs, _ := filepath.Glob(filepath.Join(opts.WorkDir, "job-*", "worker-report.json"))
	if len(logs) != 1 {
		t.Fatal("quota cancellation log missing")
	}
	data, _ := os.ReadFile(logs[0])
	if !bytes.Contains(data, []byte("byte limit")) {
		t.Fatal("missing quota diagnosis")
	}
}
