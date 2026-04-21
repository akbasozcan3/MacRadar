package realtime

import "log/slog"

type Service struct {
	logger *slog.Logger
}

func NewService(logger *slog.Logger) *Service {
	return &Service{logger: logger}
}

func (s *Service) PreparePositionUpdate(
	client *Client,
	previous PositionMessage,
	incoming PositionMessage,
) (PositionMessage, bool, bool) {
	next, ok := sanitizePositionMessage(incoming, client.playerID, client.roomID)
	if !ok {
		return PositionMessage{}, false, false
	}

	if previous.Timestamp > 0 && !isNewerPosition(previous, next) {
		return PositionMessage{}, false, false
	}

	shouldBroadcast := previous.Timestamp == 0 || shouldBroadcastPosition(previous, next)
	return next, true, shouldBroadcast
}
