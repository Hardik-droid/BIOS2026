# LocalFirst Bluetooth training worker

This is an opt-in Windows companion for sending **one training job to another PC** over Bluetooth. The receiving PC runs an owner-installed, hash-pinned PyTorch script and returns a bounded set of output files. It does not pool CPU cores or GPU memory between laptops.

The experiment is excluded from normal builds by the `compute_experiment` build tag. It has a separate executable, Bluetooth service UUID, invitation format and job directory. It adds no office application routes, storage migrations, background services or cloud sign-in. Starting the companion does not upgrade, restart or stop the office app.

**Integration is pending the actual training script path, normal command, dataset location and checkpoint location.** The user selected an existing PyTorch script and reported an RTX 3050 in the second laptop. GPU readiness and VRAM capacity must be measured on that laptop. The development-machine audit found a different GPU, an RTX 4050 with approximately 6 GiB, and no installed PyTorch. Neither finding establishes that the second laptop can train the requested model.

## What this phase provides

- Native Windows Bluetooth RFCOMM between already paired devices; no IP transport fallback.
- TLS 1.3 with a pinned worker certificate and a separate random admission secret.
- A ten-minute `LFC1-` invitation, distinct from document and relay invitations. One authenticated connection consumes the running worker session; three failed authentication attempts stop it.
- Explicit approval on the receiving PC before input staging or training.
- A local worker profile that selects the interpreter, script, argument templates and maximum duration. The sender supplies bounded numeric parameters, not a shell command or executable script.
- An actual PyTorch CPU training-step probe and, when available, a CUDA training-step probe before execution. A GPU request fails when CUDA is unavailable; it is not silently converted to CPU execution.
- Timeout, sender-disconnect and Ctrl+C cancellation. On Windows, a Job Object contains the Python process tree so cancellation can terminate descendants.
- Ordered, size-bounded file chunks and SHA-256 checks. Returned checkpoints are stored as opaque files and are never automatically loaded.

Bluetooth is the data connection, so transfer time, interference and disconnects remain real constraints. There is no zero-delay guarantee. This phase implements neither screen streaming nor a shared desktop, Android compute, multi-worker training, automatic checkpoint resume, a mesh, nor an 800-metre range guarantee.

## Trust and resource boundaries

Only use a worker whose owner you trust with the data and model. The worker must read them to perform ordinary PyTorch training. Encryption protects the connection; it does not conceal plaintext from the worker, its administrator or compromised endpoint software. A received file's matching hash establishes transfer integrity, not correct training or an honest worker.

The script runs with the receiving user's privileges. Entry-script hashing does not pin imported modules, datasets, Python, PyTorch or native libraries. The operator must install and review those dependencies. Owner-selected scripts can ignore device/thread settings, read local files, access a network, or write outside the output directory. This companion is **not an arbitrary-code sandbox**. Data files can also be dangerous when interpreted by a trusted script. PyTorch describes these trust concerns in its [security policy](https://github.com/pytorch/pytorch/security/policy).

CPU thread settings are workload preferences, not hard CPU/RAM/VRAM reservations. The worker can compete with the office app for hardware resources. Start with a small model and conservative batch size; monitor memory, GPU utilisation, temperature and office responsiveness. A CUDA probe succeeding does not establish that a larger model fits in VRAM.

Keep invitations in an owner-private local directory and transfer them privately. Do not put them, datasets, profiles containing private paths, or job outputs in Git, public cloud folders or logs. An inherited Windows directory ACL determines file access; creating a file with a Unix-style `0600` permission argument is not a separate Windows access-control policy.

## Build without touching the running app

From the repository root (`W\diwan`), run the companion's dedicated build script. It runs the tagged companion tests and builds one canonical executable in the ignored `compute-experiment-package\windows-x64` directory:

```powershell
& '.\scripts\build-compute-experiment.ps1'
$computeExe = Join-Path (Get-Location) 'compute-experiment-package\windows-x64\localfirst-compute-experiment.exe'
& $computeExe help
```

The script uses Go on `PATH` when present, otherwise the workspace's `W\.tools\go\bin\go.exe`. It does not build or package the office app. Copy this companion to a private installation directory on each Windows laptop; existing office executable and installer do not need replacement. There is no companion autostart. A manual equivalent is `go build -tags compute_experiment -o <separate-output.exe> ./cmd/localfirst-compute-experiment`.

Install the training script's required environment before going offline. Select an appropriate Windows/Python/CUDA build using the [official PyTorch installation guidance](https://pytorch.org/get-started/locally/), rather than assuming that a GPU name makes the current interpreter compatible. This experiment does not download dependencies or accept software licences automatically.

## Configure a trusted worker profile

The profile is a local JSON file selected by the worker owner. **This template is illustrative, not a working profile.** Replace its interpreter, script, working directory, checksum and command-line flags with the actual existing training environment. The real script's CLI has not yet been provided.

