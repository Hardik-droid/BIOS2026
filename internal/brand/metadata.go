package brand

import (
	"errors"
	"io/fs"
)

// ReadOfflineMetadata keeps installed bundles readable across the product rename.
// A present new marker is authoritative, including errors other than absence.
func ReadOfflineMetadata(assets fs.FS) ([]byte, error) {
	metadata, err := fs.ReadFile(assets, ".localfirst-offline.json")
	if errors.Is(err, fs.ErrNotExist) {
		return fs.ReadFile(assets, ".diwan-offline.json")
	}
	return metadata, err
}
