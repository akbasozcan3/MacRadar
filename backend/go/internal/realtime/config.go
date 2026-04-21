package realtime

import "time"

const (
	clientWriteWait                    = 10 * time.Second
	maxIncomingMessageBytes      int64 = 2048
	outboundBufferSize                 = 48
	pingPeriod                         = 20 * time.Second
	realtimeHeartbeatInterval          = 700 * time.Millisecond
	realtimeMinHeadingDeltaDeg         = 3
	realtimeMinMotionEnergyDelta       = 0.03
	realtimeMinPublishInterval         = 30 * time.Millisecond
	realtimeMinPublishMeters           = 0.04
	realtimeMinSpeedDeltaMps           = 0.08
	realtimePlayerTTL                  = 5 * time.Second
	realtimeStaleSweepInterval         = time.Second
)