```json
{
  "python": "C:\\Training\\venv\\Scripts\\python.exe",
  "script": "C:\\Training\\project\\train.py",
  "script_sha256": "<64 lowercase hexadecimal characters from the actual script>",
  "args": [
    "--device", "{device}",
    "--epochs", "{epochs}",
    "--batch-size", "{batch_size}",
    "--learning-rate", "{learning_rate}",
    "--output-dir", "{output}"
  ],
  "working_directory": "C:\\Training\\project",
  "max_seconds": 1800,
  "cpu_threads": 2,
  "max_output_bytes": 67108864
}
```

Calculate the actual script hash locally:

```powershell
(Get-FileHash -LiteralPath 'C:\Training\project\train.py' -Algorithm SHA256).Hash.ToLowerInvariant()
```

The profile accepts only `{device}`, `{epochs}`, `{batch_size}`, `{learning_rate}`, `{input}` and `{output}` placeholders. Template values are passed as separate process arguments without a shell. Use only flags the actual script supports. A worker-local dataset path can be a fixed owner-selected argument. Use `{input}` only for a script that expects the optional staged data file. Uploaded files are not automatically unpacked. The script must explicitly write the files to return beneath `{output}`; checkpoints written elsewhere are not collected.

Python and script paths must be absolute existing regular files; WindowsApps execution aliases are rejected. The script must be a nonempty `.py` file no larger than 8 MiB. Its checksum is checked again before execution. The working directory must already exist. Python runs in isolated mode, so scripts depending on implicit `PYTHONPATH` need an explicit local environment/import arrangement. Review the profile whenever the training script changes; a changed script is rejected until the owner updates its pin.

Check the chosen environment on the receiving laptop:

```powershell
& $computeExe probe -profile 'C:\Training\worker-profile.json'
```

Read `cpu_ready`, `cuda_ready`, `torch_version`, `gpu_name` and `error`. CUDA readiness is reported only after a small forward/backward/optimiser step succeeds. The probe allocates a small model on the local GPU, so it is an explicit action rather than an office startup task. It does not run the user's training script. A valid capability response can report `false` readiness without the command itself failing to launch.

## Run a single approved job

1. Pair the Windows laptops through Windows Bluetooth settings. Use the companion's `devices` command to list the OS-authenticated devices and their addresses. It does not pair or enlist devices silently.
2. On the receiving PC, start `worker` with a trusted profile and a **new**, private invitation output path:

   ```powershell
   & $computeExe worker -profile 'C:\Training\worker-profile.json' -invite-out 'C:\Training\private\invite.txt'
   ```

   An optional `-work-dir` selects an absolute job-storage path. The default is the current user's local cache directory under `LocalFirstCompute\jobs`. Each invocation accepts one job and then exits. Existing invitation files are never overwritten; an expired file must not be reused.

3. Privately transfer the full invitation file to the sender. This first phase does not use the office application's four-digit pairing code. The certificate pin and high-entropy admission secret must remain intact.
4. On the sender, create a job JSON file. This example also requires the real lowercase script checksum; it requests that exact worker-installed script:

   ```json
   {
     "script_sha256": "<same real lowercase SHA-256 as the worker profile>",
     "device": "cuda",
     "epochs": 1,
     "batch_size": 8,
     "learning_rate": 0.001
   }
   ```

5. Submit to the paired worker address, using a result directory that **does not exist**:

   ```powershell
   & $computeExe submit -address '001122AABBCC' -invite-file 'C:\Training\private\invite.txt' -job 'C:\Training\job.json' -out 'C:\Training\results\run-001'
   ```

   The address is an example, not a discovered laptop. Add `-input 'C:\Training\small-data.bin'` only when the chosen script/profile handles that input. Prefer preinstalled datasets for large jobs. The result parent directory must already exist. `-timeout 30m` can reduce the sender's total deadline; the maximum is 24 hours, and the worker's own timeout still applies.

6. Check the authenticated peer and requested device/parameters on the receiving console. Type the displayed `APPROVE <job-id>` exactly within 90 seconds. Anything else rejects the job. No input is staged and no training runs before approval.
7. Keep the PCs awake and within measured Bluetooth range. The sender reports connection/approval/running states. Two-second running messages are heartbeats, not epoch, utilisation or progress measurements.
8. On success, inspect `job-result.json`, `TRANSFER-COMPLETE.txt` and the returned files. Review model quality separately. Detailed subprocess logs remain in the worker's job directory. Both endpoints retain job data; there is no automatic retention cleanup.

Ctrl+C on the sender or worker cancels the session. Failed transfers retain an `INCOMPLETE.txt` marker and partial files for inspection. They are not successful checkpoints, and the current implementation does not resume them. Retry with a newly started worker/invitation and a new result directory. Never manually load a returned checkpoint merely because its bytes transferred successfully.

## Bounds enforced by this companion

