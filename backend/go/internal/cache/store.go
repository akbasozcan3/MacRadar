package cache

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/redis/go-redis/v9"
)

type Store interface {
	Get(ctx context.Context, key string) ([]byte, bool, error)
	Set(ctx context.Context, key string, value []byte, ttl time.Duration) error
	DeleteByPrefix(ctx context.Context, prefix string) error
}

type NoopStore struct{}

func (NoopStore) Get(context.Context, string) ([]byte, bool, error) {
	return nil, false, nil
}

func (NoopStore) Set(context.Context, string, []byte, time.Duration) error {
	return nil
}

func (NoopStore) DeleteByPrefix(context.Context, string) error {
	return nil
}

type RedisStore struct {
	client    *redis.Client
	namespace string
}

func (s *RedisStore) Client() *redis.Client {
	return s.client
}

func NewRedisStore(redisURL string, namespace string) (*RedisStore, error) {
	parsedURL := strings.TrimSpace(redisURL)
	if parsedURL == "" {
		return nil, errors.New("redis url is required")
	}
	options, err := redis.ParseURL(parsedURL)
	if err != nil {
		return nil, err
	}
	client := redis.NewClient(options)
	return &RedisStore{
		client:    client,
		namespace: strings.TrimSpace(namespace),
	}, nil
}

func (s *RedisStore) Ping(ctx context.Context) error {
	return s.client.Ping(ctx).Err()
}

func (s *RedisStore) Close() error {
	return s.client.Close()
}

func (s *RedisStore) Get(ctx context.Context, key string) ([]byte, bool, error) {
	value, err := s.client.Get(ctx, s.prefixed(key)).Bytes()
	if errors.Is(err, redis.Nil) {
		return nil, false, nil
	}
	if err != nil {
		return nil, false, err
	}
	return value, true, nil
}

func (s *RedisStore) Set(ctx context.Context, key string, value []byte, ttl time.Duration) error {
	return s.client.Set(ctx, s.prefixed(key), value, ttl).Err()
}

func (s *RedisStore) DeleteByPrefix(ctx context.Context, prefix string) error {
	cursor := uint64(0)
	pattern := s.prefixed(prefix) + "*"
	for {
		keys, next, err := s.client.Scan(ctx, cursor, pattern, 250).Result()
		if err != nil {
			return err
		}
		if len(keys) > 0 {
			if err := s.client.Del(ctx, keys...).Err(); err != nil {
				return err
			}
		}
		cursor = next
		if cursor == 0 {
			break
		}
	}
	return nil
}

func (s *RedisStore) prefixed(key string) string {
	key = strings.TrimSpace(key)
	if s.namespace == "" {
		return key
	}
	return s.namespace + ":" + key
}

func Marshal(value any) ([]byte, error) {
	return json.Marshal(value)
}

func Unmarshal(payload []byte, target any) error {
	return json.Unmarshal(payload, target)
}
