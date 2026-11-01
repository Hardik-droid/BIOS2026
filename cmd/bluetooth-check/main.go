package main

import (
	"encoding/json"
	"fmt"
	"localfirst/internal/nearby"
)

func main() {
	result := map[string]any{"radio": nearby.RadioStatus()}
	devices, err := nearby.PairedDevices()
	if err != nil {
		result["devicesError"] = err.Error()
	} else {
		result["pairedDeviceCount"] = len(devices)
	}
	listener, err := nearby.Listen()
	if err != nil {
		result["listenError"] = err.Error()
	} else {
		result["rfcommListening"] = true
		result["channel"] = listener.Channel
		if err := listener.Close(); err != nil {
			result["cleanupError"] = err.Error()
		} else {
			result["serviceRemoved"] = true
		}
	}
	data, _ := json.MarshalIndent(result, "", "  ")
	fmt.Println(string(data))
}
