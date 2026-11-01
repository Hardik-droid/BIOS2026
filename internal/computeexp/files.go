//go:build compute_experiment

package computeexp

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"time"
	"unicode"

	training "localfirst/internal/computeexp/runtime"
)

// This cancels excessive writes under the designated output directory. It is
// a periodic guard, not an OS disk quota or a sandbox for an owner-trusted script.
func watchOutput(ctx context.Context, root string, limit int64, cancel context.CancelFunc) (func(), <-chan error) {
	stop, done := make(chan struct{}), make(chan error, 1)
	go func() {
		ticker := time.NewTicker(time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-stop:
				done <- nil
				return
			case <-ctx.Done():
				done <- nil
				return
			case <-ticker.C:
				if err := checkOutputUsage(root, limit); err != nil {
					cancel()
					done <- err
					return
				}
			}
		}
	}()
	return func() { close(stop) }, done
}

func checkOutputUsage(root string, limit int64) error {
	var bytes int64
	var count int
	return filepath.WalkDir(root, func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			if os.IsNotExist(walkErr) {
				return nil
			}
			return walkErr
		}
		if entry.IsDir() {
			return nil
		}
		if entry.Type()&os.ModeSymlink != 0 {
			return errors.New("symlink in training output")
		}
		info, err := entry.Info()
		if err != nil {
			if os.IsNotExist(err) {
				return nil
			}
			return err
		}
		count++
		if !info.Mode().IsRegular() || count > MaxArtifacts || info.Size() < 0 || info.Size() > limit-bytes {
			return errors.New("training output exceeds the file count or byte limit")
		}
		bytes += info.Size()
		return nil
	})
}

type Artifact struct {
	Path   string `json:"path"`
	Size   int64  `json:"size"`
	SHA256 string `json:"sha256"`
}
type chunk struct {
	Index int    `json:"index"`
	Data  []byte `json:"data"`
}

func safeArtifactPath(name string) bool {
	if name == "" || len(name) > 180 || !fs.ValidPath(name) || strings.ContainsAny(name, "\\:") || strings.Count(name, "/") > 6 {
		return false
	}
	for _, part := range strings.Split(name, "/") {
		if len(part) > 100 || strings.TrimRight(part, " .") != part || strings.ContainsAny(part, "<>\"|?*") {
			return false
		}
		for _, r := range part {
			if unicode.IsControl(r) {
				return false
			}
		}
		base := strings.ToUpper(strings.SplitN(part, ".", 2)[0])
		if base == "CON" || base == "PRN" || base == "AUX" || base == "NUL" || (len(base) == 4 && (strings.HasPrefix(base, "COM") || strings.HasPrefix(base, "LPT")) && base[3] >= '0' && base[3] <= '9') {
			return false
		}
	}
	first := strings.ToLower(strings.SplitN(name, "/", 2)[0])
	return first != "job-result.json" && first != "incomplete.txt" && first != "transfer-complete.txt"
}

func validateArtifacts(files []Artifact, limit int64) error {
	if len(files) > MaxArtifacts || limit <= 0 || limit > MaxOutputBytes {
		return errors.New("invalid artifact limits")
	}
	seen := map[string]bool{}
	var total int64
	for _, file := range files {
		key := strings.ToLower(file.Path)
		if !safeArtifactPath(file.Path) || seen[key] || file.Size < 0 || file.Size > limit-total || !validHex(file.SHA256, 32) {
			return errors.New("invalid artifact manifest")
		}
		// A file cannot also be another artifact's directory (case-insensitive on Windows).
		for existing := range seen {
			if strings.HasPrefix(key, existing+"/") || strings.HasPrefix(existing, key+"/") {
				return errors.New("conflicting artifact paths")
			}
		}
		seen[key] = true
		total += file.Size
	}
	return nil
}

func HashFile(path string, max int64) (Input, error) {
	info, err := os.Lstat(path)
	if err != nil || !info.Mode().IsRegular() || info.Size() < 0 || info.Size() > max {
		return Input{}, errors.New("file is missing, not a regular file, or exceeds the transfer limit")
	}
	f, err := os.Open(path)
	if err != nil {
		return Input{}, err
	}
	defer f.Close()
	hash := sha256.New()
	n, err := io.Copy(hash, io.LimitReader(f, max+1))
	if err != nil || n != info.Size() {
		return Input{}, errors.New("file changed while hashing")
	}
	return Input{Size: n, SHA256: hex.EncodeToString(hash.Sum(nil))}, nil
}

