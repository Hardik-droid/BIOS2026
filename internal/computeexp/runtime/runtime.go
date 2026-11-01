//go:build compute_experiment

// Package runtime launches an owner-selected, hash-pinned local PyTorch script.
// It is an opt-in experiment. The script runs with the worker owner's privileges;
// thread settings and device selection are not an operating-system sandbox.
package runtime

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"os"
	"os/exec"
	"path/filepath"
	stdruntime "runtime"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	MaxLogBytes    = 256 << 10
	maxConfigBytes = 64 << 10
	maxScriptBytes = 8 << 20
	probePrefix    = "LOCALFIRST_RUNTIME_PROBE_V1:"
)

type Config struct {
	Python           string   `json:"python"`
	Script           string   `json:"script"`
	ScriptSHA256     string   `json:"script_sha256"`
	Args             []string `json:"args"`
	WorkingDirectory string   `json:"working_directory"`
	MaxSeconds       int      `json:"max_seconds"`
	CPUThreads       int      `json:"cpu_threads"`
	MaxOutputBytes   int64    `json:"max_output_bytes"`
}

type Job struct {
	ID           string  `json:"id"`
	Device       string  `json:"device"`
	Epochs       int     `json:"epochs"`
	BatchSize    int     `json:"batch_size"`
	LearningRate float64 `json:"learning_rate"`
}

type Result struct {
	ExitCode     int    `json:"exit_code"`
	DurationMS   int64  `json:"duration_ms"`
	Log          string `json:"log"`
	LogTruncated bool   `json:"log_truncated"`
}

type Capability struct {
	PythonVersion string `json:"python_version"`
	TorchVersion  string `json:"torch_version"`
	CPUReady      bool   `json:"cpu_ready"`
	CUDAReady     bool   `json:"cuda_ready"`
	GPUName       string `json:"gpu_name"`
	Error         string `json:"error,omitempty"`
}

// LoadConfig reads only an explicit local owner configuration. Unknown fields,
// extra JSON values, and oversized configurations are rejected.
func LoadConfig(path string) (Config, error) {
	var config Config
	f, err := os.Open(path)
	if err != nil {
		return config, fmt.Errorf("open runtime configuration: %w", err)
	}
	defer f.Close()
	data, err := io.ReadAll(io.LimitReader(f, maxConfigBytes+1))
	if err != nil {
		return config, fmt.Errorf("read runtime configuration: %w", err)
	}
	if len(data) > maxConfigBytes {
		return config, errors.New("runtime configuration exceeds 64 KiB")
	}
	decoder := json.NewDecoder(strings.NewReader(string(data)))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&config); err != nil {
		return config, fmt.Errorf("invalid runtime configuration: %w", err)
	}
	if err := decoder.Decode(new(any)); err != io.EOF {
		return config, errors.New("runtime configuration must contain one JSON object")
	}
	if err := ValidateConfig(config); err != nil {
		return config, err
	}
	return config, nil
}

func ValidateConfig(config Config) error {
	if err := regularAbsoluteFile(config.Python); err != nil {
		return fmt.Errorf("python must be an absolute path to a real interpreter: %w", err)
	}
	if stdruntime.GOOS == "windows" {
		if !strings.EqualFold(filepath.Ext(config.Python), ".exe") {
			return errors.New("python must refer to a local .exe interpreter")
		}
		normalized := strings.ToLower(strings.ReplaceAll(config.Python, "/", "\\"))
		if strings.Contains(normalized, "\\microsoft\\windowsapps\\") {
			return errors.New("WindowsApps execution aliases are not training interpreters")
		}
	}
	if !strings.EqualFold(filepath.Ext(config.Script), ".py") {
		return errors.New("the trusted training script must be a .py file")
	}
	if err := regularAbsoluteFile(config.Script); err != nil {
		return fmt.Errorf("invalid trusted training script: %w", err)
	}
	if err := existingAbsoluteDirectory(config.WorkingDirectory); err != nil {
		return fmt.Errorf("invalid owner working directory: %w", err)
	}
	if config.MaxSeconds < 1 || config.MaxSeconds > 86400 {
		return errors.New("max_seconds must be between 1 and 86400")
	}
	threadLimit := min(stdruntime.NumCPU(), 64)
	if config.CPUThreads < 1 || config.CPUThreads > threadLimit {
		return fmt.Errorf("cpu_threads must be between 1 and %d", threadLimit)
	}
	if config.MaxOutputBytes < 1 || config.MaxOutputBytes > 1<<30 {
		return errors.New("max_output_bytes must be between 1 and 1073741824")
	}
	if len(config.Args) > 128 {
		return errors.New("at most 128 trusted argument templates are allowed")
	}
	argBytes := 0
	for _, arg := range config.Args {
		argBytes += len(arg)
		if len(arg) > 4096 || argBytes > 32768 || strings.ContainsRune(arg, 0) {
			return errors.New("trusted argument templates exceed supported length")
		}
		if err := validateTemplate(arg); err != nil {
			return err
		}
	}
	return verifyScript(config)
}

