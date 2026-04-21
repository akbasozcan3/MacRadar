package explore

import (
	"encoding/json"
	"math"
	"strconv"
	"strings"
	"time"
)

const richMessagePrefix = "[[MRMSG]]"

type outboundVoiceMessagePayload struct {
	DurationSec int       `json:"durationSec"`
	Kind        string    `json:"kind"`
	MimeType    string    `json:"mimeType"`
	SizeBytes   int64     `json:"sizeBytes"`
	Title       string    `json:"title"`
	VoiceID     string    `json:"voiceId"`
	VoiceURL    string    `json:"voiceUrl"`
	Waveform    []float64 `json:"waveform"`
}

type outboundPhotoMessagePayload struct {
	Kind      string `json:"kind"`
	MimeType  string `json:"mimeType"`
	SizeBytes int64  `json:"sizeBytes"`
	Title     string `json:"title"`
	URL       string `json:"url"`
}

type outboundLocationMessagePayload struct {
	Kind          string   `json:"kind"`
	Latitude      *float64 `json:"latitude"`
	LocationLabel string   `json:"locationLabel"`
	Longitude     *float64 `json:"longitude"`
	Title         string   `json:"title"`
}

type richMessageEnvelope struct {
	Kind string `json:"kind"`
}

type parsedMessageContent struct {
	kind            MessageContentKind
	locationMessage *LocationMessageAsset
	photoMessage    *PhotoMessageAsset
	preview         string
	voiceMessage    *VoiceMessageAsset
}

func clamp01(value float64) float64 {
	if math.IsNaN(value) || math.IsInf(value, 0) {
		return 0
	}
	return math.Min(1, math.Max(0, value))
}

func normalizeWaveform(values []float64) []float64 {
	if len(values) == 0 {
		return nil
	}

	normalized := make([]float64, 0, min(len(values), 256))
	for _, value := range values {
		next := clamp01(value)
		if next <= 0 {
			continue
		}
		normalized = append(normalized, next)
		if len(normalized) >= 256 {
			break
		}
	}
	if len(normalized) == 0 {
		return nil
	}
	return normalized
}

func normalizeVoiceDuration(value int, fallback int) int {
	if value <= 0 {
		return fallback
	}
	return value
}

func normalizePreview(preview string, fallback string) string {
	trimmed := strings.TrimSpace(preview)
	if trimmed != "" {
		return trimmed
	}
	return strings.TrimSpace(fallback)
}

func buildTextContent(body string, preview string) parsedMessageContent {
	trimmedBody := strings.TrimSpace(body)
	return parsedMessageContent{
		kind:    MessageContentKindText,
		preview: normalizePreview(preview, firstNonEmpty(trimmedBody, "Yeni mesaj")),
	}
}

func buildVoiceContent(payload outboundVoiceMessagePayload, preview string) parsedMessageContent {
	durationSec := normalizeVoiceDuration(payload.DurationSec, 6)
	return parsedMessageContent{
		kind:    MessageContentKindVoice,
		preview: normalizePreview(preview, "Sesli mesaj ("+itoa(durationSec)+" sn)"),
		voiceMessage: &VoiceMessageAsset{
			ConversationID: "",
			CreatedAt:      time.Time{},
			DurationSec:    durationSec,
			FileName:       "",
			ID:             strings.TrimSpace(payload.VoiceID),
			MimeType:       strings.TrimSpace(payload.MimeType),
			SizeBytes:      maxInt64(0, payload.SizeBytes),
			URL:            strings.TrimSpace(payload.VoiceURL),
			Waveform:       normalizeWaveform(payload.Waveform),
		},
	}
}

func buildPhotoContent(payload outboundPhotoMessagePayload, preview string) parsedMessageContent {
	title := firstNonEmpty(strings.TrimSpace(payload.Title), "Fotograf")
	return parsedMessageContent{
		kind:    MessageContentKindPhoto,
		preview: normalizePreview(preview, "Fotograf: "+title),
		photoMessage: &PhotoMessageAsset{
			MimeType:  strings.TrimSpace(payload.MimeType),
			SizeBytes: maxInt64(0, payload.SizeBytes),
			Title:     title,
			URL:       strings.TrimSpace(payload.URL),
		},
	}
}

func buildLocationContent(payload outboundLocationMessagePayload, preview string) parsedMessageContent {
	locationLabel := firstNonEmpty(strings.TrimSpace(payload.LocationLabel), "Konum")
	return parsedMessageContent{
		kind:    MessageContentKindLocation,
		preview: normalizePreview(preview, "Konum: "+locationLabel),
		locationMessage: &LocationMessageAsset{
			Latitude:      payload.Latitude,
			LocationLabel: locationLabel,
			Longitude:     payload.Longitude,
			Title:         firstNonEmpty(strings.TrimSpace(payload.Title), "Konum"),
		},
	}
}

