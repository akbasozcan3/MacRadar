package i18n

import (
	"crypto/sha256"
	_ "embed"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"sync"
)

// EnglishStrings returns the embedded Turkish-source → English UI map (client translateText keys).
func EnglishStrings() map[string]string {
	initOnce.Do(load)
	return englishMap
}

// EnglishBundleVersion is a short hash of the embedded JSON for cache busting.
func EnglishBundleVersion() string {
	initOnce.Do(load)
	return englishVersion
}

var (
	initOnce      sync.Once
	englishMap    map[string]string
	englishVersion string
)

//go:embed en.json
var englishEmbedded []byte

func load() {
	var m map[string]string
	if err := json.Unmarshal(englishEmbedded, &m); err != nil {
		panic(fmt.Errorf("i18n: parse en.json: %w", err))
	}
	englishMap = m
	sum := sha256.Sum256(englishEmbedded)
	englishVersion = hex.EncodeToString(sum[:8])
}