func regularAbsoluteFile(path string) error {
	if path == "" || !filepath.IsAbs(path) || strings.ContainsRune(path, 0) {
		return errors.New("an absolute file path is required")
	}
	info, err := os.Stat(path)
	if err != nil {
		return err
	}
	if !info.Mode().IsRegular() || info.Size() == 0 {
		return errors.New("the path must be a nonempty regular file")
	}
	return nil
}

func existingAbsoluteDirectory(path string) error {
	if path == "" || !filepath.IsAbs(path) || strings.ContainsRune(path, 0) {
		return errors.New("an absolute directory path is required")
	}
	info, err := os.Stat(path)
	if err != nil {
		return err
	}
	if !info.IsDir() {
		return errors.New("the path is not a directory")
	}
	return nil
}

func verifyScript(config Config) error {
	pin, err := hex.DecodeString(config.ScriptSHA256)
	if err != nil || len(pin) != sha256.Size || len(config.ScriptSHA256) != 64 {
		return errors.New("script_sha256 must contain the owner's 64 hexadecimal SHA-256 pin")
	}
	f, err := os.Open(config.Script)
	if err != nil {
		return fmt.Errorf("open trusted training script: %w", err)
	}
	defer f.Close()
	hasher := sha256.New()
	n, err := io.Copy(hasher, io.LimitReader(f, maxScriptBytes+1))
	if err != nil {
		return fmt.Errorf("hash trusted training script: %w", err)
	}
	if n > maxScriptBytes {
		return errors.New("trusted training script exceeds 8 MiB")
	}
	if !strings.EqualFold(hex.EncodeToString(hasher.Sum(nil)), config.ScriptSHA256) {
		return errors.New("trusted training script changed: SHA-256 pin does not match")
	}
	return nil
}

var placeholderNames = []string{"device", "epochs", "batch_size", "learning_rate", "input", "output"}

func validateTemplate(template string) error {
	for _, name := range placeholderNames {
		template = strings.ReplaceAll(template, "{"+name+"}", "")
	}
	if strings.ContainsAny(template, "{}") {
		return errors.New("unknown argument placeholder; allowed: {device}, {epochs}, {batch_size}, {learning_rate}, {input}, {output}")
	}
	return nil
}

func validateJob(job Job) error {
	if len(job.ID) < 1 || len(job.ID) > 128 {
		return errors.New("job ID must contain 1 to 128 letters, digits, hyphens or underscores")
	}
	for _, c := range job.ID {
		if !(c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9' || c == '-' || c == '_') {
			return errors.New("invalid job ID")
		}
	}
	if job.Device != "cpu" && job.Device != "cuda" {
		return errors.New("device must be cpu or cuda")
	}
	if job.Epochs < 1 || job.Epochs > 10000 {
		return errors.New("epochs must be between 1 and 10000")
	}
	if job.BatchSize < 1 || job.BatchSize > 65536 {
		return errors.New("batch_size must be between 1 and 65536")
	}
	if math.IsNaN(job.LearningRate) || math.IsInf(job.LearningRate, 0) || job.LearningRate <= 0 || job.LearningRate > 10 {
		return errors.New("learning_rate must be finite, greater than zero and at most 10")
	}
	return nil
}