func ParseMessageContent(
	body string,
	fallbackKind MessageContentKind,
	fallbackPreview string,
	fallbackVoice *VoiceMessageAsset,
	fallbackPhoto *PhotoMessageAsset,
	fallbackLocation *LocationMessageAsset,
) parsedMessageContent {
	if fallbackKind == MessageContentKindVoice && fallbackVoice != nil {
		voiceCopy := *fallbackVoice
		voiceCopy.Waveform = normalizeWaveform(voiceCopy.Waveform)
		return parsedMessageContent{
			kind:         MessageContentKindVoice,
			preview:      normalizePreview(fallbackPreview, "Sesli mesaj ("+itoa(normalizeVoiceDuration(voiceCopy.DurationSec, 6))+" sn)"),
			voiceMessage: &voiceCopy,
		}
	}
	if fallbackKind == MessageContentKindPhoto && fallbackPhoto != nil {
		photoCopy := *fallbackPhoto
		return parsedMessageContent{
			kind:         MessageContentKindPhoto,
			photoMessage: &photoCopy,
			preview:      normalizePreview(fallbackPreview, "Fotograf"),
		}
	}
	if fallbackKind == MessageContentKindLocation && fallbackLocation != nil {
		locationCopy := *fallbackLocation
		locationLabel := firstNonEmpty(strings.TrimSpace(locationCopy.LocationLabel), "Konum")
		locationCopy.LocationLabel = locationLabel
		locationCopy.Title = firstNonEmpty(strings.TrimSpace(locationCopy.Title), "Konum")
		return parsedMessageContent{
			kind:            MessageContentKindLocation,
			locationMessage: &locationCopy,
			preview:         normalizePreview(fallbackPreview, "Konum: "+locationLabel),
		}
	}

	raw := body
	if !strings.HasPrefix(raw, richMessagePrefix) {
		return buildTextContent(raw, fallbackPreview)
	}

	encoded := strings.TrimPrefix(raw, richMessagePrefix)
	var envelope richMessageEnvelope
	if err := json.Unmarshal([]byte(encoded), &envelope); err != nil {
		return buildTextContent(raw, fallbackPreview)
	}

	switch strings.ToLower(strings.TrimSpace(envelope.Kind)) {
	case "voice":
		var payload outboundVoiceMessagePayload
		if err := json.Unmarshal([]byte(encoded), &payload); err != nil {
			return buildTextContent(raw, fallbackPreview)
		}
		return buildVoiceContent(payload, fallbackPreview)
	case "photo":
		var payload outboundPhotoMessagePayload
		if err := json.Unmarshal([]byte(encoded), &payload); err != nil {
			return buildTextContent(raw, fallbackPreview)
		}
		return buildPhotoContent(payload, fallbackPreview)
	case "location":
		var payload outboundLocationMessagePayload
		if err := json.Unmarshal([]byte(encoded), &payload); err != nil {
			return buildTextContent(raw, fallbackPreview)
		}
		return buildLocationContent(payload, fallbackPreview)
	default:
		return buildTextContent(raw, fallbackPreview)
	}
}

func EncodeVoiceMessageBody(asset VoiceMessageAsset) (string, error) {
	payload := outboundVoiceMessagePayload{
		DurationSec: normalizeVoiceDuration(asset.DurationSec, 6),
		Kind:        "voice",
		MimeType:    strings.TrimSpace(asset.MimeType),
		SizeBytes:   maxInt64(0, asset.SizeBytes),
		Title:       "Sesli mesaj",
		VoiceID:     strings.TrimSpace(asset.ID),
		VoiceURL:    strings.TrimSpace(asset.URL),
		Waveform:    normalizeWaveform(asset.Waveform),
	}
	raw, err := json.Marshal(payload)
	if err != nil {
		return "", err
	}
	return richMessagePrefix + string(raw), nil
}

func HydrateConversationMessage(message ConversationMessage) ConversationMessage {
	content := ParseMessageContent(
		message.Body,
		message.Kind,
		message.Preview,
		message.VoiceMessage,
		message.PhotoMessage,
		message.LocationMessage,
	)
	message.Kind = content.kind
	message.LocationMessage = content.locationMessage
	message.PhotoMessage = content.photoMessage
	message.Preview = content.preview
	message.VoiceMessage = content.voiceMessage
	return message
}

func HydrateConversationSummary(summary ConversationSummary) ConversationSummary {
	content := ParseMessageContent(
		summary.LastMessage,
		summary.LastMessageKind,
		summary.LastMessagePreview,
		summary.LastVoiceMessage,
		summary.LastPhotoMessage,
		summary.LastLocationMessage,
	)
	summary.LastLocationMessage = content.locationMessage
	summary.LastMessageKind = content.kind
	summary.LastMessagePreview = content.preview
	summary.LastPhotoMessage = content.photoMessage
	summary.LastVoiceMessage = content.voiceMessage
	return summary
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func itoa(value int) string {
	return strconv.Itoa(value)
}

func maxInt64(a int64, b int64) int64 {
	if a > b {
		return a
	}
	return b
}

func min(a int, b int) int {
	if a < b {
		return a
	}
	return b
}
