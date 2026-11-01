package brand

import (
	"testing"
	"testing/fstest"
)

func TestInstalledOfflineMarkerRemainsReadable(t *testing.T) {
	assets := fstest.MapFS{".diwan-offline.json": {Data: []byte("installed bundle metadata")}}
	value, err := ReadOfflineMetadata(assets)
	if err != nil || string(value) != "installed bundle metadata" {
		t.Fatal("existing bundle marker became unreadable")
	}
	assets[".localfirst-offline.json"] = &fstest.MapFile{Data: []byte("current bundle metadata")}
	value, err = ReadOfflineMetadata(assets)
	if err != nil || string(value) != "current bundle metadata" {
		t.Fatal("current marker did not take precedence")
	}
}
