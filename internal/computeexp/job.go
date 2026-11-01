//go:build compute_experiment

// Package computeexp implements an opt-in, single-worker training experiment.
// It is excluded from the office application and its normal build.
package computeexp

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"math"
	"net"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"time"

	training "localfirst/internal/computeexp/runtime"
)

const (
	MaxInputBytes  = 32 << 20
	MaxOutputBytes = 64 << 20
	MaxArtifacts   = 128
	ChunkBytes     = 32 << 10
)

// ServiceID is intentionally distinct from document sharing and relay services.
var ServiceID = [16]byte{0x7b, 0xd5, 0x41, 0x68, 0xaf, 0xd2, 0x72, 0x49, 0x9a, 0x53, 0x69, 0x06, 0xc4, 0xf0, 0x13, 0x28}

type Input struct {
	Size   int64  `json:"size"`
	SHA256 string `json:"sha256"`
}

type Request struct {
	ID           string  `json:"id"`
	ScriptSHA256 string  `json:"script_sha256"`
	Device       string  `json:"device"`
	Epochs       int     `json:"epochs"`
	BatchSize    int     `json:"batch_size"`
	LearningRate float64 `json:"learning_rate"`
	Input        *Input  `json:"input,omitempty"`
}

type Status struct {
	State   string `json:"state"`
	Message string `json:"message"`
}

type Outcome struct {
	JobID   string          `json:"job_id"`
	Runtime training.Result `json:"runtime"`
	Files   []Artifact      `json:"files"`
}

type receipt struct {
	JobID string `json:"job_id"`
}

type WorkerOptions struct {
	Config  training.Config
	WorkDir string
	// Approval executes on the receiving PC; a remote sender cannot approve itself.
	Approve func(context.Context, Request) (bool, error)
}

func NewJobID() (string, error) {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", err
	}
	return hex.EncodeToString(b[:]), nil
}

func validHex(s string, bytes int) bool {
	b, err := hex.DecodeString(s)
	return err == nil && len(b) == bytes && s == strings.ToLower(s)
}

func (r Request) Validate() error {
	if !validHex(r.ID, 16) || !validHex(r.ScriptSHA256, 32) {
		return errors.New("invalid job identity or script SHA-256")
	}
	if r.Device != "cpu" && r.Device != "cuda" {
		return errors.New("device must be cpu or cuda")
	}
	if r.Epochs < 1 || r.Epochs > 10000 || r.BatchSize < 1 || r.BatchSize > 65536 || math.IsNaN(r.LearningRate) || math.IsInf(r.LearningRate, 0) || r.LearningRate <= 0 || r.LearningRate > 10 {
		return errors.New("training parameters exceed supported bounds")
	}
	if r.Input != nil && (r.Input.Size < 0 || r.Input.Size > MaxInputBytes || !validHex(r.Input.SHA256, 32)) {
		return errors.New("invalid input size or SHA-256")
	}
	return nil
}

func bindContext(ctx context.Context, conn net.Conn) func() {
	stop := make(chan struct{})
	go func() {
		select {
		case <-ctx.Done():
			conn.Close()
		case <-stop:
		}
	}()
	return func() { close(stop) }
}

func readExpected(c *Channel, kind string, dst any) error {
	f, err := c.Read()
	if err != nil {
		return err
	}
	if f.Type == "error" {
		var status Status
		if err := Decode(f, "error", &status); err != nil {
			return err
		}
		return fmt.Errorf("worker: %s", status.Message)
	}
	return Decode(f, kind, dst)
}

type runFunc func(context.Context, training.Config, training.Job, string, string) (training.Result, error)

// Serve accepts exactly one job on an already authenticated stream, then returns.
func Serve(ctx context.Context, conn net.Conn, opts WorkerOptions) error {
	if err := training.ValidateConfig(opts.Config); err != nil {
		conn.Close()
		return err
	}
	return serve(ctx, conn, opts, training.Run)
}