| Boundary | Limit or behaviour |
| --- | --- |
| Concurrent jobs | One per worker invocation |
| Invitation | Ten-minute connection window; one authenticated connection |
| Local approval | 90 seconds |
| Initial job message | Two-minute connection deadline |
| Optional input | One file, at most 32 MiB |
| Returned files | At most 128 regular files; no symlinks or redirected paths |
| Returned byte total | Smaller of configured limit and 64 MiB; also monitored during execution |
| File chunks | 32 KiB data, ordered indices and final SHA-256 |
| Frame | 64 KiB maximum, length-prefixed |
| Artifact names | Safe relative paths; no traversal, absolute paths, Windows reserved names, case collisions or reserved report names |
| Subprocess log | 256 KiB retained; excess drained and marked truncated |
| Training parameters | Device `cpu`/`cuda`; epochs 1–10,000; batch size 1–65,536; finite learning rate above zero and at most 10 |
| Worker runtime | Configured 1–86,400 seconds, including runtime probe |
| CPU threads | Configured 1 through the smaller of available logical CPUs and 64 |
| Result destination | Must be new; files are not intentionally overwritten |
| Automatic execution | No returned artifacts are executed, unpacked or deserialised |

A one-second watcher cancels the running job when the designated output directory exceeds the file-count/byte limit or contains an unsupported file. Final collection validates the paths and hashes again. This watcher is not a hard disk quota: writes can exceed the limit between checks, and writes elsewhere are outside its scope. Similarly, process termination does not reverse files already written by a trusted script. Native Bluetooth service separation prevents protocol collisions but does not reserve radio bandwidth from document collaboration.

## Phases and acceptance gates

Verified on 1 November 2026: the tagged protocol/runtime/CLI test suites and `go vet` pass; normal and relay-tagged document Bluetooth regression suites pass; the Windows companion builds and its help command runs. Tests include real Python process-tree cancellation and explicitly simulated transport/launcher fixtures. The local Python probe correctly reports PyTorch absent. The office build has no compute dependency, and the running office app, executable and installer hashes remain unchanged. The generated `compute-experiment-package/verification.json` records this check. No physical two-PC training or RTX 3050 job has been verified.

This is experimental until the actual script and physical-device checks below pass. Software tests using in-memory/loopback streams establish protocol behaviour, not Bluetooth radio performance or real GPU training.

| Phase | Required evidence before moving on |
| --- | --- |
| 1 — Isolated companion | Tagged build; existing document-service identity and tests preserved; no office restart or package replacement; pinned TLS/auth/framing tests; approval, integrity, limits and cancellation tests |
| 2 — Real script adapter | Record the exact script/CLI/dependency environment; configure local dataset/output paths; run the script locally on the worker; demonstrate CPU/CUDA probes and confirm no silent fallback |
| 3 — Two Windows PCs | Run a small real job over paired Bluetooth with both PCs offline; compare expected outputs and training metrics; record total bytes, transfer times, runtime and peak resource usage |
| 4 — Failure and coexistence | Exercise the scenarios below while opening/editing/autosaving office documents; confirm no office data loss and measure responsiveness rather than assuming it |
| 5 — Larger workloads | Set measured size/time/resource budgets; add restart/checkpoint semantics, retention policy and improved progress reporting only after the first job is reliable |
| 6 — Additional capabilities | Evaluate Android workers, multiple workers and screen sharing separately; require explicit consent, feasible throughput and new physical acceptance results |

For physical acceptance, record at least these scenarios:

- CPU success and CUDA success on the actual RTX 3050; missing PyTorch, missing CUDA, incompatible dependencies, insufficient VRAM and an unsupported script CLI must fail clearly.
- Reject/ignore approval; wrong invitation secret/certificate, expired invitation, wrong script checksum, unpaired sender and replay after the one-job session must never start training.
- Disconnect Bluetooth, close the sender, stop the worker, trigger timeout, sleep/power-cycle either laptop and cancel a child-spawning training script. Confirm no Python descendants keep training after cancellation; inspect retained partial results.
- Empty and maximum-size input; malformed, truncated, reordered and tampered chunks; oversized manifests and outputs; no-output jobs; non-ASCII paths, long paths, reserved names, symlinks, permission failures and full disk.
- Start and edit documents, spreadsheets, slides and whiteboards while a conservative job runs. Confirm local saves/reloads and document Bluetooth collaboration remain correct. Compare the office runtime versions before and after.
- Measure actual distance and throughput with the intended adapters, obstacles and power settings. Do not infer an 800-metre radius from a successful nearby exchange.
- Review returned model/checkpoint quality using a trusted local validation process. Transport success alone is not a scientific or security validation.

No phase requires deleting existing workspace data or replacing a working editor engine. A future in-app compute interface should call the separately validated companion and expose actual capability/job states, not display a functional-looking GPU-sharing control before those gates pass.
