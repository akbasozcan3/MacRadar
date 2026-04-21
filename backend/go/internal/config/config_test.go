package config

import (
	"strings"
	"testing"
	"time"
)

func TestLoadAuthDebugPreviewDefaultsToFalse(t *testing.T) {
	t.Setenv("APP_BASE_URL", "http://127.0.0.1:8090")
	t.Setenv("AUTH_DEBUG_PREVIEW", "")

	cfg := Load()

	if cfg.AuthDebugPreview {
		t.Fatal("AuthDebugPreview should default to false")
	}
}

func TestLoadAuthDebugPreviewHonorsExplicitOptIn(t *testing.T) {
	t.Setenv("APP_BASE_URL", "http://127.0.0.1:8090")
	t.Setenv("AUTH_DEBUG_PREVIEW", "true")

	cfg := Load()

	if !cfg.AuthDebugPreview {
		t.Fatal("AuthDebugPreview should honor explicit env opt-in")
	}
}

func TestValidateRejectsProductionDefaults(t *testing.T) {
	t.Setenv("APP_ENV", "production")
	t.Setenv("APP_BASE_URL", "https://api.macradar.com")
	t.Setenv("ALLOWED_ORIGINS", "https://app.macradar.com")
	t.Setenv("AUTH_DEBUG_PREVIEW", "false")
	t.Setenv("DATABASE_URL", defaultDatabaseURL)
	t.Setenv("JWT_SECRET", defaultJWTSecret)

	cfg := Load()

	err := cfg.Validate()
	if err == nil {
		t.Fatal("Validate should reject production defaults")
	}
	if !strings.Contains(err.Error(), "JWT_SECRET") {
		t.Fatalf("expected JWT_SECRET validation error, got: %v", err)
	}
}

func TestValidateAllowsSecureProductionConfiguration(t *testing.T) {
	t.Setenv("APP_ENV", "production")
	t.Setenv("APP_BASE_URL", "https://api.macradar.com")
	t.Setenv("ALLOWED_ORIGINS", "https://app.macradar.com,https://admin.macradar.com")
	t.Setenv("AUTH_DEBUG_PREVIEW", "false")
	t.Setenv("DATABASE_URL", "postgres://dbuser:strongpass@db.internal:5432/macradar?sslmode=require")
	t.Setenv("JWT_SECRET", "prod_super_secret_key_that_is_32_chars_min")

	cfg := Load()

	if err := cfg.Validate(); err != nil {
		t.Fatalf("Validate returned unexpected error: %v", err)
	}
}

func TestValidateRejectsInvalidRateLimitConfiguration(t *testing.T) {
	cfg := Load()
	cfg.AuthRateLimitMaxRequests = 0
	cfg.SearchRateLimitWindow = 0

	err := cfg.Validate()
	if err == nil {
		t.Fatal("Validate should reject non-positive rate limit values")
	}
	if !strings.Contains(err.Error(), "rate limit") {
		t.Fatalf("expected rate limit validation error, got: %v", err)
	}
}

func TestLoadRateLimitDefaultsArePositive(t *testing.T) {
	cfg := Load()

	if cfg.AuthRateLimitMaxRequests <= 0 || cfg.AuthRateLimitWindow < time.Second {
		t.Fatalf("unexpected auth rate limit defaults: max=%d window=%s", cfg.AuthRateLimitMaxRequests, cfg.AuthRateLimitWindow)
	}
	if cfg.SearchRateLimitMaxRequests <= 0 || cfg.SearchRateLimitWindow < time.Second {
		t.Fatalf("unexpected search rate limit defaults: max=%d window=%s", cfg.SearchRateLimitMaxRequests, cfg.SearchRateLimitWindow)
	}
}
