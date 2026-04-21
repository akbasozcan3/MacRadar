package server

import (
	"encoding/json"
	"errors"
	"macradar/backend/internal/config"
	"macradar/backend/internal/explore"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestRespondErrorWithDetailsUsesFailureEnvelope(t *testing.T) {
	s := &Server{}
	recorder := httptest.NewRecorder()

	s.respondErrorWithDetails(
		recorder,
		http.StatusBadRequest,
		"invalid_payload",
		"payload is invalid",
		map[string]any{"field": "email"},
	)

	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusBadRequest)
	}

	var payload struct {
		Data  json.RawMessage `json:"data"`
		Error struct {
			Code      string         `json:"code"`
			Details   map[string]any `json:"details"`
			Message   string         `json:"message"`
			RequestID string         `json:"requestId"`
			Status    int            `json:"status"`
		} `json:"error"`
		Success bool `json:"success"`
	}

	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		t.Fatalf("unmarshal response: %v", err)
	}

	if payload.Success {
		t.Fatal("success should be false for error responses")
	}
	if len(payload.Data) != 0 {
		t.Fatalf("data should be empty, got %s", string(payload.Data))
	}
	if payload.Error.Code != "invalid_payload" {
		t.Fatalf("error.code = %q, want %q", payload.Error.Code, "invalid_payload")
	}
	if payload.Error.Message != "payload is invalid" {
		t.Fatalf("error.message = %q, want %q", payload.Error.Message, "payload is invalid")
	}
	if payload.Error.Status != http.StatusBadRequest {
		t.Fatalf("error.status = %d, want %d", payload.Error.Status, http.StatusBadRequest)
	}
	if payload.Error.Details["field"] != "email" {
		t.Fatalf("error.details[field] = %v, want %q", payload.Error.Details["field"], "email")
	}
}

func TestDecodeJSONRejectsTrailingPayload(t *testing.T) {
	s := &Server{}
	req := httptest.NewRequest(http.MethodPost, "/", strings.NewReader(`{"email":"driver@macradar.app"}{"x":1}`))

	var payload struct {
		Email string `json:"email"`
	}

	err := s.decodeJSON(req, &payload)
	if err == nil {
		t.Fatal("expected decodeJSON to reject trailing JSON payload")
	}
	if !strings.Contains(err.Error(), "single JSON object") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestDecodeJSONAcceptsProfilePostLocationPayload(t *testing.T) {
	s := &Server{}
	req := httptest.NewRequest(
		http.MethodPost,
		"/",
		strings.NewReader(`{
			"caption":"Bogaz turu",
			"location":"Besiktas Iskelesi, Istanbul",
			"locationPayload":{
				"source":"mapbox",
				"query":"Besiktas",
				"normalizedQuery":"Besiktas Iskelesi, Istanbul",
				"selectedLocation":{
					"fullAddress":"Besiktas Iskelesi, Istanbul",
					"latitude":41.0422,
					"longitude":29.0061,
					"mapboxId":"poi.42",
					"name":"Besiktas Iskelesi"
				}
			},
			"mediaType":"photo",
			"mediaUrl":"https://cdn.macradar.app/post.jpg",
			"thumbnailUrl":"https://cdn.macradar.app/post-thumb.jpg"
		}`),
	)

	var payload explore.CreateProfilePostInput
	if err := s.decodeJSON(req, &payload); err != nil {
		t.Fatalf("decodeJSON returned error: %v", err)
	}
	if payload.ThumbnailURL != "https://cdn.macradar.app/post-thumb.jpg" {
		t.Fatalf("thumbnailUrl = %q", payload.ThumbnailURL)
	}
	if payload.LocationPayload == nil || payload.LocationPayload.SelectedLocation == nil {
		t.Fatal("locationPayload should be decoded")
	}
	if payload.LocationPayload.Source != "mapbox" {
		t.Fatalf("locationPayload.source = %q", payload.LocationPayload.Source)
	}
	if payload.LocationPayload.SelectedLocation.MapboxID != "poi.42" {
		t.Fatalf(
			"locationPayload.selectedLocation.mapboxId = %q",
			payload.LocationPayload.SelectedLocation.MapboxID,
		)
	}
}

func TestRespondJSONUsesSuccessEnvelope(t *testing.T) {
	s := &Server{}
	recorder := httptest.NewRecorder()

	s.respondJSON(recorder, http.StatusCreated, map[string]string{"status": "ok"})

	if recorder.Code != http.StatusCreated {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusCreated)
	}

	var payload struct {
		Data struct {
			Status string `json:"status"`
		} `json:"data"`
		Error   json.RawMessage `json:"error"`
		Success bool            `json:"success"`
	}

	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		t.Fatalf("unmarshal response: %v", err)
	}

	if !payload.Success {
		t.Fatal("success should be true for successful responses")
	}
	if payload.Data.Status != "ok" {
		t.Fatalf("data.status = %q, want %q", payload.Data.Status, "ok")
	}
	if len(payload.Error) != 0 {
		t.Fatalf("error should be empty, got %s", string(payload.Error))
	}
}

