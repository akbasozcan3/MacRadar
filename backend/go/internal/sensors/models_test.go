package sensors

import (
	"testing"
	"time"
)

func TestNormalizeEventDefaults(t *testing.T) {
	normalized := NormalizeEvent(Event{}, "user_1", "go.ws")

	if normalized.Type != EventTypeReading {
		t.Fatalf("type = %q, want %q", normalized.Type, EventTypeReading)
	}
	if normalized.Source != "go.ws" {
		t.Fatalf("source = %q, want %q", normalized.Source, "go.ws")
	}
	if normalized.Reading.UserID != "user_1" {
		t.Fatalf("user id = %q, want %q", normalized.Reading.UserID, "user_1")
	}
	if normalized.Reading.DeviceID == "" {
		t.Fatal("device id should be generated")
	}
	if normalized.Reading.CapturedAt.IsZero() {
		t.Fatal("capturedAt should be set")
	}
	if normalized.ServerTime.IsZero() {
		t.Fatal("serverTime should be set")
	}
}

func TestNormalizeEventPreservesProvidedValues(t *testing.T) {
	now := time.Now().Add(-time.Minute)
	original := Event{
		Type:       "sensor.reading",
		Source:     "rust",
		ServerTime: now,
		Reading: Reading{
			DeviceID:   "device_42",
			UserID:     "user_42",
			Sensor:     "gps",
			CapturedAt: now.Add(-2 * time.Second),
		},
	}

	normalized := NormalizeEvent(original, "fallback", "go.ws")
	if normalized.Source != "rust" {
		t.Fatalf("source = %q, want %q", normalized.Source, "rust")
	}
	if normalized.Reading.DeviceID != "device_42" {
		t.Fatalf("device id = %q, want %q", normalized.Reading.DeviceID, "device_42")
	}
	if normalized.Reading.UserID != "user_42" {
		t.Fatalf("user id = %q, want %q", normalized.Reading.UserID, "user_42")
	}
}
