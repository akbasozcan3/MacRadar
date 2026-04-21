package config

import (
	"bufio"
	"os"
	"path/filepath"
	"strings"
)

func loadDotEnvFiles() {
	candidates := []string{
		".env",
		"../.env",
		"../../.env",
		"backend/.env",
		"../../backend/.env",
	}

	seen := make(map[string]struct{}, len(candidates))

	for _, candidate := range candidates {
		if candidate == "" {
			continue
		}

		resolved, err := filepath.Abs(candidate)
		if err != nil {
			continue
		}
		if _, exists := seen[resolved]; exists {
			continue
		}
		seen[resolved] = struct{}{}

		loadDotEnvFile(resolved)
	}
}

func loadDotEnvFile(path string) {
	file, err := os.Open(path)
	if err != nil {
		return
	}
	defer file.Close()

	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}

		if strings.HasPrefix(line, "export ") {
			line = strings.TrimSpace(strings.TrimPrefix(line, "export "))
		}

		separator := strings.IndexRune(line, '=')
		if separator <= 0 {
			continue
		}

		key := strings.TrimSpace(line[:separator])
		if key == "" {
			continue
		}
		if _, exists := os.LookupEnv(key); exists {
			continue
		}

		value := strings.TrimSpace(line[separator+1:])
		value = stripWrappingQuotes(value)
		_ = os.Setenv(key, value)
	}
}

func stripWrappingQuotes(value string) string {
	if len(value) < 2 {
		return value
	}

	if (strings.HasPrefix(value, "\"") && strings.HasSuffix(value, "\"")) ||
		(strings.HasPrefix(value, "'") && strings.HasSuffix(value, "'")) {
		return value[1 : len(value)-1]
	}

	return value
}