func expandArgs(config Config, job Job, inputFile, outputDir string) []string {
	replacer := strings.NewReplacer(
		"{device}", job.Device,
		"{epochs}", strconv.Itoa(job.Epochs),
		"{batch_size}", strconv.Itoa(job.BatchSize),
		"{learning_rate}", strconv.FormatFloat(job.LearningRate, 'g', -1, 64),
		"{input}", inputFile,
		"{output}", outputDir,
	)
	args := make([]string, len(config.Args))
	for i, arg := range config.Args {
		args[i] = replacer.Replace(arg)
	}
	return args
}

// Probe imports the installed local PyTorch and executes a tiny optimizer step
// on CPU and, if available, CUDA. GPU discovery alone never makes CUDAReady true.
// An unavailable framework/device is reported in Capability.Error; process or
// protocol failures also return an error.
func Probe(ctx context.Context, config Config) (Capability, error) {
	var capability Capability
	if err := ValidateConfig(config); err != nil {
		return capability, err
	}
	ctx, cancel := context.WithTimeout(ctx, time.Duration(min(config.MaxSeconds, 30))*time.Second)
	defer cancel()
	stdout := &cappedWriter{limit: 64 << 10}
	stderr := &cappedWriter{limit: 64 << 10}
	cmd := exec.Command(config.Python, "-I", "-u", "-c", probeScript, strconv.Itoa(config.CPUThreads))
	cmd.Dir = config.WorkingDirectory
	cmd.Env = workerEnvironment(config.CPUThreads, "", "")
	cmd.Stdout, cmd.Stderr = stdout, stderr
	result, err := execute(ctx, cmd)
	if err != nil {
		capability.Error = limitText(stderr.String(), 2048)
		return capability, fmt.Errorf("training runtime probe failed (exit %d): %w", result.ExitCode, err)
	}
	var payload string
	for _, line := range strings.Split(stdout.String(), "\n") {
		if strings.HasPrefix(line, probePrefix) {
			if payload != "" {
				return capability, errors.New("training runtime returned duplicate probe responses")
			}
			payload = strings.TrimPrefix(line, probePrefix)
		}
	}
	if payload == "" || stdout.Truncated() {
		return capability, errors.New("training runtime returned no bounded probe response")
	}
	decoder := json.NewDecoder(strings.NewReader(payload))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&capability); err != nil {
		return capability, fmt.Errorf("invalid training runtime probe response: %w", err)
	}
	if err := decoder.Decode(new(any)); err != io.EOF {
		return Capability{}, errors.New("invalid trailing training runtime probe response")
	}
	if capability.PythonVersion == "" || capability.CUDAReady && !capability.CPUReady || (capability.CPUReady && capability.TorchVersion == "") {
		return Capability{}, errors.New("inconsistent training runtime probe response")
	}
	capability.Error = limitText(capability.Error, 2048)
	return capability, nil
}

