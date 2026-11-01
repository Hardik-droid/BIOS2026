//go:build compute_experiment

// This command is deliberately separate from localfirst-offline.
package main

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"net"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"time"

	"localfirst/internal/computeexp"
	training "localfirst/internal/computeexp/runtime"
	"localfirst/internal/nearby"
)

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	defer stop()
	if err := run(ctx, os.Args[1:], os.Stdin, os.Stdout); err != nil {
		fmt.Fprintln(os.Stderr, "LocalFirst compute:", err)
		os.Exit(1)
	}
}

func run(ctx context.Context, args []string, input io.Reader, output io.Writer) error {
	if len(args) == 0 {
		return usage(output)
	}
	switch args[0] {
	case "devices":
		if len(args) != 1 {
			return errors.New("devices takes no arguments")
		}
		devices, err := nearby.PairedDevices()
		if err != nil {
			return err
		}
		return json.NewEncoder(output).Encode(devices)
	case "probe":
		return probe(ctx, args[1:], output)
	case "worker":
		return worker(ctx, args[1:], input, output)
	case "submit":
		return submit(ctx, args[1:], output)
	case "help", "-h", "--help":
		return usage(output)
	default:
		return errors.New("unknown command; use help")
	}
}

func usage(output io.Writer) error {
	_, err := fmt.Fprintln(output, `LocalFirst compute experiment — Bluetooth-only, one approved training job

  devices
  probe  -profile C:\path\worker-profile.json
  worker -profile C:\path\worker-profile.json -invite-out C:\path\invite.txt [-work-dir C:\path\jobs]
  submit -address 001122AABBCC -invite-file C:\path\invite.txt -job C:\path\job.json -out C:\path\new-results [-input C:\path\small-data.bin]

Worker and sender must already be paired in Windows. Transfer the invitation
privately. The worker asks for local approval, runs one hash-pinned local script,
returns bounded artifacts, then exits. Ctrl+C cancels the job. No LAN listener,
cloud account, shared GPU memory, screen streaming, or zero-latency guarantee.

This experimental companion does not start, upgrade, or stop the office app.
See experiments/compute-sharing/README.md for setup, limits and acceptance steps.`)
	return err
}

func flags(name string) *flag.FlagSet {
	f := flag.NewFlagSet(name, flag.ContinueOnError)
	return f
}

func probe(ctx context.Context, args []string, out io.Writer) error {
	f := flags("probe")
	profile := f.String("profile", "", "absolute path to owner-selected worker profile")
	if err := f.Parse(args); err != nil {
		return err
	}
	if f.NArg() != 0 || *profile == "" {
		return errors.New("probe requires -profile and no positional arguments")
	}
	config, err := training.LoadConfig(*profile)
	if err != nil {
		return err
	}
	probeCtx, cancel := context.WithTimeout(ctx, 90*time.Second)
	defer cancel()
	capability, err := training.Probe(probeCtx, config)
	if err != nil {
		return err
	}
	return json.NewEncoder(out).Encode(capability)
}

