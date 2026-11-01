// Package brand keeps deployment settings backward compatible during rebranding.
package brand

import (
	"os"
	"strings"
)

// LookupEnv gives explicitly configured LocalFirst values precedence, including
// an explicit empty value; existing installations may retain their old settings.
func LookupEnv(key string) (string, bool) {
	if value, ok := os.LookupEnv(key); ok {
		return value, true
	}
	if strings.HasPrefix(key, "LOCALFIRST_") {
		return os.LookupEnv("DIWAN_" + strings.TrimPrefix(key, "LOCALFIRST_"))
	}
	return "", false
}

func Getenv(key string) string { value, _ := LookupEnv(key); return value }
