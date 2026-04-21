package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	AdminPostHardDeleteToken         string
	AllowedOrigins                   []string
	AppBaseURL                       string
	AuthRateLimitMaxRequests         int
	AuthRateLimitWindow              time.Duration
	AuthDebugPreview                 bool
	DatabaseURL                      string
	DBMaxConnIdleTime                time.Duration
	DBMaxConnLifetime                time.Duration
	DBMaxConns                       int32
	DBMinConns                       int32
	DevelopmentResetToken            string
	Environment                      string
	GoogleWebClientID                string
	IdleTimeout                      time.Duration
	JWTSecret                        string
	LoginAttemptWindow               time.Duration
	LoginMaxAttempts                 int
	MaxHeaderBytes                   int
	MaxRequestBodyBytes              int64
	MapboxPublicToken                string
	MigrationsDir                    string
	PasswordHashCost                 int
	PasswordResetCodeTTL             time.Duration
	PasswordResetMaxAttempts         int
	PasswordResetMaxSendsPerWindow   int
	PasswordResetResendCooldown      time.Duration
	PasswordResetSendWindow          time.Duration
	Port                             string
	ReadTimeout                      time.Duration
	ReadHeaderTimeout                time.Duration
	RedisURL                         string
	RedisCacheNamespace              string
	RustSensorBridgeEnabled          bool
	RustSensorBridgeHandshakeTimeout time.Duration
	RustSensorBridgeReconnectDelay   time.Duration
	RustSensorWSURL                  string
	ShutdownTimeout                  time.Duration
	SMTPFrom                         string
	SMTPHost                         string
	SMTPPass                         string
	SMTPPort                         int
	SMTPUser                         string
	VerificationMaxSendsPerWindow    int
	VerificationResendCooldown       time.Duration
	VerificationSendWindow           time.Duration
	VerificationTokenTTL             time.Duration
	ViewerUserID                     string
	WriteTimeout                     time.Duration
	SearchRateLimitMaxRequests       int
	SearchRateLimitWindow            time.Duration
	SearchPopularABEnabled           bool
	SearchPopularBTrafficPercent     int
	TrackingIngestToken              string
	TrackingSessionInactivityTimeout time.Duration
}

const (
	defaultAppBaseURL  = "http://127.0.0.1:8090"
	defaultDatabaseURL = "postgres://macradar:macradar@localhost:5432/macradar?sslmode=disable"
	defaultJWTSecret   = "dev-jwt-secret-change-me"
	defaultGoogleWebClientID = "112430380576-1s4htkhf9j58fcqheva1vprshcstnr0u.apps.googleusercontent.com"
)