func worker(ctx context.Context, args []string, input io.Reader, out io.Writer) error {
	f := flags("worker")
	profile := f.String("profile", "", "absolute path to a trusted pinned script profile")
	invitationFile := f.String("invite-out", "", "new private invitation file (never overwritten)")
	workDir := f.String("work-dir", "", "job storage (default: local application data/LocalFirstCompute/jobs)")
	if err := f.Parse(args); err != nil {
		return err
	}
	if f.NArg() != 0 || *profile == "" || *invitationFile == "" {
		return errors.New("worker requires -profile and -invite-out")
	}
	if !filepath.IsAbs(*invitationFile) {
		return errors.New("invitation output path must be absolute")
	}
	config, err := training.LoadConfig(*profile)
	if err != nil {
		return err
	}
	if *workDir == "" {
		base, err := os.UserCacheDir()
		if err != nil {
			return err
		}
		*workDir = filepath.Join(base, "LocalFirstCompute", "jobs")
	}
	if !filepath.IsAbs(*workDir) {
		return errors.New("work directory must be absolute")
	}
	identity, err := computeexp.NewIdentity()
	if err != nil {
		return err
	}
	listener, err := nearby.ListenService(computeexp.ServiceID, "LocalFirst approved training experiment")
	if err != nil {
		return err
	}
	defer listener.Close()
	invitation, err := os.OpenFile(*invitationFile, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return errors.New("could not create invitation file; choose a new private path")
	}
	_, writeErr := fmt.Fprintln(invitation, identity.Invitation)
	closeErr := invitation.Close()
	if writeErr != nil {
		return writeErr
	}
	if closeErr != nil {
		return closeErr
	}
	fmt.Fprintln(out, "Experimental worker is listening on Bluetooth only. Office app unchanged.")
	fmt.Fprintln(out, "Private invitation written to", *invitationFile, "(expires in ten minutes).")
	fmt.Fprintln(out, "Profile:", filepath.Base(config.Script), "SHA-256:", config.ScriptSHA256)
	fmt.Fprintln(out, "Job files will be retained under", *workDir)
	fmt.Fprintln(out, "Only approve a sender you trust. The worker sees the training data and model.")
	sessionCtx, cancel := context.WithDeadline(ctx, identity.Expires)
	defer cancel()
	go func() { <-sessionCtx.Done(); listener.Close() }()
	var secure net.Conn
	for attempts := 0; attempts < 3; attempts++ {
		raw, err := listener.Accept()
		if err != nil {
			return errors.New("worker invitation expired, was cancelled, or Bluetooth became unavailable")
		}
		secure, err = computeexp.AcceptSecure(sessionCtx, raw, identity)
		if err == nil {
			break
		}
		fmt.Fprintln(out, "Connection rejected: authentication failed.")
	}
	if secure == nil {
		return errors.New("authentication attempt limit reached; restart to generate a new invitation")
	}
	defer secure.Close()
	// End advertising after one authenticated connection. Its running job gets
	// its own timeout; the invitation's ten minutes apply only to connection setup.
	listener.Close()
	fmt.Fprintln(out, "Authenticated Bluetooth peer:", secure.RemoteAddr())
	reader := bufio.NewReader(input)
	approval := func(approvalCtx context.Context, request computeexp.Request) (bool, error) {
		fmt.Fprintf(out, "\nRequested job %s: device=%s epochs=%d batch=%d learning-rate=%g\n", request.ID, request.Device, request.Epochs, request.BatchSize, request.LearningRate)
		if request.Input != nil {
			fmt.Fprintf(out, "Optional input: %d bytes; SHA-256 %s\n", request.Input.Size, request.Input.SHA256)
		}
		fmt.Fprintf(out, "Type APPROVE %s on this PC to run (90 seconds); anything else rejects:\n", request.ID)
		answer := make(chan string, 1)
		go func() { line, _ := reader.ReadString('\n'); answer <- strings.TrimSpace(line) }()
		select {
		case <-approvalCtx.Done():
			return false, approvalCtx.Err()
		case line := <-answer:
			return line == "APPROVE "+request.ID, nil
		}
	}
	return computeexp.Serve(ctx, secure, computeexp.WorkerOptions{Config: config, WorkDir: *workDir, Approve: approval})
}

func submit(ctx context.Context, args []string, out io.Writer) error {
	f := flags("submit")
	address := f.String("address", "", "paired receiving PC's Bluetooth address")
	inviteFile := f.String("invite-file", "", "private invitation file from worker")
	jobFile := f.String("job", "", "numeric parameters and pinned script SHA-256")
	resultDir := f.String("out", "", "new absolute directory for results")
	inputPath := f.String("input", "", "optional data file up to 32 MiB; never executed")
	timeout := f.Duration("timeout", 24*time.Hour, "total job deadline, at most 24h")
	if err := f.Parse(args); err != nil {
		return err
	}
	if f.NArg() != 0 || *address == "" || *inviteFile == "" || *jobFile == "" || !filepath.IsAbs(*resultDir) || *timeout <= 0 || *timeout > 24*time.Hour {
		return errors.New("submit requires -address, -invite-file, -job and a new absolute -out directory; timeout must be positive and at most 24h")
	}
	request, err := computeexp.ReadJobSpec(*jobFile)
	if err != nil {
		return err
	}
	if *inputPath != "" {
		manifest, err := computeexp.HashFile(*inputPath, computeexp.MaxInputBytes)
		if err != nil {
			return err
		}
		request.Input = &manifest
	}
	fh, err := os.Open(*inviteFile)
	if err != nil {
		return err
	}
	data, readErr := io.ReadAll(io.LimitReader(fh, 257))
	fh.Close()
	if readErr != nil || len(data) > 256 {
		return errors.New("invalid invitation file")
	}
	jobCtx, cancel := context.WithTimeout(ctx, *timeout)
	defer cancel()
	dialCtx, cancelDial := context.WithTimeout(jobCtx, 20*time.Second)
	raw, err := nearby.DialService(dialCtx, *address, computeexp.ServiceID)
	cancelDial()
	if err != nil {
		return err
	}
	secure, err := computeexp.DialSecure(jobCtx, raw, strings.TrimSpace(string(data)))
	if err != nil {
		return err
	}
	fmt.Fprintln(out, "Connected to pinned worker over Bluetooth. Job:", request.ID)
	last := ""
	result, err := computeexp.Submit(jobCtx, secure, request, *inputPath, *resultDir, func(status computeexp.Status) {
		if status.State != last {
			fmt.Fprintln(out, status.State+":", status.Message)
			last = status.State
		}
	})
	if err != nil {
		return err
	}
	fmt.Fprintf(out, "Verified transfer: %d artifact(s), process exit %d, elapsed %d ms. Results: %s\n", len(result.Files), result.Runtime.ExitCode, result.Runtime.DurationMS, *resultDir)
	fmt.Fprintln(out, "Transfer integrity is not proof of model quality or an honest worker. Checkpoints are not automatically loaded.")
	return nil
}