// Run never downloads a runtime or executes requester-supplied source/arguments.
// The owner configures the trusted script and argument templates locally. Output
// artifact quotas must also be checked by the caller before returning artifacts;
// this adapter does not claim a hard disk/RAM/CPU/VRAM sandbox.
// The trusted script must honor {device} or LOCALFIRST_DEVICE; the adapter probes
// availability but cannot certify the device used by arbitrary trusted code.
func Run(ctx context.Context, config Config, job Job, inputFile, outputDir string) (result Result, err error) {
	started := time.Now()
	result = Result{ExitCode: -1}
	defer func() {
		result.DurationMS = time.Since(started).Milliseconds()
		if err != nil && result.Log == "" {
			diagnostic := err.Error()
			result.Log = limitText(diagnostic, MaxLogBytes)
			result.LogTruncated = len(diagnostic) > MaxLogBytes
		}
	}()
	if err := ValidateConfig(config); err != nil {
		return result, err
	}
	if err := validateJob(job); err != nil {
		return result, err
	}
	// Empty means the approved local script uses an owner-preprovisioned
	// dataset. Uploaded inputs may legitimately be zero-byte regular files.
	if inputFile != "" {
		if err := existingAbsoluteInput(inputFile); err != nil {
			return result, fmt.Errorf("invalid locally staged job input: %w", err)
		}
	}
	if err := existingAbsoluteDirectory(outputDir); err != nil {
		return result, fmt.Errorf("invalid job output directory: %w", err)
	}
	ctx, cancel := context.WithTimeout(ctx, time.Duration(config.MaxSeconds)*time.Second)
	defer cancel()
	capability, err := Probe(ctx, config)
	if err != nil {
		result.Log = capability.Error
		return result, err
	}
	if !capability.CPUReady || job.Device == "cuda" && !capability.CUDAReady {
		return result, fmt.Errorf("requested %s training runtime is unavailable: %s", job.Device, capability.Error)
	}
	if err := verifyScript(config); err != nil {
		return result, err
	}
	args := []string{"-I", "-u", "-c", runScript, config.Script, strings.ToLower(config.ScriptSHA256), strconv.Itoa(config.CPUThreads), job.Device}
	args = append(args, expandArgs(config, job, inputFile, outputDir)...)
	cmd := exec.Command(config.Python, args...)
	cmd.Dir = config.WorkingDirectory
	cmd.Env = workerEnvironment(config.CPUThreads, job.Device, job.ID)
	logs := &cappedWriter{limit: MaxLogBytes}
	cmd.Stdout, cmd.Stderr = logs, logs
	result, err = execute(ctx, cmd)
	result.Log, result.LogTruncated = logs.String(), logs.Truncated()
	return result, err
}

func existingAbsoluteInput(path string) error {
	if !filepath.IsAbs(path) || strings.ContainsRune(path, 0) {
		return errors.New("an absolute input file path is required")
	}
	info, err := os.Stat(path)
	if err != nil {
		return err
	}
	if !info.Mode().IsRegular() {
		return errors.New("the input must be a regular file")
	}
	return nil
}

func workerEnvironment(threads int, device, jobID string) []string {
	// Python's -I ignores PYTHON* settings. Remove them as well, so any trusted
	// child interpreter does not inherit accidental module injection settings.
	blocked := map[string]bool{"OMP_NUM_THREADS": true, "MKL_NUM_THREADS": true, "OPENBLAS_NUM_THREADS": true, "NUMEXPR_NUM_THREADS": true, "LOCALFIRST_DEVICE": true, "LOCALFIRST_JOB_ID": true}
	if device == "cpu" {
		blocked["CUDA_VISIBLE_DEVICES"] = true
	}
	env := make([]string, 0, len(os.Environ())+8)
	for _, entry := range os.Environ() {
		key, _, _ := strings.Cut(entry, "=")
		upper := strings.ToUpper(key)
		if !blocked[upper] && !strings.HasPrefix(upper, "PYTHON") {
			env = append(env, entry)
		}
	}
	for _, key := range []string{"OMP_NUM_THREADS", "MKL_NUM_THREADS", "OPENBLAS_NUM_THREADS", "NUMEXPR_NUM_THREADS"} {
		env = append(env, key+"="+strconv.Itoa(threads))
	}
	if device == "cpu" {
		env = append(env, "CUDA_VISIBLE_DEVICES=")
	}
	if device != "" {
		env = append(env, "LOCALFIRST_DEVICE="+device)
	}
	if jobID != "" {
		env = append(env, "LOCALFIRST_JOB_ID="+jobID)
	}
	return env
}

