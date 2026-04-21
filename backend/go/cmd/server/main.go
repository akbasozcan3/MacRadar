package main

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"macradar/backend/internal/account"
	"macradar/backend/internal/cache"
	"macradar/backend/internal/config"
	"macradar/backend/internal/explore"

	"macradar/backend/internal/mail"
	"macradar/backend/internal/migrate"
	"macradar/backend/internal/sensors"
	"macradar/backend/internal/server"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
)

func main() {
	cfg := config.Load()
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))

	if err := cfg.Validate(); err != nil {
		logger.Error("configuration validation failed", slog.Any("error", err))
		os.Exit(1)
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	poolConfig, err := pgxpool.ParseConfig(cfg.DatabaseURL)
	if err != nil {
		logger.Error("database config parse failed", slog.Any("error", err))
		os.Exit(1)
	}

	poolConfig.MaxConns = cfg.DBMaxConns
	poolConfig.MinConns = cfg.DBMinConns
	poolConfig.MaxConnLifetime = cfg.DBMaxConnLifetime
	poolConfig.MaxConnIdleTime = cfg.DBMaxConnIdleTime

	pool, err := pgxpool.NewWithConfig(ctx, poolConfig)
	if err != nil {
		logger.Error("database pool init failed", slog.Any("error", err))
		os.Exit(1)
	}
	defer pool.Close()

	startupCtx, startupCancel := context.WithTimeout(ctx, 10*time.Second)
	defer startupCancel()

	if err := pool.Ping(startupCtx); err != nil {
		logger.Error("database ping failed", slog.Any("error", err))
		os.Exit(1)
	}

	if err := migrate.Run(startupCtx, pool, logger, cfg.MigrationsDir); err != nil {
		logger.Error("database migration failed", slog.Any("error", err))
		os.Exit(1)
	}

	accountRepo := account.NewRepository(pool)
	mailer := mail.NewSMTPService(mail.Config{
		AppBaseURL: cfg.AppBaseURL,
		From:       cfg.SMTPFrom,
		Host:       cfg.SMTPHost,
		Pass:       cfg.SMTPPass,
		Port:       cfg.SMTPPort,
		User:       cfg.SMTPUser,
	})
	accountService := account.NewService(accountRepo, mailer, account.ServiceConfig{
		AppBaseURL:                  cfg.AppBaseURL,
		AuthDebugPreview:            cfg.AuthDebugPreview,
		Environment:                 cfg.Environment,
		GoogleWebClientID:           cfg.GoogleWebClientID,
		JWTSecret:                   cfg.JWTSecret,
		LoginAttemptWindow:          cfg.LoginAttemptWindow,
		LoginMaxAttempts:            cfg.LoginMaxAttempts,
		PasswordHashCost:            cfg.PasswordHashCost,
		PasswordResetCodeTTL:        cfg.PasswordResetCodeTTL,
		PasswordResetMaxAttempts:    cfg.PasswordResetMaxAttempts,
		PasswordResetMaxSendsWindow: cfg.PasswordResetMaxSendsPerWindow,
		PasswordResetResendCooldown: cfg.PasswordResetResendCooldown,
		PasswordResetSendWindow:     cfg.PasswordResetSendWindow,
		VerificationMaxSendsWindow:  cfg.VerificationMaxSendsPerWindow,
		VerificationResendCooldown:  cfg.VerificationResendCooldown,
		VerificationSendWindow:      cfg.VerificationSendWindow,
		VerificationTokenTTL:        cfg.VerificationTokenTTL,
	}, logger)

	repo := explore.NewRepository(pool)
	var responseCache cache.Store = cache.NoopStore{}
	var redisClient *redis.Client

	if cfg.RedisURL != "" {
		redisStore, redisErr := cache.NewRedisStore(cfg.RedisURL, cfg.RedisCacheNamespace)
		if redisErr != nil {
			logger.Error("redis cache init failed", slog.Any("error", redisErr))
			os.Exit(1)
		}
		defer redisStore.Close()
		if pingErr := redisStore.Ping(startupCtx); pingErr != nil {
			logger.Error("redis cache ping failed", slog.Any("error", pingErr))
			os.Exit(1)
		}
		responseCache = redisStore
		redisClient = redisStore.Client()
	}

	hub := explore.NewHub(logger, redisClient)
	sensorHub := sensors.NewHub(logger)
	sensorBridge := sensors.NewBridge(sensors.BridgeConfig{
		Enabled:          cfg.RustSensorBridgeEnabled,
		HandshakeTimeout: cfg.RustSensorBridgeHandshakeTimeout,
		ReconnectDelay:   cfg.RustSensorBridgeReconnectDelay,
		URL:              cfg.RustSensorWSURL,
	}, sensorHub, logger)
	sensorBridge.Start(ctx)
	api := server.New(cfg, logger, accountService, repo, responseCache, hub, sensorHub, sensorBridge)

	httpServer := &http.Server{
		Addr:              fmt.Sprintf(":%s", cfg.Port),
		Handler:           api.Routes(),
		IdleTimeout:       cfg.IdleTimeout,
		MaxHeaderBytes:    cfg.MaxHeaderBytes,
		ReadHeaderTimeout: cfg.ReadHeaderTimeout,
		ReadTimeout:       cfg.ReadTimeout,
		WriteTimeout:      cfg.WriteTimeout,
	}

	go func() {
		logger.Info(
			"explore backend listening",
			slog.String("addr", httpServer.Addr),
			slog.String("env", cfg.Environment),
			slog.Int("db_max_conns", int(cfg.DBMaxConns)),
			slog.Int64("max_request_body_bytes", cfg.MaxRequestBodyBytes),
			slog.Bool("rust_sensor_bridge_enabled", cfg.RustSensorBridgeEnabled),
			slog.String("rust_sensor_ws_url", cfg.RustSensorWSURL),
		)
		if err := httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			logger.Error("http server failed", slog.Any("error", err))
			stop()
		}
	}()

	<-ctx.Done()

	logger.Info("shutdown started")

	shutdownCtx, cancel := context.WithTimeout(context.Background(), cfg.ShutdownTimeout)
	defer cancel()

	if err := httpServer.Shutdown(shutdownCtx); err != nil {
		logger.Error("graceful shutdown failed", slog.Any("error", err))
		os.Exit(1)
	}

	logger.Info("shutdown completed")
}
