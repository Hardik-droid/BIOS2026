//go:build compute_experiment

package runtime

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"os"
	"os/exec"
	"path/filepath"
	stdruntime "runtime"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"
)

func fixtureConfig(t *testing.T) Config {
	t.Helper()
	dir := t.TempDir()
	script := filepath.Join(dir, "trusted.py")
	source := []byte("print('owner-selected script')\n")
	if err := os.WriteFile(script, source, 0600); err != nil {
		t.Fatal(err)
	}
	interpreter, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	digest := sha256.Sum256(source)
	return Config{Python: interpreter, Script: script, ScriptSHA256: hex.EncodeToString(digest[:]), WorkingDirectory: dir, MaxSeconds: 10, CPUThreads: 1, MaxOutputBytes: 1 << 20, Args: []string{"--device={device}", "--epochs", "{epochs}", "--batch={batch_size}", "--rate={learning_rate}", "{input}", "{output}"}}
}

func TestConfigRejectsUntrustedExecutionChanges(t *testing.T) {
	config := fixtureConfig(t)
	if err := ValidateConfig(config); err != nil {
		t.Fatal(err)
	}
	tests := []struct {
		name string
		edit func(*Config)
	}{
		{"relative interpreter", func(c *Config) { c.Python = "python.exe" }},
		{"missing interpreter", func(c *Config) { c.Python = filepath.Join(t.TempDir(), "missing.exe") }},
		{"relative script", func(c *Config) { c.Script = "trusted.py" }},
		{"non Python script", func(c *Config) { c.Script = c.Python }},
		{"missing hash", func(c *Config) { c.ScriptSHA256 = "" }},
		{"wrong hash", func(c *Config) { c.ScriptSHA256 = strings.Repeat("0", 64) }},
		{"relative cwd", func(c *Config) { c.WorkingDirectory = "." }},
		{"cwd file", func(c *Config) { c.WorkingDirectory = c.Script }},
		{"zero timeout", func(c *Config) { c.MaxSeconds = 0 }},
		{"excessive timeout", func(c *Config) { c.MaxSeconds = 86401 }},
		{"zero threads", func(c *Config) { c.CPUThreads = 0 }},
		{"excessive threads", func(c *Config) { c.CPUThreads = min(stdruntime.NumCPU(), 64) + 1 }},
		{"zero output quota", func(c *Config) { c.MaxOutputBytes = 0 }},
		{"excessive output quota", func(c *Config) { c.MaxOutputBytes = 1<<30 + 1 }},
		{"unknown template", func(c *Config) { c.Args = []string{"{command}"} }},
		{"nested template", func(c *Config) { c.Args = []string{"{{device}}"} }},
		{"unmatched template", func(c *Config) { c.Args = []string{"x{input"} }},
		{"null argument", func(c *Config) { c.Args = []string{"x\x00"} }},
		{"too many args", func(c *Config) { c.Args = make([]string, 129) }},
		{"oversized arg", func(c *Config) { c.Args = []string{strings.Repeat("a", 4097)} }},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			candidate := config
			test.edit(&candidate)
			if err := ValidateConfig(candidate); err == nil {
				t.Fatal("unsafe configuration was accepted")
			}
		})
	}
}

func TestLoadConfigStrictJSON(t *testing.T) {
	config := fixtureConfig(t)
	data, err := json.Marshal(config)
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "runtime.json")
	for _, test := range []struct {
		name string
		data []byte
		ok   bool
	}{
		{"valid", data, true},
		{"extra value", append(append([]byte{}, data...), []byte(" {}")...), false},
		{"unknown field", []byte(strings.TrimSuffix(string(data), "}") + ",\"command\":\"unsafe\"}"), false},
		{"oversize", []byte(strings.Repeat(" ", maxConfigBytes+1)), false},
		{"null", []byte("null"), false},
	} {
		t.Run(test.name, func(t *testing.T) {
			if err := os.WriteFile(path, test.data, 0600); err != nil {
				t.Fatal(err)
			}
			_, err := LoadConfig(path)
			if (err == nil) != test.ok {
				t.Fatalf("LoadConfig error = %v, success wanted %v", err, test.ok)
			}
		})
	}
}

func TestScriptChangePreventsRunBeforeInterpreter(t *testing.T) {
	config := fixtureConfig(t)
	if err := os.WriteFile(config.Script, []byte("raise RuntimeError('changed')\n"), 0600); err != nil {
		t.Fatal(err)
	}
	_, err := Run(context.Background(), config, validJob(), config.Script, config.WorkingDirectory)
	if err == nil || !strings.Contains(err.Error(), "pin does not match") {
		t.Fatalf("changed script was not rejected by pin verification: %v", err)
	}
}