func Load() Config {
	loadDotEnvFiles()

	appEnv := normalizeEnvironment(getEnv("APP_ENV", "development"))
	developmentResetTokenDefault := ""
	if appEnv != "production" {
		developmentResetTokenDefault = "macradar-local-reset"
	}

	smtpUser := getEnv("SMTP_USER", "")
	smtpPass := compactSMTPPassword(getEnv("SMTP_PASS", ""))
	smtpFrom := getEnv("SMTP_FROM", "")
	if smtpFrom == "" && smtpUser != "" {
		smtpFrom = fmt.Sprintf("MacRadar Security <%s>", smtpUser)
	}

	return Config{
		AdminPostHardDeleteToken:         getEnv("ADMIN_POST_HARD_DELETE_TOKEN", ""),
		AllowedOrigins:                   splitCSV(getEnv("ALLOWED_ORIGINS", "http://localhost:8081,http://127.0.0.1:8081,http://10.0.2.2:8081")),
		AppBaseURL:                       strings.TrimRight(getEnv("APP_BASE_URL", defaultAppBaseURL), "/"),
		AuthRateLimitMaxRequests:         getIntEnv("AUTH_RATE_LIMIT_MAX_REQUESTS", 40),
		AuthRateLimitWindow:              getDurationEnv("AUTH_RATE_LIMIT_WINDOW", time.Minute),
		AuthDebugPreview:                 getBoolEnv("AUTH_DEBUG_PREVIEW", false),
		DatabaseURL:                      getEnv("DATABASE_URL", defaultDatabaseURL),
		DBMaxConnIdleTime:                getDurationEnv("DB_MAX_CONN_IDLE_TIME", 15*time.Minute),
		DBMaxConnLifetime:                getDurationEnv("DB_MAX_CONN_LIFETIME", time.Hour),
		DBMaxConns:                       int32(getIntEnv("DB_MAX_CONNS", 12)),
		DBMinConns:                       int32(getIntEnv("DB_MIN_CONNS", 2)),
		DevelopmentResetToken:            getEnv("DEV_RESET_TOKEN", developmentResetTokenDefault),
		Environment:                      appEnv,
		GoogleWebClientID:                getEnv("GOOGLE_WEB_CLIENT_ID", defaultGoogleWebClientID),
		IdleTimeout:                      getDurationEnv("IDLE_TIMEOUT", 60*time.Second),
		JWTSecret:                        getEnv("JWT_SECRET", defaultJWTSecret),
		LoginAttemptWindow:               getDurationEnv("LOGIN_ATTEMPT_WINDOW", 15*time.Minute),
		LoginMaxAttempts:                 getIntEnv("LOGIN_MAX_ATTEMPTS", 5),
		MaxHeaderBytes:                   getIntEnv("MAX_HEADER_BYTES", 1<<20),
		MaxRequestBodyBytes:              int64(getIntEnv("MAX_REQUEST_BODY_BYTES", 12<<20)),
		MapboxPublicToken:                getEnv("MAPBOX_PUBLIC_TOKEN", ""),
		MigrationsDir:                    getEnv("MIGRATIONS_DIR", "backend/migrations"),
		PasswordHashCost:                 getIntEnv("BCRYPT_COST", 10),
		PasswordResetCodeTTL:             getDurationEnv("PASSWORD_RESET_CODE_TTL", 10*time.Minute),
		PasswordResetMaxAttempts:         getIntEnv("PASSWORD_RESET_MAX_ATTEMPTS", 5),
		PasswordResetMaxSendsPerWindow:   getIntEnv("PASSWORD_RESET_MAX_SENDS_PER_WINDOW", 5),
		PasswordResetResendCooldown:      getDurationEnv("PASSWORD_RESET_RESEND_COOLDOWN", 60*time.Second),
		PasswordResetSendWindow:          getDurationEnv("PASSWORD_RESET_SEND_WINDOW", time.Hour),
		Port:                             getEnv("PORT", "8090"),
		ReadTimeout:                      5 * time.Second,
		ReadHeaderTimeout:                getDurationEnv("READ_HEADER_TIMEOUT", 3*time.Second),
		RedisURL:                         getEnv("REDIS_URL", ""),
		RedisCacheNamespace:              getEnv("REDIS_CACHE_NAMESPACE", "macradar"),
		RustSensorBridgeEnabled:          getBoolEnv("RUST_SENSOR_BRIDGE_ENABLED", false),
		RustSensorBridgeHandshakeTimeout: getDurationEnv("RUST_SENSOR_BRIDGE_HANDSHAKE_TIMEOUT", 5*time.Second),
		RustSensorBridgeReconnectDelay:   getDurationEnv("RUST_SENSOR_BRIDGE_RECONNECT_DELAY", 2*time.Second),
		RustSensorWSURL:                  getEnv("RUST_SENSOR_WS_URL", "ws://127.0.0.1:8181/ws/sensors"),
		ShutdownTimeout:                  getDurationEnv("SHUTDOWN_TIMEOUT", 10*time.Second),
		SMTPFrom:                         smtpFrom,
		SMTPHost:                         getEnv("SMTP_HOST", ""),
		SMTPPass:                         smtpPass,
		SMTPPort:                         getIntEnv("SMTP_PORT", 587),
		SMTPUser:                         smtpUser,
		VerificationMaxSendsPerWindow:    getIntEnv("VERIFICATION_MAX_SENDS_PER_WINDOW", 5),
		VerificationResendCooldown:       getDurationEnv("VERIFICATION_RESEND_COOLDOWN", 60*time.Second),
		VerificationSendWindow:           getDurationEnv("VERIFICATION_SEND_WINDOW", time.Hour),
		VerificationTokenTTL:             getDurationEnv("VERIFICATION_TOKEN_TTL", 24*time.Hour),
		ViewerUserID:                     getEnv("VIEWER_USER_ID", "user_viewer_local"),
		WriteTimeout:                     10 * time.Second,
		SearchRateLimitMaxRequests:       getIntEnv("SEARCH_RATE_LIMIT_MAX_REQUESTS", 90),
		SearchRateLimitWindow:            getDurationEnv("SEARCH_RATE_LIMIT_WINDOW", time.Minute),
		SearchPopularABEnabled:           getBoolEnv("SEARCH_POPULAR_AB_ENABLED", true),
		SearchPopularBTrafficPercent:     getIntEnv("SEARCH_POPULAR_B_TRAFFIC_PERCENT", 50),
		TrackingIngestToken:              getEnv("TRACKING_INGEST_TOKEN", "macradar-tracking-ingest-dev"),
		TrackingSessionInactivityTimeout: getDurationEnv("TRACKING_SESSION_INACTIVITY_TIMEOUT", 10*time.Minute),
	}
}

