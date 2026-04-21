package sensors

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

type BridgeConfig struct {
	Enabled          bool
	HandshakeTimeout time.Duration
	ReconnectDelay   time.Duration
	URL              string
}

type Bridge struct {
	cfg    BridgeConfig
	hub    *Hub
	logger *slog.Logger

	outbound chan Event
}

func NewBridge(cfg BridgeConfig, hub *Hub, logger *slog.Logger) *Bridge {
	if hub == nil {
		hub = NewHub(logger)
	}

	if cfg.HandshakeTimeout <= 0 {
		cfg.HandshakeTimeout = 5 * time.Second
	}
	if cfg.ReconnectDelay <= 0 {
		cfg.ReconnectDelay = 2 * time.Second
	}

	return &Bridge{
		cfg:      cfg,
		hub:      hub,
		logger:   logger,
		outbound: make(chan Event, 512),
	}
}

func (b *Bridge) Start(ctx context.Context) {
	if !b.cfg.Enabled {
		if b.logger != nil {
			b.logger.Info("sensor bridge disabled")
		}
		return
	}
	if strings.TrimSpace(b.cfg.URL) == "" {
		if b.logger != nil {
			b.logger.Info("sensor bridge disabled because rust url is empty")
		}
		return
	}

	go b.run(ctx)
}

func (b *Bridge) Publish(event Event) {
	normalized := NormalizeEvent(event, event.Reading.UserID, "go.bridge")

	select {
	case b.outbound <- normalized:
		return
	default:
	}

	select {
	case <-b.outbound:
	default:
	}

	select {
	case b.outbound <- normalized:
	default:
	}
}

func (b *Bridge) run(ctx context.Context) {
	for {
		if ctx.Err() != nil {
			return
		}

		if err := b.connectAndPump(ctx); err != nil && !errors.Is(err, context.Canceled) {
			if b.logger != nil {
				b.logger.Warn("sensor bridge disconnected", slog.Any("error", err))
			}
		}

		select {
		case <-ctx.Done():
			return
		case <-time.After(b.cfg.ReconnectDelay):
		}
	}
}

func (b *Bridge) connectAndPump(ctx context.Context) error {
	dialer := websocket.Dialer{
		HandshakeTimeout: b.cfg.HandshakeTimeout,
	}

	conn, _, err := dialer.DialContext(ctx, b.cfg.URL, nil)
	if err != nil {
		return err
	}
	if b.logger != nil {
		b.logger.Info("sensor bridge connected", slog.String("url", b.cfg.URL))
	}

	var closeOnce sync.Once
	closeConn := func() {
		closeOnce.Do(func() {
			_ = conn.Close()
		})
	}
	defer closeConn()

	errCh := make(chan error, 2)

	go func() {
		defer closeConn()
		conn.SetReadLimit(sensorMaxIncomingMessageBytes)
		_ = conn.SetReadDeadline(time.Now().Add(2 * sensorPingPeriod))
		conn.SetPongHandler(func(string) error {
			return conn.SetReadDeadline(time.Now().Add(2 * sensorPingPeriod))
		})

		for {
			_, payload, readErr := conn.ReadMessage()
			if readErr != nil {
				errCh <- readErr
				return
			}

			var event Event
			if err := json.Unmarshal(payload, &event); err != nil {
				continue
			}

			event = NormalizeEvent(event, event.Reading.UserID, "rust")
			if strings.EqualFold(event.Source, "go.bridge") {
				continue
			}
			b.hub.Broadcast(event)
		}
	}()

	go func() {
		defer closeConn()
		ticker := time.NewTicker(sensorPingPeriod)
		defer ticker.Stop()

		for {
			select {
			case <-ctx.Done():
				errCh <- ctx.Err()
				return
			case event := <-b.outbound:
				message, marshalErr := json.Marshal(event)
				if marshalErr != nil {
					if b.logger != nil {
						b.logger.Error("sensor bridge marshal outbound failed", slog.Any("error", marshalErr))
					}
					continue
				}

				_ = conn.SetWriteDeadline(time.Now().Add(sensorClientWriteWait))
				if writeErr := conn.WriteMessage(websocket.TextMessage, message); writeErr != nil {
					errCh <- writeErr
					return
				}
			case <-ticker.C:
				_ = conn.SetWriteDeadline(time.Now().Add(sensorClientWriteWait))
				if pingErr := conn.WriteMessage(websocket.PingMessage, nil); pingErr != nil {
					errCh <- pingErr
					return
				}
			}
		}
	}()

	select {
	case <-ctx.Done():
		return ctx.Err()
	case runErr := <-errCh:
		return runErr
	}
}