func validJob() Job {
	return Job{ID: "test-job_01", Device: "cpu", Epochs: 2, BatchSize: 8, LearningRate: 0.01}
}

func TestJobBoundsAndArgumentExpansion(t *testing.T) {
	config := fixtureConfig(t)
	job := validJob()
	if err := validateJob(job); err != nil {
		t.Fatal(err)
	}
	input := filepath.Join(config.WorkingDirectory, "input with spaces; $(literal).json")
	args := expandArgs(config, job, input, config.WorkingDirectory)
	want := []string{"--device=cpu", "--epochs", "2", "--batch=8", "--rate=0.01", input, config.WorkingDirectory}
	if fmt.Sprint(args) != fmt.Sprint(want) {
		t.Fatalf("argument expansion = %#v, wanted %#v", args, want)
	}
	for _, edit := range []func(*Job){
		func(j *Job) { j.ID = "../../outside" },
		func(j *Job) { j.ID = "" },
		func(j *Job) { j.Device = "cuda:0;anything" },
		func(j *Job) { j.Epochs = 0 },
		func(j *Job) { j.Epochs = 10001 },
		func(j *Job) { j.BatchSize = 0 },
		func(j *Job) { j.BatchSize = 65537 },
		func(j *Job) { j.LearningRate = math.NaN() },
		func(j *Job) { j.LearningRate = math.Inf(1) },
		func(j *Job) { j.LearningRate = 0 },
		func(j *Job) { j.LearningRate = 10.01 },
	} {
		candidate := job
		edit(&candidate)
		if err := validateJob(candidate); err == nil {
			t.Fatalf("invalid remote job accepted: %+v", candidate)
		}
	}
}

func TestLogLimitContinuesDraining(t *testing.T) {
	log := &cappedWriter{limit: 1024}
	var workers sync.WaitGroup
	for range 4 {
		workers.Go(func() {
			for range 100 {
				if n, err := log.Write([]byte(strings.Repeat("x", 128))); n != 128 || err != nil {
					t.Errorf("output was not drained: %d %v", n, err)
				}
			}
		})
	}
	workers.Wait()
	if len(log.String()) != 1024 || !log.Truncated() {
		t.Fatalf("incorrect log bounds: %d, truncated %v", len(log.String()), log.Truncated())
	}
}

func helperCommand(t *testing.T, mode string, args ...string) *exec.Cmd {
	t.Helper()
	commandArgs := append([]string{"-test.run=^TestRuntimeHelperProcess$", "--", mode}, args...)
	cmd := exec.Command(os.Args[0], commandArgs...)
	cmd.Env = append(os.Environ(), "LOCALFIRST_RUNTIME_TEST_HELPER=1")
	return cmd
}

func TestManagedProcessDrainsAndCapsLogs(t *testing.T) {
	cmd := helperCommand(t, "spam")
	logs := &cappedWriter{limit: MaxLogBytes}
	cmd.Stdout, cmd.Stderr = logs, logs
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	result, err := execute(ctx, cmd)
	if err != nil || result.ExitCode != 0 {
		t.Fatalf("bounded logger interrupted process: %+v, %v", result, err)
	}
	if len(logs.String()) != MaxLogBytes || !logs.Truncated() {
		t.Fatalf("process log was not capped: %d, %v", len(logs.String()), logs.Truncated())
	}
}

func TestManagedProcessCancellation(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 300*time.Millisecond)
	defer cancel()
	started := time.Now()
	_, err := execute(ctx, helperCommand(t, "sleep"))
	if !errors.Is(err, context.DeadlineExceeded) || time.Since(started) > 4*time.Second {
		t.Fatalf("cancellation did not promptly stop process: %v after %v", err, time.Since(started))
	}
}

func TestCancelledContextNeverStartsProcess(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	cmd := helperCommand(t, "sleep")
	_, err := execute(ctx, cmd)
	if !errors.Is(err, context.Canceled) || cmd.Process != nil {
		t.Fatalf("cancelled context launched a process: %v", err)
	}
}