func (c Config) Validate() error {
	var issues []string

	if strings.TrimSpace(c.Port) == "" {
		issues = append(issues, "PORT must not be empty")
	}
	if c.MaxRequestBodyBytes <= 0 {
		issues = append(issues, "MAX_REQUEST_BODY_BYTES must be greater than zero")
	}
	if c.DBMinConns < 0 {
		issues = append(issues, "DB_MIN_CONNS must not be negative")
	}
	if c.DBMaxConns <= 0 {
		issues = append(issues, "DB_MAX_CONNS must be greater than zero")
	}
	if c.DBMaxConns < c.DBMinConns {
		issues = append(issues, "DB_MAX_CONNS must be greater than or equal to DB_MIN_CONNS")
	}
	if c.ReadHeaderTimeout <= 0 || c.ReadTimeout <= 0 || c.WriteTimeout <= 0 || c.ShutdownTimeout <= 0 {
		issues = append(issues, "HTTP timeout values must be greater than zero")
	}
	if c.TrackingSessionInactivityTimeout <= 0 {
		issues = append(issues, "TRACKING_SESSION_INACTIVITY_TIMEOUT must be greater than zero")
	}
	if c.PasswordHashCost < 8 || c.PasswordHashCost > 14 {
		issues = append(issues, "BCRYPT_COST must be between 8 and 14")
	}
	if c.AuthRateLimitMaxRequests <= 0 || c.AuthRateLimitWindow <= 0 {
		issues = append(issues, "auth rate limit values must be greater than zero")
	}
	if c.SearchRateLimitMaxRequests <= 0 || c.SearchRateLimitWindow <= 0 {
		issues = append(issues, "search rate limit values must be greater than zero")
	}
	if c.SearchPopularBTrafficPercent < 0 || c.SearchPopularBTrafficPercent > 100 {
		issues = append(issues, "SEARCH_POPULAR_B_TRAFFIC_PERCENT must be between 0 and 100")
	}

	if strings.EqualFold(c.Environment, "production") {
		jwtSecret := strings.TrimSpace(c.JWTSecret)
		if jwtSecret == "" || jwtSecret == defaultJWTSecret || len(jwtSecret) < 32 {
			issues = append(issues, "JWT_SECRET must be set to a strong value in production")
		}
		if c.AuthDebugPreview {
			issues = append(issues, "AUTH_DEBUG_PREVIEW must be false in production")
		}
		if strings.TrimSpace(c.DatabaseURL) == "" || strings.EqualFold(strings.TrimSpace(c.DatabaseURL), defaultDatabaseURL) {
			issues = append(issues, "DATABASE_URL must be explicitly configured in production")
		}
		if len(c.AllowedOrigins) == 0 {
			issues = append(issues, "ALLOWED_ORIGINS must include at least one origin in production")
		}
		for _, origin := range c.AllowedOrigins {
			if strings.TrimSpace(origin) == "*" {
				issues = append(issues, "ALLOWED_ORIGINS cannot contain wildcard in production")
				break
			}
		}
		if baseURL := strings.ToLower(strings.TrimSpace(c.AppBaseURL)); baseURL == "" || strings.Contains(baseURL, "localhost") || strings.Contains(baseURL, "127.0.0.1") {
			issues = append(issues, "APP_BASE_URL must be publicly reachable in production")
		}
	}

	if len(issues) > 0 {
		return fmt.Errorf("invalid configuration: %s", strings.Join(issues, "; "))
	}

	return nil
}

func normalizeEnvironment(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "prod":
		return "production"
	case "dev":
		return "development"
	case "test":
		return "testing"
	default:
		normalized := strings.ToLower(strings.TrimSpace(value))
		if normalized == "" {
			return "development"
		}
		return normalized
	}
}

func getEnv(key string, fallback string) string {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}

	return value
}

func getDurationEnv(key string, fallback time.Duration) time.Duration {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}

	parsed, err := time.ParseDuration(value)
	if err != nil {
		return fallback
	}

	return parsed
}

func getIntEnv(key string, fallback int) int {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}

	parsed, err := strconv.Atoi(value)
	if err != nil {
		return fallback
	}

	return parsed
}

func getBoolEnv(key string, fallback bool) bool {
	value := strings.ToLower(strings.TrimSpace(os.Getenv(key)))
	if value == "" {
		return fallback
	}

	switch value {
	case "1", "true", "yes", "on":
		return true
	case "0", "false", "no", "off":
		return false
	default:
		return fallback
	}
}

func splitCSV(value string) []string {
	rawItems := strings.Split(value, ",")
	items := make([]string, 0, len(rawItems))

	for _, item := range rawItems {
		trimmed := strings.TrimSpace(item)
		if trimmed == "" {
			continue
		}

		items = append(items, trimmed)
	}

	return items
}

func compactSMTPPassword(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}

	replacer := strings.NewReplacer(" ", "", "\t", "", "\n", "", "\r", "")
	return replacer.Replace(value)
}