func execute(ctx context.Context, cmd *exec.Cmd) (Result, error) {
	result := Result{ExitCode: -1}
	started := time.Now()
	if err := ctx.Err(); err != nil {
		return result, err
	}
	// A descendant retaining stdout cannot keep Wait blocked indefinitely after
	// its parent exits. Closing the managed job then terminates that descendant.
	cmd.WaitDelay = 250 * time.Millisecond
	kill, closeManaged, err := startManaged(cmd)
	if err != nil {
		return result, err
	}
	defer closeManaged()
	done := make(chan error, 1)
	go func() { done <- cmd.Wait() }()
	select {
	case err = <-done:
	case <-ctx.Done():
		killErr := kill()
		<-done
		err = ctx.Err()
		if killErr != nil {
			err = errors.Join(err, fmt.Errorf("terminate training process tree: %w", killErr))
		}
	}
	if cmd.ProcessState != nil {
		result.ExitCode = cmd.ProcessState.ExitCode()
	}
	result.DurationMS = time.Since(started).Milliseconds()
	return result, err
}

type cappedWriter struct {
	mu        sync.Mutex
	limit     int
	data      []byte
	truncated bool
}

func (w *cappedWriter) Write(p []byte) (int, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	remaining := max(0, w.limit-len(w.data))
	w.data = append(w.data, p[:min(len(p), remaining)]...)
	if len(p) > remaining {
		w.truncated = true
	}
	return len(p), nil // Continue draining excess output without growing memory.
}

func (w *cappedWriter) String() string {
	w.mu.Lock()
	defer w.mu.Unlock()
	return string(w.data)
}

func (w *cappedWriter) Truncated() bool {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.truncated
}

func limitText(value string, limit int) string {
	if len(value) > limit {
		return value[:limit]
	}
	return value
}

const probeScript = `import sys, json
cap = {"python_version": sys.version.split()[0], "torch_version": "", "cpu_ready": False, "cuda_ready": False, "gpu_name": "", "error": ""}
errors = []
def step(torch, device):
    model = torch.nn.Linear(2, 1, device=device)
    optimizer = torch.optim.SGD(model.parameters(), lr=0.01)
    x = torch.ones((2, 2), device=device)
    target = torch.zeros((2, 1), device=device)
    optimizer.zero_grad()
    loss = (model(x) - target).square().mean()
    loss.backward()
    optimizer.step()
    if device == "cuda":
        torch.cuda.synchronize()
    if not bool(torch.isfinite(loss).item()):
        raise RuntimeError("non-finite tensor probe")
try:
    import torch
    cap["torch_version"] = str(torch.__version__)
    torch.set_num_threads(int(sys.argv[1]))
    try:
        step(torch, "cpu")
        cap["cpu_ready"] = True
    except Exception as exc:
        errors.append("CPU tensor training probe: " + str(exc)[:700])
    if cap["cpu_ready"]:
        try:
            if not torch.cuda.is_available():
                errors.append("CUDA is unavailable in the installed PyTorch runtime")
            else:
                step(torch, "cuda")
                cap["gpu_name"] = str(torch.cuda.get_device_name(0))
                cap["cuda_ready"] = True
        except Exception as exc:
            errors.append("CUDA tensor training probe: " + str(exc)[:700])
except Exception as exc:
    errors.append("PyTorch import/runtime: " + str(exc)[:700])
cap["error"] = "; ".join(errors)
print("LOCALFIRST_RUNTIME_PROBE_V1:" + json.dumps(cap), flush=True)
`

const runScript = `import sys, os, hashlib, types
script, expected, threads, device = sys.argv[1:5]
with open(script, "rb") as handle:
    source = handle.read(8388609)
if len(source) > 8388608 or hashlib.sha256(source).hexdigest() != expected:
    raise RuntimeError("Trusted training script changed: SHA-256 pin does not match")
import torch
torch.set_num_threads(int(threads))
if device == "cuda":
    if not torch.cuda.is_available():
        raise RuntimeError("Requested CUDA runtime became unavailable; refusing CPU fallback")
    torch.cuda.set_device(0)
os.environ["LOCALFIRST_DEVICE"] = device
sys.argv = [script] + sys.argv[5:]
sys.path.insert(0, os.path.dirname(script))
main = types.ModuleType("__main__")
main.__file__ = script
main.__package__ = None
main.__spec__ = None
main.__loader__ = None
main.__cached__ = None
main.__dict__["__builtins__"] = __builtins__
sys.modules["__main__"] = main
exec(compile(source, script, "exec"), main.__dict__)
`