func TestIsWebSocketOriginAllowed(t *testing.T) {
	t.Parallel()

	server := &Server{
		cfg: config.Config{
			AllowedOrigins: []string{
				"http://127.0.0.1:8081",
				"http://localhost:8081",
			},
			Environment: "development",
		},
	}

	testCases := []struct {
		name   string
		origin string
		host   string
		want   bool
	}{
		{
			name:   "empty origin",
			origin: "",
			host:   "127.0.0.1:8090",
			want:   true,
		},
		{
			name:   "null origin",
			origin: "null",
			host:   "127.0.0.1:8090",
			want:   true,
		},
		{
			name:   "configured origin",
			origin: "http://127.0.0.1:8081",
			host:   "127.0.0.1:8090",
			want:   true,
		},
		{
			name:   "same host different port",
			origin: "http://127.0.0.1:19006",
			host:   "127.0.0.1:8090",
			want:   true,
		},
		{
			name:   "emulator loopback",
			origin: "http://10.0.2.2:19000",
			host:   "127.0.0.1:8090",
			want:   true,
		},
		{
			name:   "private network origin",
			origin: "http://192.168.1.42:19006",
			host:   "127.0.0.1:8090",
			want:   true,
		},
		{
			name:   "untrusted origin",
			origin: "https://evil.example",
			host:   "127.0.0.1:8090",
			want:   false,
		},
	}

	for _, testCase := range testCases {
		testCase := testCase
		t.Run(testCase.name, func(t *testing.T) {
			t.Parallel()

			request := httptest.NewRequest(http.MethodGet, "/ws/players", nil)
			request.Host = testCase.host
			if testCase.origin != "" {
				request.Header.Set("Origin", testCase.origin)
			}

			if actual := server.isWebSocketOriginAllowed(request); actual != testCase.want {
				t.Fatalf("isWebSocketOriginAllowed(%q) = %t, want %t", testCase.origin, actual, testCase.want)
			}
		})
	}
}

func TestIsWebSocketOriginAllowedRejectsUntrustedInProduction(t *testing.T) {
	t.Parallel()

	server := &Server{
		cfg: config.Config{
			AllowedOrigins: []string{"https://app.macradar.com"},
			Environment:    "production",
		},
	}

	request := httptest.NewRequest(http.MethodGet, "/ws/players", nil)
	request.Host = "api.macradar.com"
	request.Header.Set("Origin", "http://127.0.0.1:19006")

	if server.isWebSocketOriginAllowed(request) {
		t.Fatal("expected origin to be rejected in production")
	}
}

func TestApplyCORSIncludesDeleteMethod(t *testing.T) {
	t.Parallel()

	server := &Server{
		cfg: config.Config{
			AllowedOrigins: []string{"*"},
		},
	}

	request := httptest.NewRequest(http.MethodOptions, "/api/v1/profile/blocked-users/user_1", nil)
	request.Header.Set("Origin", "http://localhost:19006")
	recorder := httptest.NewRecorder()

	server.applyCORS(recorder, request)

	allowMethods := recorder.Header().Get("Access-Control-Allow-Methods")
	if !strings.Contains(allowMethods, "DELETE") {
		t.Fatalf("Access-Control-Allow-Methods = %q, expected to contain DELETE", allowMethods)
	}
}

func TestApplyCORSAllowsPrivateDevelopmentOrigin(t *testing.T) {
	t.Parallel()

	server := &Server{
		cfg: config.Config{
			AllowedOrigins: []string{"http://localhost:8081"},
			Environment:    "development",
		},
	}

	request := httptest.NewRequest(http.MethodGet, "/api/v1/profile/me", nil)
	request.Header.Set("Origin", "http://192.168.1.42:19006")
	recorder := httptest.NewRecorder()

	server.applyCORS(recorder, request)

	if origin := recorder.Header().Get("Access-Control-Allow-Origin"); origin != "http://192.168.1.42:19006" {
		t.Fatalf("Access-Control-Allow-Origin = %q, want %q", origin, "http://192.168.1.42:19006")
	}
}

func TestApplyCORSSetsExposeAndVaryHeaders(t *testing.T) {
	t.Parallel()

	server := &Server{
		cfg: config.Config{
			AllowedOrigins: []string{"http://localhost:8081"},
			Environment:    "development",
		},
	}

	request := httptest.NewRequest(http.MethodGet, "/api/v1/profile/me", nil)
	request.Header.Set("Origin", "http://localhost:8081")
	recorder := httptest.NewRecorder()

	server.applyCORS(recorder, request)

	if vary := recorder.Header().Get("Vary"); vary != "Origin" {
		t.Fatalf("Vary = %q, want %q", vary, "Origin")
	}
	if expose := recorder.Header().Get("Access-Control-Expose-Headers"); expose != "Retry-After, X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset, X-Request-Id" {
		t.Fatalf("Access-Control-Expose-Headers = %q, want %q", expose, "Retry-After, X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset, X-Request-Id")
	}
	if maxAge := recorder.Header().Get("Access-Control-Max-Age"); maxAge != "600" {
		t.Fatalf("Access-Control-Max-Age = %q, want %q", maxAge, "600")
	}
}