func serve(ctx context.Context, conn net.Conn, opts WorkerOptions, run runFunc) error {
	defer conn.Close()
	stop := bindContext(ctx, conn)
	defer stop()
	channel := NewChannel(conn)
	fail := func(message string) error {
		conn.SetWriteDeadline(time.Now().Add(3 * time.Second))
		_ = channel.Send("error", Status{State: "failed", Message: message})
		return errors.New(message)
	}
	// Slow or abandoned senders cannot keep a worker waiting indefinitely.
	conn.SetDeadline(time.Now().Add(2 * time.Minute))
	var request Request
	if err := readExpected(channel, "job", &request); err != nil {
		return err
	}
	if err := request.Validate(); err != nil {
		return fail(err.Error())
	}
	if request.ScriptSHA256 != strings.ToLower(opts.Config.ScriptSHA256) {
		return fail("requested script does not match the worker's pinned profile")
	}
	if opts.Approve == nil {
		return fail("this worker has no local approval handler")
	}
	if err := channel.Send("status", Status{State: "awaiting_approval", Message: "Waiting for approval on the receiving PC"}); err != nil {
		return err
	}
	approvalCtx, cancelApproval := context.WithTimeout(ctx, 90*time.Second)
	approved, err := opts.Approve(approvalCtx, request)
	cancelApproval()
	if err != nil || !approved {
		return fail("job was not approved on the receiving PC")
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	if !filepath.IsAbs(opts.WorkDir) {
		return fail("worker job directory must be absolute")
	}
	if err := os.MkdirAll(opts.WorkDir, 0700); err != nil {
		return fail("could not prepare worker job directory")
	}
	jobDir, err := os.MkdirTemp(opts.WorkDir, "job-"+request.ID+"-")
	if err != nil {
		return fail("could not allocate isolated job directory")
	}
	outputDir := filepath.Join(jobDir, "output")
	if err := os.Mkdir(outputDir, 0700); err != nil {
		return fail("could not create job output directory")
	}
	if err := channel.Send("ready", receipt{JobID: request.ID}); err != nil {
		return err
	}
	// A small input is optional. Large datasets should already be installed on the worker.
	inputFile := ""
	if request.Input != nil {
		inputFile = filepath.Join(jobDir, "input.bin")
		conn.SetDeadline(time.Now().Add(10 * time.Minute))
		if err := receiveFile(channel, inputFile, request.Input.Size, request.Input.SHA256); err != nil {
			return fail("input transfer failed integrity validation")
		}
	}
	conn.SetReadDeadline(time.Time{})
	jobCtx, cancelJob := context.WithTimeout(ctx, time.Duration(opts.Config.MaxSeconds)*time.Second)
	defer cancelJob()
	// A disconnected sender cancels training instead of leaving an orphan GPU job.
	control := make(chan error, 1)
	var receiving atomic.Bool
	go func() {
		var ack receipt
		err := readExpected(channel, "received", &ack)
		if err == nil && (!receiving.Load() || ack.JobID != request.ID) {
			err = errors.New("unexpected completion receipt")
		}
		if err != nil {
			cancelJob()
		}
		control <- err
	}()
	// Heartbeats describe liveness, not model progress or GPU utilization.
	heartbeatStop, heartbeatDone := make(chan struct{}), make(chan struct{})
	go func() {
		defer close(heartbeatDone)
		ticker := time.NewTicker(2 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-heartbeatStop:
				return
			case <-jobCtx.Done():
				return
			case <-ticker.C:
				conn.SetWriteDeadline(time.Now().Add(15 * time.Second))
				if channel.Send("status", Status{State: "working", Message: "Worker is processing the approved job; model progress is not inferred"}) != nil {
					cancelJob()
					return
				}
			}
		}
	}()
	heartbeatEnded := false
	stopHeartbeat := func() {
		if !heartbeatEnded {
			close(heartbeatStop)
			<-heartbeatDone
			heartbeatEnded = true
		}
	}
	defer stopHeartbeat()
	limit := opts.Config.MaxOutputBytes
	if limit > MaxOutputBytes || limit <= 0 {
		limit = MaxOutputBytes
	}
	stopOutputWatch, outputWatchDone := watchOutput(jobCtx, outputDir, limit, cancelJob)
	result, runErr := run(jobCtx, opts.Config, training.Job{ID: request.ID, Device: request.Device, Epochs: request.Epochs, BatchSize: request.BatchSize, LearningRate: request.LearningRate}, inputFile, outputDir)
	stopOutputWatch()
	if watchErr := <-outputWatchDone; watchErr != nil {
		runErr = watchErr
		result.Log = watchErr.Error() + "\n" + result.Log
		if len(result.Log) > training.MaxLogBytes {
			result.Log = result.Log[:training.MaxLogBytes]
			result.LogTruncated = true
		}
	}
	// Keep bounded diagnostics on the receiving PC even for failed/cancelled jobs.
	if err := writeLocalReport(jobDir, result); err != nil {
		stopHeartbeat()
		return fail("could not save the local job report")
	}
	if runErr != nil || jobCtx.Err() != nil {
		stopHeartbeat()
		return fail("training failed or was cancelled; inspect the receiving PC's job log")
	}
	files, err := collectArtifacts(outputDir, limit)
	stopHeartbeat()
	if err != nil {
		return fail("outputs exceeded limits or contained an unsafe file")
	}
	if jobCtx.Err() != nil {
		return fail("job was cancelled while preparing its outputs")
	}
	// Detailed logs stay on the worker; paths/dataset contents are not automatically sent.
	result.Log = ""
	conn.SetWriteDeadline(time.Now().Add(10 * time.Minute))
	if err := channel.Send("result", Outcome{JobID: request.ID, Runtime: result, Files: files}); err != nil {
		return err
	}
	for _, file := range files {
		if err := sendFile(channel, filepath.Join(outputDir, filepath.FromSlash(file.Path)), file.Size, file.SHA256); err != nil {
			return err
		}
	}
	receiving.Store(true)
	if err := channel.Send("complete", receipt{JobID: request.ID}); err != nil {
		return err
	}
	conn.SetReadDeadline(time.Now().Add(30 * time.Second))
	select {
	case err := <-control:
		return err
	case <-ctx.Done():
		return ctx.Err()
	}
}