func TestRuntimeHelperProcess(t *testing.T) {
	if os.Getenv("LOCALFIRST_RUNTIME_TEST_HELPER") != "1" {
		return
	}
	args := os.Args
	for len(args) > 0 && args[0] != "--" {
		args = args[1:]
	}
	if len(args) < 2 {
		os.Exit(90)
	}
	switch args[1] {
	case "spam":
		_, _ = os.Stdout.WriteString(strings.Repeat("a", MaxLogBytes*2))
		_, _ = os.Stderr.WriteString(strings.Repeat("b", MaxLogBytes))
		os.Exit(0)
	case "sleep":
		for {
			time.Sleep(time.Second)
		}
	case "parent":
		if len(args) != 3 {
			os.Exit(91)
		}
		cmd := exec.Command(os.Args[0], "-test.run=^TestRuntimeHelperProcess$", "--", "child", args[2])
		cmd.Env = os.Environ()
		if err := cmd.Start(); err != nil {
			os.Exit(92)
		}
		for {
			time.Sleep(time.Second)
		}
	case "child":
		if len(args) != 3 || os.WriteFile(args[2], []byte(strconv.Itoa(os.Getpid())), 0600) != nil {
			os.Exit(93)
		}
		for {
			time.Sleep(time.Second)
		}
	default:
		os.Exit(94)
	}
}

func installedPython(t *testing.T) string {
	t.Helper()
	if path := os.Getenv("LOCALFIRST_TEST_PYTHON"); path != "" {
		return path
	}
	if stdruntime.GOOS == "windows" {
		launcher, err := exec.LookPath("py.exe")
		if err != nil {
			t.Skip("no local Python launcher for the real runtime probe")
		}
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		output, err := exec.CommandContext(ctx, launcher, "-3", "-I", "-c", "import sys; print(sys.executable)").Output()
		if err != nil {
			t.Skipf("no installed Python 3 interpreter: %v", err)
		}
		return strings.TrimSpace(string(output))
	}
	path, err := exec.LookPath("python3")
	if err != nil {
		t.Skip("no local Python 3 interpreter")
	}
	return path
}

func TestActualInstalledRuntimeProbeAndUnavailableDeviceRejection(t *testing.T) {
	config := fixtureConfig(t)
	config.Python = installedPython(t)
	config.MaxSeconds = 30
	ctx, cancel := context.WithTimeout(context.Background(), 35*time.Second)
	defer cancel()
	capability, err := Probe(ctx, config)
	if err != nil {
		t.Fatalf("local interpreter could not return runtime capabilities: %v", err)
	}
	t.Logf("actual runtime: Python %s, PyTorch %q, CPU ready %v, CUDA ready %v, diagnostic %q", capability.PythonVersion, capability.TorchVersion, capability.CPUReady, capability.CUDAReady, capability.Error)
	if capability.CUDAReady && (!capability.CPUReady || capability.GPUName == "") {
		t.Fatal("CUDA readiness was claimed without CPU training readiness and GPU identity")
	}
	if capability.CPUReady {
		t.Skip("PyTorch is installed; missing-framework refusal requires an unavailable runtime")
	}
	job := validJob()
	job.Device = "cuda"
	// No uploaded input is valid for an owner-preprovisioned dataset. The
	// runtime refusal must occur at the capability boundary, not path handling.
	result, err := Run(ctx, config, job, "", config.WorkingDirectory)
	if err == nil || !strings.Contains(err.Error(), "unavailable") || result.ExitCode != -1 {
		t.Fatalf("missing framework accepted a CUDA job: %+v, %v", result, err)
	}
	if result.Log == "" || !strings.Contains(result.Log, "No module named 'torch'") {
		t.Fatalf("worker refusal omitted the actionable runtime diagnosis: %q", result.Log)
	}
}

// This stub tests launcher mechanics only. It is not used by Probe, does not
// implement tensor training, and is never evidence of PyTorch/CUDA readiness.
const controlledTorchStub = `import sys, types
stub = types.ModuleType("torch")
stub.set_num_threads = lambda count: setattr(stub, "requested_threads", count)
stub.cuda = types.SimpleNamespace(is_available=lambda: False, set_device=lambda index: None)
sys.modules["torch"] = stub
`

