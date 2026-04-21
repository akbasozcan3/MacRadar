package server

import (
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"
)

type requestRateLimitRule struct {
	Limit  int
	Scope  string
	Window time.Duration
}

type requestRateLimitDecision struct {
	Allowed    bool
	Limit      int
	Remaining  int
	ResetAt    time.Time
	RetryAfter time.Duration
	Scope      string
}

type requestRateLimiter struct {
	buckets map[string]requestRateLimiterBucket
	mu      sync.Mutex
	now     func() time.Time
	ops     uint64
}

type requestRateLimiterBucket struct {
	count   int
	resetAt time.Time
}

func newRequestRateLimiter(now func() time.Time) *requestRateLimiter {
	if now == nil {
		now = time.Now
	}

	return &requestRateLimiter{
		buckets: make(map[string]requestRateLimiterBucket),
		now:     now,
	}
}

func (l *requestRateLimiter) allow(key string, limit int, window time.Duration) requestRateLimitDecision {
	now := l.now().UTC()
	if limit <= 0 || window <= 0 || strings.TrimSpace(key) == "" {
		return requestRateLimitDecision{
			Allowed:   true,
			Limit:     limit,
			Remaining: limit,
			ResetAt:   now,
		}
	}

	l.mu.Lock()
	defer l.mu.Unlock()

	l.ops++
	if l.ops%128 == 0 {
		l.compact(now)
	}

	bucket, ok := l.buckets[key]
	if !ok || !now.Before(bucket.resetAt) {
		bucket = requestRateLimiterBucket{
			count:   0,
			resetAt: now.Add(window),
		}
	}

	if bucket.count >= limit {
		l.buckets[key] = bucket
		return requestRateLimitDecision{
			Allowed:    false,
			Limit:      limit,
			Remaining:  0,
			ResetAt:    bucket.resetAt,
			RetryAfter: bucket.resetAt.Sub(now),
		}
	}

	bucket.count++
	l.buckets[key] = bucket

	remaining := limit - bucket.count
	if remaining < 0 {
		remaining = 0
	}

	return requestRateLimitDecision{
		Allowed:   true,
		Limit:     limit,
		Remaining: remaining,
		ResetAt:   bucket.resetAt,
	}
}

func (l *requestRateLimiter) compact(now time.Time) {
	for key, bucket := range l.buckets {
		if !now.Before(bucket.resetAt) {
			delete(l.buckets, key)
		}
	}
}

func retryAfterSeconds(value time.Duration) int {
	if value <= 0 {
		return 1
	}

	seconds := int(value / time.Second)
	if value%time.Second != 0 {
		seconds++
	}
	if seconds < 1 {
		return 1
	}
	return seconds
}

func (s *Server) requestRateLimitRule(r *http.Request) (requestRateLimitRule, bool) {
	path := strings.ToLower(strings.TrimSpace(r.URL.Path))

	switch {
	case r.Method == http.MethodPost && strings.HasPrefix(path, "/api/v1/auth/"):
		if path == "/api/v1/auth/logout" || path == "/api/v1/dev/auth/reset" {
			return requestRateLimitRule{}, false
		}
		return requestRateLimitRule{
			Limit:  s.cfg.AuthRateLimitMaxRequests,
			Scope:  "auth",
			Window: s.cfg.AuthRateLimitWindow,
		}, true
	case r.Method == http.MethodGet && strings.HasPrefix(path, "/api/v1/explore/search/"):
		return requestRateLimitRule{
			Limit:  s.cfg.SearchRateLimitMaxRequests,
			Scope:  "explore_search",
			Window: s.cfg.SearchRateLimitWindow,
		}, true
	default:
		return requestRateLimitRule{}, false
	}
}

func (s *Server) applyRateLimitHeaders(w http.ResponseWriter, decision requestRateLimitDecision) {
	if decision.Limit > 0 {
		w.Header().Set("X-RateLimit-Limit", strconv.Itoa(decision.Limit))
	}
	w.Header().Set("X-RateLimit-Remaining", strconv.Itoa(maxInt(decision.Remaining, 0)))
	if !decision.ResetAt.IsZero() {
		w.Header().Set("X-RateLimit-Reset", decision.ResetAt.UTC().Format(time.RFC3339))
	}
}

func maxInt(a int, b int) int {
	if a > b {
		return a
	}
	return b
}
