package sensors

import (
	"strings"
	"time"
)

const (
	EventTypeReading  = "sensor.reading"
	EventTypeSnapshot = "sensor.snapshot"
	EventTypeWelcome  = "welcome"
)

type Reading struct {
	Accuracy   float64   `json:"accuracy,omitempty"`
	CapturedAt time.Time `json:"capturedAt"`
	DeviceID   string    `json:"deviceId"`
	Heading    float64   `json:"heading,omitempty"`
	Latitude   float64   `json:"latitude,omitempty"`
	Longitude  float64   `json:"longitude,omitempty"`
	Sequence   int64     `json:"sequence,omitempty"`
	Sensor     string    `json:"sensor"`
	Speed      float64   `json:"speed,omitempty"`
	UserID     string    `json:"userId,omitempty"`
	X          float64   `json:"x,omitempty"`
	Y          float64   `json:"y,omitempty"`
	Z          float64   `json:"z,omitempty"`
}

type Event struct {
	Reading    Reading   `json:"reading"`
	ServerTime time.Time `json:"serverTime"`
	Source     string    `json:"source,omitempty"`
	Type       string    `json:"type"`
}

type SnapshotEvent struct {
	Readings   []Event   `json:"readings"`
	ServerTime time.Time `json:"serverTime"`
	Type       string    `json:"type"`
}

func NormalizeEvent(event Event, fallbackUserID string, source string) Event {
	normalized := event

	if strings.TrimSpace(normalized.Type) == "" {
		normalized.Type = EventTypeReading
	}
	if strings.TrimSpace(normalized.Source) == "" {
		normalized.Source = strings.TrimSpace(source)
	}

	now := time.Now().UTC()
	if normalized.ServerTime.IsZero() {
		normalized.ServerTime = now
	} else {
		normalized.ServerTime = normalized.ServerTime.UTC()
	}

	if strings.TrimSpace(normalized.Reading.UserID) == "" && strings.TrimSpace(fallbackUserID) != "" {
		normalized.Reading.UserID = strings.TrimSpace(fallbackUserID)
	}
	if strings.TrimSpace(normalized.Reading.Sensor) == "" {
		normalized.Reading.Sensor = "unknown"
	}
	if normalized.Reading.CapturedAt.IsZero() {
		normalized.Reading.CapturedAt = normalized.ServerTime
	} else {
		normalized.Reading.CapturedAt = normalized.Reading.CapturedAt.UTC()
	}
	if strings.TrimSpace(normalized.Reading.DeviceID) == "" {
		if normalized.Reading.UserID != "" {
			normalized.Reading.DeviceID = "device_" + normalized.Reading.UserID
		} else {
			normalized.Reading.DeviceID = "device_unknown"
		}
	}

	return normalized
}
