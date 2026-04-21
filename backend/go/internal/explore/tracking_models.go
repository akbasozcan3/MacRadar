package explore

import "time"

type TrackingPointInput struct {
	Accuracy  float64
	Heading   float64
	Latitude  float64
	Longitude float64
	RoomID    string
	Sequence  uint32
	Source    string
	Speed     float64
	Timestamp int64
	UserID    string
}

type TrackingPoint struct {
	Accuracy   float64   `json:"accuracy"`
	CapturedAt time.Time `json:"capturedAt"`
	Heading    float64   `json:"heading"`
	Latitude   float64   `json:"latitude"`
	Longitude  float64   `json:"longitude"`
	Sequence   int       `json:"sequence"`
	Source     string    `json:"source"`
	Speed      float64   `json:"speed"`
}

type TrackingFollowPathResponse struct {
	Points       []TrackingPoint `json:"points"`
	SessionID    int64           `json:"sessionId"`
	TargetUserID string          `json:"targetUserId"`
}

type TrackingFollowPathQuery struct {
	Limit       int
	SimplifyEps float64
	Window      time.Duration
}