// Submit never uploads executable code. It requests the owner's preinstalled profile.
// outDir must be new; partial results remain explicitly marked after a failure.
func Submit(ctx context.Context, conn net.Conn, request Request, inputFile, outDir string, progress func(Status)) (outcome Outcome, err error) {
	defer conn.Close()
	stop := bindContext(ctx, conn)
	defer stop()
	if err = request.Validate(); err != nil {
		return outcome, err
	}
	if !filepath.IsAbs(outDir) {
		return outcome, errors.New("result directory must be absolute")
	}
	if err = os.Mkdir(outDir, 0700); err != nil {
		return outcome, errors.New("choose a result directory that does not already exist")
	}
	marker := filepath.Join(outDir, "INCOMPLETE.txt")
	if err = os.WriteFile(marker, []byte("Transfer is incomplete. Do not use these files as a successful training result.\n"), 0600); err != nil {
		return outcome, err
	}
	channel := NewChannel(conn)
	conn.SetDeadline(time.Now().Add(2 * time.Minute))
	if err = channel.Send("job", request); err != nil {
		return outcome, err
	}
	for {
		var frame Frame
		frame, err = channel.Read()
		if err != nil {
			return outcome, err
		}
		if frame.Type != "status" {
			if frame.Type == "error" {
				var s Status
				if err = Decode(frame, "error", &s); err == nil {
					err = errors.New(s.Message)
				}
				return outcome, err
			}
			var ready receipt
			if err = Decode(frame, "ready", &ready); err != nil {
				return outcome, err
			}
			if ready.JobID != request.ID {
				return outcome, errors.New("worker returned a different job identity")
			}
			break
		}
		var status Status
		if err = Decode(frame, "status", &status); err != nil {
			return outcome, err
		}
		if progress != nil {
			progress(status)
		}
	}
	conn.SetDeadline(time.Now().Add(10 * time.Minute))
	if request.Input != nil {
		if err = sendFile(channel, inputFile, request.Input.Size, request.Input.SHA256); err != nil {
			return outcome, err
		}
	}
	conn.SetWriteDeadline(time.Time{})
	for {
		// Heartbeats arrive every two seconds while the worker runs/probes.
		conn.SetReadDeadline(time.Now().Add(45 * time.Second))
		var frame Frame
		frame, err = channel.Read()
		if err != nil {
			return outcome, err
		}
		if frame.Type == "status" {
			var status Status
			if err = Decode(frame, "status", &status); err != nil {
				return outcome, err
			}
			if progress != nil {
				progress(status)
			}
			continue
		}
		if frame.Type == "error" {
			var s Status
			if err = Decode(frame, "error", &s); err == nil {
				err = errors.New(s.Message)
			}
			return outcome, err
		}
		if err = Decode(frame, "result", &outcome); err != nil {
			return outcome, err
		}
		break
	}
	if outcome.JobID != request.ID {
		return outcome, errors.New("result job identity mismatch")
	}
	if err = validateArtifacts(outcome.Files, MaxOutputBytes); err != nil {
		return outcome, err
	}
	conn.SetDeadline(time.Now().Add(10 * time.Minute))
	for _, file := range outcome.Files {
		path := filepath.Join(outDir, filepath.FromSlash(file.Path))
		if err = os.MkdirAll(filepath.Dir(path), 0700); err != nil {
			return outcome, err
		}
		if err = receiveFile(channel, path, file.Size, file.SHA256); err != nil {
			return outcome, err
		}
	}
	var completed receipt
	if err = readExpected(channel, "complete", &completed); err != nil {
		return outcome, err
	}
	if completed.JobID != request.ID {
		return outcome, errors.New("completion job identity mismatch")
	}
	if err = channel.Send("received", receipt{JobID: request.ID}); err != nil {
		return outcome, err
	}
	if err = writeJSONExclusive(filepath.Join(outDir, "job-result.json"), outcome); err != nil {
		return outcome, err
	}
	// The success marker replaces INCOMPLETE only after all verified artifacts and report exist.
	err = os.Rename(marker, filepath.Join(outDir, "TRANSFER-COMPLETE.txt"))
	if err == nil {
		err = os.WriteFile(filepath.Join(outDir, "TRANSFER-COMPLETE.txt"), []byte("Artifact transfer completed and SHA-256 checks passed. This does not certify model quality or honest remote computation.\n"), 0600)
	}
	return outcome, err
}
