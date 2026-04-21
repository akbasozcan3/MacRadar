package server

import (
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"macradar/backend/internal/config"
)

func TestWithMiddlewareAppliesAuthRateLimit(t *testing.T) {
	t.Parallel()

	now := time.Date(2026, time.March, 30, 12, 0, 0, 0, time.UTC)
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	server := &Server{
		cfg: config.Config{
			AuthRateLimitMaxRequests: 2,
			AuthRateLimitWindow:      time.Minute,
		},
		logger:      logger,
		rateLimiter: newRequestRateLimiter(func() time.Time { return now }),
	}

	handler := server.withMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}))

	for index := 0; index < 2; index++ {
		request := httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", nil)
		request.RemoteAddr = "203.0.113.10:4567"
		recorder := httptest.NewRecorder()

		handler.ServeHTTP(recorder, request)

		if recorder.Code != http.StatusNoContent {
			t.Fatalf("request %d status = %d, want %d", index+1, recorder.Code, http.StatusNoContent)
		}
	}

	request := httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", nil)
	request.RemoteAddr = "203.0.113.10:4567"
	recorder := httptest.NewRecorder()

	handler.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusTooManyRequests {
		t.Fatalf("rate limited status = %d, want %d", recorder.Code, http.StatusTooManyRequests)
	}
	if retryAfter := recorder.Header().Get("Retry-After"); retryAfter != "60" {
		t.Fatalf("Retry-After = %q, want %q", retryAfter, "60")
	}
	if limit := recorder.Header().Get("X-RateLimit-Limit"); limit != "2" {
		t.Fatalf("X-RateLimit-Limit = %q, want %q", limit, "2")
	}
	if remaining := recorder.Header().Get("X-RateLimit-Remaining"); remaining != "0" {
		t.Fatalf("X-RateLimit-Remaining = %q, want %q", remaining, "0")
	}

	var payload struct {
		Error struct {
			Code    string         `json:"code"`
			Details map[string]any `json:"details"`
			Status  int            `json:"status"`
		} `json:"error"`
		Success bool `json:"success"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		t.Fatalf("unmarshal rate limit response: %v", err)
	}
	if payload.Success {
		t.Fatal("success should be false for rate limit responses")
	}
	if payload.Error.Code != "rate_limit_exceeded" {
		t.Fatalf("error.code = %q, want %q", payload.Error.Code, "rate_limit_exceeded")
	}
	if payload.Error.Status != http.StatusTooManyRequests {
		t.Fatalf("error.status = %d, want %d", payload.Error.Status, http.StatusTooManyRequests)
	}
	if got := payload.Error.Details["scope"]; got != "auth" {
		t.Fatalf("error.details[scope] = %v, want %q", got, "auth")
	}
}
