package realtime

import (
	"math"
	"strings"
	"time"
)

const earthRadiusMeters = 6371000

func normalizeID(value string, fallback string) string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return fallback
	}

	return trimmed
}

func sanitizePositionMessage(
	incoming PositionMessage,
	playerID string,
	roomID string,
) (PositionMessage, bool) {
	if !isFinite(incoming.Latitude) || !isFinite(incoming.Longitude) {
		return PositionMessage{}, false
	}
	if incoming.Latitude < -90 || incoming.Latitude > 90 {
		return PositionMessage{}, false
	}
	if incoming.Longitude < -180 || incoming.Longitude > 180 {
		return PositionMessage{}, false
	}

	incoming.Type = messageTypePosition
	incoming.PlayerID = playerID
	incoming.RoomID = roomID
	incoming.Timestamp = normalizeTimestamp(incoming.Timestamp)
	incoming.Accuracy = clampFloat(incoming.Accuracy, 0, 999)
	incoming.AccelX = clampFloat(defaultZero(incoming.AccelX), -20, 20)
	incoming.AccelY = clampFloat(defaultZero(incoming.AccelY), -20, 20)
	incoming.AccelZ = clampFloat(defaultZero(incoming.AccelZ), -20, 20)
	incoming.GyroX = clampFloat(defaultZero(incoming.GyroX), -40, 40)
	incoming.GyroY = clampFloat(defaultZero(incoming.GyroY), -40, 40)
	incoming.GyroZ = clampFloat(defaultZero(incoming.GyroZ), -40, 40)
	incoming.HeadingAC = clampFloat(defaultZero(incoming.HeadingAC), 0, 360)
	incoming.Heading = normalizeHeading(incoming.Heading)
	incoming.MotionE = clampFloat(defaultZero(incoming.MotionE), 0, 5)
	incoming.MotionX = defaultZero(incoming.MotionX)
	incoming.MotionY = defaultZero(incoming.MotionY)
	incoming.Source = normalizeSource(incoming.Source)
	incoming.Speed = clampFloat(incoming.Speed, 0, 120)
	return incoming, true
}

func normalizeTimestamp(value int64) int64 {
	if value <= 0 {
		return time.Now().UnixMilli()
	}

	return value
}

func normalizeSource(value string) string {
	switch strings.TrimSpace(strings.ToLower(value)) {
	case sourceFused:
		return sourceFused
	default:
		return sourceGPS
	}
}

func isNewerPosition(previous PositionMessage, next PositionMessage) bool {
	if next.Sequence > 0 && previous.Sequence > 0 {
		if next.Sequence < previous.Sequence {
			return false
		}
		if next.Sequence == previous.Sequence && next.Timestamp <= previous.Timestamp {
			return false
		}
		return true
	}

	if next.Timestamp < previous.Timestamp {
		return false
	}

	if next.Timestamp == previous.Timestamp && next.Sequence < previous.Sequence {
		return false
	}

	return true
}

func shouldBroadcastPosition(previous PositionMessage, next PositionMessage) bool {
	elapsed := time.Duration(next.Timestamp-previous.Timestamp) * time.Millisecond
	if elapsed >= realtimeHeartbeatInterval {
		return true
	}
	if elapsed < realtimeMinPublishInterval {
		return false
	}

	if distanceMeters(previous, next) >= effectivePublishDistance(next.Accuracy) {
		return true
	}

	if math.Abs(headingDelta(previous.Heading, next.Heading)) >= realtimeMinHeadingDeltaDeg {
		return true
	}

	if math.Abs(next.MotionE-previous.MotionE) >= realtimeMinMotionEnergyDelta {
		return true
	}

	return math.Abs(next.Speed-previous.Speed) >= realtimeMinSpeedDeltaMps
}

func effectivePublishDistance(accuracy float64) float64 {
	if accuracy <= 0 {
		return realtimeMinPublishMeters
	}

	return math.Max(realtimeMinPublishMeters, math.Min(0.35, accuracy*0.1))
}

func isPositionStale(position PositionMessage, now time.Time) bool {
	if position.Timestamp <= 0 {
		return true
	}

	return now.Sub(time.UnixMilli(position.Timestamp)) > realtimePlayerTTL
}

func distanceMeters(from PositionMessage, to PositionMessage) float64 {
	latitudeDelta := toRadians(to.Latitude - from.Latitude)
	longitudeDelta := toRadians(to.Longitude - from.Longitude)
	startLatitude := toRadians(from.Latitude)
	endLatitude := toRadians(to.Latitude)

	a := math.Sin(latitudeDelta/2)*math.Sin(latitudeDelta/2) +
		math.Cos(startLatitude)*math.Cos(endLatitude)*math.Sin(longitudeDelta/2)*math.Sin(longitudeDelta/2)

	return earthRadiusMeters * 2 * math.Atan2(math.Sqrt(a), math.Sqrt(1-a))
}

func headingDelta(from float64, to float64) float64 {
	normalizedFrom := normalizeHeading(from)
	normalizedTo := normalizeHeading(to)
	delta := normalizedTo - normalizedFrom

	if delta > 180 {
		return delta - 360
	}
	if delta < -180 {
		return delta + 360
	}

	return delta
}

func normalizeHeading(value float64) float64 {
	if !isFinite(value) {
		return 0
	}

	return math.Mod(math.Mod(value, 360)+360, 360)
}

func defaultZero(value float64) float64 {
	if !isFinite(value) {
		return 0
	}

	return value
}

func clampFloat(value float64, min float64, max float64) float64 {
	if !isFinite(value) {
		return min
	}
	if value < min {
		return min
	}
	if value > max {
		return max
	}

	return value
}

func isFinite(value float64) bool {
	return !math.IsNaN(value) && !math.IsInf(value, 0)
}

func toRadians(value float64) float64 {
	return value * math.Pi / 180
}
