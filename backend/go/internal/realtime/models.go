package realtime

type PositionMessage struct {
	Accuracy  float64 `json:"acc,omitempty"`
	AccelX    float64 `json:"ax,omitempty"`
	AccelY    float64 `json:"ay,omitempty"`
	AccelZ    float64 `json:"az,omitempty"`
	GyroX     float64 `json:"gx,omitempty"`
	GyroY     float64 `json:"gy,omitempty"`
	GyroZ     float64 `json:"gz,omitempty"`
	HeadingAC float64 `json:"ha,omitempty"`
	Heading   float64 `json:"hdg,omitempty"`
	Latitude  float64 `json:"lat,omitempty"`
	Longitude float64 `json:"lng,omitempty"`
	MotionE   float64 `json:"me,omitempty"`
	MotionX   float64 `json:"mx,omitempty"`
	MotionY   float64 `json:"my,omitempty"`
	PlayerID  string  `json:"pid,omitempty"`
	RoomID    string  `json:"rid,omitempty"`
	Sequence  uint32  `json:"sq,omitempty"`
	Source    string  `json:"src,omitempty"`
	Speed     float64 `json:"spd,omitempty"`
	Type      string  `json:"t"`
	Timestamp int64   `json:"ts,omitempty"`
}

type SnapshotMessage struct {
	Players   []PositionMessage `json:"ps"`
	RoomID    string            `json:"rid"`
	Type      string            `json:"t"`
	Timestamp int64             `json:"ts"`
}

type LeaveMessage struct {
	PlayerID  string `json:"pid"`
	RoomID    string `json:"rid"`
	Type      string `json:"t"`
	Timestamp int64  `json:"ts"`
}

type AckMessage struct {
	PlayerID  string `json:"pid"`
	RoomID    string `json:"rid"`
	Type      string `json:"t"`
	Timestamp int64  `json:"ts"`
}