func TestLauncherMainModuleAndSpawnWithControlledTorchStub(t *testing.T) {
	config := fixtureConfig(t)
	config.Python = installedPython(t)
	source := []byte(`import json, os, sys, pickle, inspect, multiprocessing
import launcher_sibling
class OwnerClass:
    pass
def child_target(path):
    with open(path, "w") as handle:
        handle.write("spawn-ok")
if __name__ == "__main__":
    assert sys.modules["__main__"].OwnerClass is OwnerClass
    assert pickle.loads(pickle.dumps(OwnerClass)) is OwnerClass
    assert inspect.getmodule(child_target) is sys.modules["__main__"]
    child = multiprocessing.get_context("spawn").Process(target=child_target, args=(sys.argv[1],))
    child.start()
    child.join(5)
    assert child.exitcode == 0, child.exitcode
    import torch
    print("LAUNCHER:" + json.dumps({"argv": sys.argv[2:], "module": __name__, "sibling": launcher_sibling.VALUE, "device": os.environ["LOCALFIRST_DEVICE"], "threads": torch.requested_threads}))
`)
	if err := os.WriteFile(config.Script, source, 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(config.WorkingDirectory, "launcher_sibling.py"), []byte("VALUE = 'script-relative-import-ok'\n"), 0600); err != nil {
		t.Fatal(err)
	}
	digest := sha256.Sum256(source)
	childOutput := filepath.Join(config.WorkingDirectory, "spawn.txt")
	literal := "--literal=$(must-remain-an-argument); & spaces"
	cmd := exec.Command(config.Python, "-I", "-u", "-c", controlledTorchStub+runScript, config.Script, hex.EncodeToString(digest[:]), "1", "cpu", childOutput, literal, "")
	cmd.Dir = config.WorkingDirectory
	cmd.Env = workerEnvironment(1, "cpu", "launcher-contract")
	logs := &cappedWriter{limit: MaxLogBytes}
	cmd.Stdout, cmd.Stderr = logs, logs
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	result, err := execute(ctx, cmd)
	if err != nil || result.ExitCode != 0 {
		t.Fatalf("controlled-stub launcher contract failed: %v, %s", err, logs.String())
	}
	data, err := os.ReadFile(childOutput)
	if err != nil || string(data) != "spawn-ok" {
		t.Fatalf("Windows-compatible spawn did not resolve the main module: %q, %v", data, err)
	}
	var payload string
	for _, line := range strings.Split(logs.String(), "\n") {
		if strings.HasPrefix(line, "LAUNCHER:") {
			payload = strings.TrimPrefix(line, "LAUNCHER:")
		}
	}
	var got struct {
		Argv    []string `json:"argv"`
		Module  string   `json:"module"`
		Sibling string   `json:"sibling"`
		Device  string   `json:"device"`
		Threads int      `json:"threads"`
	}
	if err := json.Unmarshal([]byte(payload), &got); err != nil {
		t.Fatalf("missing launcher result: %v; %s", err, logs.String())
	}
	if len(got.Argv) != 2 || got.Argv[0] != literal || got.Argv[1] != "" || got.Module != "__main__" || got.Sibling != "script-relative-import-ok" || got.Device != "cpu" || got.Threads != 1 {
		t.Fatalf("launcher changed script semantics: %+v", got)
	}
}

func TestLauncherRechecksPinAndRejectsCUDAWithoutFallback(t *testing.T) {
	config := fixtureConfig(t)
	config.Python = installedPython(t)
	for _, test := range []struct {
		name, pin, device, diagnostic string
	}{
		{"changed source", strings.Repeat("0", 64), "cpu", "SHA-256 pin does not match"},
		{"unavailable CUDA", config.ScriptSHA256, "cuda", "refusing CPU fallback"},
	} {
		t.Run(test.name, func(t *testing.T) {
			cmd := exec.Command(config.Python, "-I", "-u", "-c", controlledTorchStub+runScript, config.Script, test.pin, "1", test.device)
			cmd.Dir = config.WorkingDirectory
			cmd.Env = workerEnvironment(1, test.device, "launcher-refusal")
			logs := &cappedWriter{limit: MaxLogBytes}
			cmd.Stdout, cmd.Stderr = logs, logs
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			result, err := execute(ctx, cmd)
			if err == nil || result.ExitCode == 0 || !strings.Contains(logs.String(), test.diagnostic) || strings.Contains(logs.String(), "owner-selected script") {
				t.Fatalf("launcher did not refuse before running script: %+v, %v; %s", result, err, logs.String())
			}
		})
	}
}

func TestCPUEnvironmentMasksGPUAndRemovesPythonInjection(t *testing.T) {
	t.Setenv("CUDA_VISIBLE_DEVICES", "0")
	t.Setenv("PYTHONPATH", "untrusted-module-directory")
	t.Setenv("PYTHONSTARTUP", "untrusted-startup.py")
	t.Setenv("OMP_NUM_THREADS", "1000")
	env := workerEnvironment(1, "cpu", "test-id")
	values := map[string]string{}
	for _, entry := range env {
		key, value, _ := strings.Cut(entry, "=")
		values[strings.ToUpper(key)] = value
	}
	if values["CUDA_VISIBLE_DEVICES"] != "" || values["LOCALFIRST_DEVICE"] != "cpu" || values["OMP_NUM_THREADS"] != "1" || values["LOCALFIRST_JOB_ID"] != "test-id" {
		t.Fatal("CPU worker did not apply its declared environment")
	}
	if _, exists := values["PYTHONPATH"]; exists {
		t.Fatal("worker inherited a Python module injection setting")
	}
	if _, exists := values["PYTHONSTARTUP"]; exists {
		t.Fatal("worker inherited a Python startup setting")
	}
}