func TestApplySecurityHeadersAddsProductionHSTS(t *testing.T) {
	t.Parallel()

	server := &Server{
		cfg: config.Config{
			Environment: "production",
		},
	}

	recorder := httptest.NewRecorder()

	server.applySecurityHeaders(recorder)

	if hsts := recorder.Header().Get("Strict-Transport-Security"); hsts == "" {
		t.Fatal("Strict-Transport-Security header should be present in production")
	}
	if policy := recorder.Header().Get("Cross-Origin-Opener-Policy"); policy != "same-origin" {
		t.Fatalf("Cross-Origin-Opener-Policy = %q, want %q", policy, "same-origin")
	}
	if policy := recorder.Header().Get("Cross-Origin-Resource-Policy"); policy != "same-site" {
		t.Fatalf("Cross-Origin-Resource-Policy = %q, want %q", policy, "same-site")
	}
}

func TestBearerTokenAllowsProfilePostMediaQueryToken(t *testing.T) {
	t.Parallel()

	server := &Server{}
	request := httptest.NewRequest(
		http.MethodGet,
		"/api/v1/profile/post-media/files/post_media_123?token=media-token",
		nil,
	)

	if token := server.bearerToken(request); token != "media-token" {
		t.Fatalf("bearerToken() = %q, want %q", token, "media-token")
	}
}

func TestRespondInternalErrorDoesNotLeakRawError(t *testing.T) {
	s := &Server{}
	recorder := httptest.NewRecorder()
	recorder.Header().Set("X-Request-Id", "req_test_123")

	s.respondInternalError(recorder, "feed_query_failed", errors.New("sql: password authentication failed"))

	if recorder.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusInternalServerError)
	}

	var payload struct {
		Error struct {
			Code      string `json:"code"`
			Message   string `json:"message"`
			RequestID string `json:"requestId"`
			Status    int    `json:"status"`
		} `json:"error"`
		Success bool `json:"success"`
	}

	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		t.Fatalf("unmarshal response: %v", err)
	}

	if payload.Success {
		t.Fatal("success should be false for internal error responses")
	}
	if payload.Error.Code != "feed_query_failed" {
		t.Fatalf("error.code = %q, want %q", payload.Error.Code, "feed_query_failed")
	}
	if payload.Error.Message != "Sunucu istegi su anda tamamlayamadi." {
		t.Fatalf("error.message = %q", payload.Error.Message)
	}
	if strings.Contains(payload.Error.Message, "sql:") {
		t.Fatalf("error.message leaked raw internal error: %q", payload.Error.Message)
	}
	if payload.Error.RequestID != "req_test_123" {
		t.Fatalf("error.requestId = %q, want %q", payload.Error.RequestID, "req_test_123")
	}
	if payload.Error.Status != http.StatusInternalServerError {
		t.Fatalf("error.status = %d, want %d", payload.Error.Status, http.StatusInternalServerError)
	}
}

func TestServeVoiceFileContentSupportsRangeRequests(t *testing.T) {
	t.Parallel()

	tempDir := t.TempDir()
	filePath := filepath.Join(tempDir, "voice_test.m4a")
	content := []byte("0123456789")
	if err := os.WriteFile(filePath, content, 0o644); err != nil {
		t.Fatalf("write temp voice file: %v", err)
	}

	file, err := os.Open(filePath)
	if err != nil {
		t.Fatalf("open temp voice file: %v", err)
	}
	defer file.Close()

	stat, err := file.Stat()
	if err != nil {
		t.Fatalf("stat temp voice file: %v", err)
	}

	request := httptest.NewRequest(http.MethodGet, "/api/v1/messages/voice/files/voice_1", nil)
	request.Header.Set("Range", "bytes=0-3")
	recorder := httptest.NewRecorder()

	serveVoiceFileContent(recorder, request, file, voiceFileRecord{
		FileName: "voice_test.m4a",
		MimeType: "audio/mp4",
	}, stat)

	if recorder.Code != http.StatusPartialContent {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusPartialContent)
	}
	if got := recorder.Header().Get("Accept-Ranges"); got != "bytes" {
		t.Fatalf("Accept-Ranges = %q, want %q", got, "bytes")
	}
	if got := recorder.Header().Get("Content-Type"); !strings.Contains(got, "audio/mp4") {
		t.Fatalf("Content-Type = %q, expected audio/mp4", got)
	}
	if got := recorder.Body.String(); got != "0123" {
		t.Fatalf("body = %q, want %q", got, "0123")
	}
}
