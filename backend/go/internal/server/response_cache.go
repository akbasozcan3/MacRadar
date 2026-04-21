package server

import (
	"context"
	"fmt"
	"strings"
	"time"

	"macradar/backend/internal/cache"
)

func (s *Server) cacheKey(parts ...string) string {
	normalized := make([]string, 0, len(parts))
	for _, part := range parts {
		trimmed := strings.TrimSpace(part)
		if trimmed == "" {
			continue
		}
		normalized = append(normalized, trimmed)
	}
	if len(normalized) == 0 {
		return ""
	}
	return strings.Join(normalized, ":")
}

func (s *Server) cacheGetJSON(ctx context.Context, key string, target any) bool {
	if strings.TrimSpace(key) == "" {
		return false
	}
	payload, found, err := s.cache.Get(ctx, key)
	if err != nil || !found {
		return false
	}
	if err := cache.Unmarshal(payload, target); err != nil {
		return false
	}
	return true
}

func (s *Server) cacheSetJSON(ctx context.Context, key string, ttl time.Duration, payload any) {
	if strings.TrimSpace(key) == "" || ttl <= 0 {
		return
	}
	encoded, err := cache.Marshal(payload)
	if err != nil {
		return
	}
	_ = s.cache.Set(ctx, key, encoded, ttl)
}

func (s *Server) cacheInvalidatePrefixes(ctx context.Context, prefixes ...string) {
	for _, prefix := range prefixes {
		trimmed := strings.TrimSpace(prefix)
		if trimmed == "" {
			continue
		}
		_ = s.cache.DeleteByPrefix(ctx, trimmed)
	}
}

func formatIntBool(value bool) string {
	if value {
		return "1"
	}
	return "0"
}

func buildQueryHash(parts ...string) string {
	return fmt.Sprintf("%x", strings.Join(parts, "|"))
}