func collectArtifacts(root string, limit int64) ([]Artifact, error) {
	files := []Artifact{}
	err := filepath.WalkDir(root, func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if path == root {
			return nil
		}
		if entry.Type()&os.ModeSymlink != 0 {
			return errors.New("symlink outputs are not transferred")
		}
		resolved, err := filepath.EvalSymlinks(path)
		if err != nil || !strings.EqualFold(filepath.Clean(resolved), filepath.Clean(path)) {
			return errors.New("redirected output paths are not transferred")
		}
		if entry.IsDir() {
			return nil
		}
		name, err := filepath.Rel(root, path)
		if err != nil {
			return err
		}
		name = filepath.ToSlash(name)
		if !safeArtifactPath(name) || len(files) >= MaxArtifacts {
			return errors.New("unsafe or excessive output files")
		}
		info, err := HashFile(path, limit)
		if err != nil {
			return err
		}
		files = append(files, Artifact{Path: name, Size: info.Size, SHA256: info.SHA256})
		return validateArtifacts(files, limit)
	})
	return files, err
}

func sendFile(channel *Channel, path string, size int64, expected string) error {
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer f.Close()
	hash := sha256.New()
	buffer := make([]byte, ChunkBytes)
	left := size
	for index := 0; left > 0; index++ {
		want := int64(len(buffer))
		if left < want {
			want = left
		}
		n, err := io.ReadFull(f, buffer[:want])
		if err != nil {
			return err
		}
		hash.Write(buffer[:n])
		if err := channel.Send("chunk", chunk{Index: index, Data: buffer[:n]}); err != nil {
			return err
		}
		left -= int64(n)
	}
	var extra [1]byte
	n, readErr := f.Read(extra[:])
	if n != 0 || readErr != io.EOF || hex.EncodeToString(hash.Sum(nil)) != expected {
		return errors.New("file changed during transfer")
	}
	return nil
}

func receiveFile(channel *Channel, path string, size int64, expected string) error {
	// Random temporary name prevents artifact names colliding with partial-file names.
	f, err := os.CreateTemp(filepath.Dir(path), ".receiving-*")
	if err != nil {
		return err
	}
	defer f.Close()
	hash := sha256.New()
	left := size
	for index := 0; left > 0; index++ {
		var packet chunk
		if err := readExpected(channel, "chunk", &packet); err != nil {
			return err
		}
		if packet.Index != index || len(packet.Data) == 0 || len(packet.Data) > ChunkBytes || int64(len(packet.Data)) > left {
			return errors.New("invalid chunk order or length")
		}
		if _, err := f.Write(packet.Data); err != nil {
			return err
		}
		hash.Write(packet.Data)
		left -= int64(len(packet.Data))
	}
	if hex.EncodeToString(hash.Sum(nil)) != expected {
		return errors.New("transferred file SHA-256 mismatch")
	}
	if err := f.Sync(); err != nil {
		return err
	}
	if err := f.Close(); err != nil {
		return err
	}
	if _, err := os.Lstat(path); !os.IsNotExist(err) {
		return errors.New("refusing to replace an existing result file")
	}
	return os.Rename(f.Name(), path)
}

func writeJSONExclusive(path string, value any) error {
	f, err := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return err
	}
	defer f.Close()
	encoder := json.NewEncoder(f)
	encoder.SetIndent("", "  ")
	return encoder.Encode(value)
}

func writeLocalReport(jobDir string, result training.Result) error {
	return writeJSONExclusive(filepath.Join(jobDir, "worker-report.json"), result)
}

// ReadJobSpec accepts only the numeric parameters and a pinned script hash.
// Network IDs and input manifests are assigned locally by the sender.
func ReadJobSpec(path string) (Request, error) {
	f, err := os.Open(path)
	if err != nil {
		return Request{}, err
	}
	defer f.Close()
	data, err := io.ReadAll(io.LimitReader(f, 8193))
	if err != nil {
		return Request{}, err
	}
	if len(data) > 8192 {
		return Request{}, errors.New("job spec exceeds 8 KiB")
	}
	var spec struct {
		ScriptSHA256 string  `json:"script_sha256"`
		Device       string  `json:"device"`
		Epochs       int     `json:"epochs"`
		BatchSize    int     `json:"batch_size"`
		LearningRate float64 `json:"learning_rate"`
	}
	decoder := json.NewDecoder(strings.NewReader(string(data)))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&spec); err != nil {
		return Request{}, err
	}
	var tail any
	if decoder.Decode(&tail) != io.EOF {
		return Request{}, errors.New("job spec has trailing JSON")
	}
	id, err := NewJobID()
	if err != nil {
		return Request{}, err
	}
	r := Request{ID: id, ScriptSHA256: spec.ScriptSHA256, Device: spec.Device, Epochs: spec.Epochs, BatchSize: spec.BatchSize, LearningRate: spec.LearningRate}
	if err := r.Validate(); err != nil {
		return Request{}, fmt.Errorf("job spec: %w", err)
	}
	return r, nil
}
