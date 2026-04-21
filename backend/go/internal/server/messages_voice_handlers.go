package server

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"math"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"macradar/backend/internal/explore"
)

const (
	maxVoiceDurationSec    = 180
	maxVoiceMessageBytes   = 8 * 1024 * 1024
	maxVoiceWaveformPoints = 256
	minVoiceDurationSec    = 1
	voiceIndexFileName     = "index.json"
)

type voiceUploadInput struct {
	Base64         string    `json:"base64"`
	ClientNonce    string    `json:"clientNonce"`
	ConversationID string    `json:"conversationId"`
	DurationSec    int       `json:"durationSec"`
	MimeType       string    `json:"mimeType"`
	Waveform       []float64 `json:"waveform"`
}

type voiceUploadResponse struct {
	VoiceMessage voiceUploadResponseItem `json:"voiceMessage"`
}

type voiceUploadResponseItem struct {
	ConversationID string    `json:"conversationId"`
	CreatedAt      string    `json:"createdAt"`
	DurationSec    int       `json:"durationSec"`
	FileName       string    `json:"fileName"`
	ID             string    `json:"id"`
	MimeType       string    `json:"mimeType"`
	SizeBytes      int64     `json:"sizeBytes"`
	URL            string    `json:"url"`
	Waveform       []float64 `json:"waveform"`
}

type voiceFileRecord struct {
	ConversationID string    `json:"conversationId"`
	CreatedAt      string    `json:"createdAt"`
	FileName       string    `json:"fileName"`
	ID             string    `json:"id"`
	MimeType       string    `json:"mimeType"`
	PeerID         string    `json:"peerId"`
	SizeBytes      int64     `json:"sizeBytes"`
	UploaderID     string    `json:"uploaderId"`
	Waveform       []float64 `json:"waveform,omitempty"`
}

type voiceFilesIndex struct {
	Items []voiceFileRecord `json:"items"`
}

func (s *Server) handleUploadVoiceMessage(w http.ResponseWriter, r *http.Request) {
	var input voiceUploadInput
	if err := s.decodeJSON(r, &input); err != nil {
		s.respondDecodeError(w, err, "invalid_voice_payload")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	identity, err := s.requireIdentity(ctx, r)
	if err != nil {
		s.respondAccountError(w, err)
		return
	}

	conversationID := strings.TrimSpace(input.ConversationID)
	if conversationID == "" {
		s.respondError(w, http.StatusBadRequest, "invalid_voice_payload", "Sohbet bilgisi eksik.")
		return
	}

	mimeType := normalizeVoiceMimeType(input.MimeType)
	if mimeType == "" {
		s.respondError(w, http.StatusBadRequest, "invalid_voice_mime_type", "Ses dosya tipi desteklenmiyor.")
		return
	}

	rawBase64 := normalizeVoiceBase64(input.Base64)
	if rawBase64 == "" {
		s.respondError(w, http.StatusBadRequest, "invalid_voice_payload", "Ses verisi bos olamaz.")
		return
	}

	fileBytes, err := decodeVoiceBase64(rawBase64)
	if err != nil || len(fileBytes) == 0 {
		s.respondError(w, http.StatusBadRequest, "invalid_voice_payload", "Ses verisi cozumlenemedi.")
		return
	}
	if len(fileBytes) > maxVoiceMessageBytes {
		s.respondError(
			w,
			http.StatusRequestEntityTooLarge,
			"voice_payload_too_large",
			"Ses dosyasi izin verilen limiti asti.",
		)
		return
	}

	peerID, err := s.repo.ConversationPeer(ctx, identity.UserID, conversationID)
	if err != nil {
		switch {
		case errors.Is(err, explore.ErrConversationNotFound):
			s.respondError(w, http.StatusNotFound, "conversation_not_found", "Sohbet bulunamadi.")
		case errors.Is(err, explore.ErrConversationForbidden):
			s.respondError(w, http.StatusForbidden, "conversation_forbidden", "Bu sohbete erisim yetkin yok.")
		case errors.Is(err, explore.ErrBlockedRelationship):
			s.respondError(w, http.StatusForbidden, "blocked_relationship", "Bu kullanici ile mesajlasma engellendi.")
		default:
			s.respondInternalError(w, "voice_upload_failed", err)
		}
		return
	}
	durationSec := normalizeVoiceDuration(input.DurationSec)
	waveform := normalizeVoiceWaveform(input.Waveform)
	voiceMessage, err := s.storeVoiceUploadRecord(
		conversationID,
		identity.UserID,
		peerID,
		mimeType,
		fileBytes,
		durationSec,
		waveform,
	)
	if err != nil {
		s.respondError(w, http.StatusInternalServerError, "voice_write_failed", "Ses dosyasi kaydedilemedi.")
		return
	}

	s.respondJSON(w, http.StatusOK, voiceUploadResponse{
		VoiceMessage: voiceMessage,
	})
}

func (s *Server) handleSendConversationVoiceMessage(w http.ResponseWriter, r *http.Request) {
	conversationID := strings.TrimSpace(r.PathValue("conversationID"))
	if conversationID == "" {
		s.respondError(w, http.StatusBadRequest, "invalid_conversation_id", "conversation id is required")
		return
	}

	var input voiceUploadInput
	if err := s.decodeJSON(r, &input); err != nil {
		s.respondDecodeError(w, err, "invalid_voice_payload")
		return
	}
	if requestedConversationID := strings.TrimSpace(input.ConversationID); requestedConversationID != "" &&
		requestedConversationID != conversationID {
		s.respondError(w, http.StatusBadRequest, "invalid_voice_payload", "Sohbet bilgisi uyusmuyor.")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 8*time.Second)
	defer cancel()

	identity, err := s.requireIdentity(ctx, r)
	if err != nil {
		s.respondAccountError(w, err)
		return
	}

	mimeType := normalizeVoiceMimeType(input.MimeType)
	if mimeType == "" {
		s.respondError(w, http.StatusBadRequest, "invalid_voice_mime_type", "Ses dosya tipi desteklenmiyor.")
		return
	}

	rawBase64 := normalizeVoiceBase64(input.Base64)
	if rawBase64 == "" {
		s.respondError(w, http.StatusBadRequest, "invalid_voice_payload", "Ses verisi bos olamaz.")
		return
	}

	fileBytes, err := decodeVoiceBase64(rawBase64)
	if err != nil || len(fileBytes) == 0 {
		s.respondError(w, http.StatusBadRequest, "invalid_voice_payload", "Ses verisi cozumlenemedi.")
		return
	}
	if len(fileBytes) > maxVoiceMessageBytes {
		s.respondError(
			w,
			http.StatusRequestEntityTooLarge,
			"voice_payload_too_large",
			"Ses dosyasi izin verilen limiti asti.",
		)
		return
	}

	peerID, err := s.repo.ConversationPeer(ctx, identity.UserID, conversationID)
	if err != nil {
		switch {
		case errors.Is(err, explore.ErrConversationNotFound):
			s.respondError(w, http.StatusNotFound, "conversation_not_found", "Konusma bulunamadi.")
		case errors.Is(err, explore.ErrConversationForbidden):
			s.respondError(w, http.StatusForbidden, "conversation_forbidden", "Bu sohbete erisim yetkin yok.")
		case errors.Is(err, explore.ErrBlockedRelationship):
			s.respondError(w, http.StatusForbidden, "blocked_relationship", "Bu kullanici ile mesajlasma engellendi.")
		default:
			s.respondInternalError(w, "voice_message_send_failed", err)
		}
		return
	}

	durationSec := normalizeVoiceDuration(input.DurationSec)
	waveform := normalizeVoiceWaveform(input.Waveform)
	voiceMessage, err := s.storeVoiceUploadRecord(
		conversationID,
		identity.UserID,
		peerID,
		mimeType,
		fileBytes,
		durationSec,
		waveform,
	)
	if err != nil {
		s.respondError(w, http.StatusInternalServerError, "voice_write_failed", "Ses dosyasi kaydedilemedi.")
		return
	}

	messageBody, err := explore.EncodeVoiceMessageBody(explore.VoiceMessageAsset{
		ConversationID: conversationID,
		DurationSec:    voiceMessage.DurationSec,
		ID:             voiceMessage.ID,
		MimeType:       voiceMessage.MimeType,
		SizeBytes:      voiceMessage.SizeBytes,
		URL:            voiceMessage.URL,
		Waveform:       voiceMessage.Waveform,
	})
	if err != nil {
		if cleanupErr := s.deleteVoiceFileByID(voiceMessage.ID); cleanupErr != nil && s.logger != nil {
			s.logger.Warn("rollback voice message after encode failure failed", "voiceMessageId", voiceMessage.ID, "error", cleanupErr)
		}
		s.respondError(w, http.StatusInternalServerError, "voice_message_send_failed", "Sesli mesaj hazirlanamadi.")
		return
	}

	response, err := s.repo.SendConversationMessage(
		ctx,
		identity.UserID,
		conversationID,
		explore.ConversationMessageInput{
			ClientNonce: input.ClientNonce,
			Text:        messageBody,
		},
	)
	if err != nil {
		if cleanupErr := s.deleteVoiceFileByID(voiceMessage.ID); cleanupErr != nil && s.logger != nil {
			s.logger.Warn("rollback stored voice message failed", "voiceMessageId", voiceMessage.ID, "error", cleanupErr)
		}
		switch {
		case errors.Is(err, explore.ErrConversationNotFound):
			s.respondError(w, http.StatusNotFound, "conversation_not_found", "Konusma bulunamadi.")
		case errors.Is(err, explore.ErrConversationForbidden):
			s.respondError(w, http.StatusForbidden, "conversation_forbidden", "Bu konusmaya mesaj gonderemezsin.")
		case errors.Is(err, explore.ErrConversationRequestPending):
			s.respondError(w, http.StatusConflict, "message_request_pending", "Mesaj istegi zaten gonderildi. Kabul edilene kadar yeni mesaj gonderemezsin.")
		case errors.Is(err, explore.ErrConversationRequestRejected):
			s.respondError(w, http.StatusConflict, "message_request_rejected", "Mesaj istegi reddedildi. Takip etmeden yeniden mesaj gonderemezsin.")
		case errors.Is(err, explore.ErrConversationRestricted):
			s.respondError(w, http.StatusForbidden, "messages_limited_to_following", "Bu kullanici sadece takip ettiklerinden mesaj kabul ediyor.")
		case errors.Is(err, explore.ErrBlockedRelationship):
			s.respondError(w, http.StatusForbidden, "blocked_relationship", "Bu kullanici ile mesajlasma engellendi.")
		case errors.Is(err, explore.ErrInvalidMessageAction):
			s.respondError(w, http.StatusBadRequest, "invalid_voice_payload", "Sesli mesaj icerigi gecersiz.")
		default:
			s.respondInternalError(w, "voice_message_send_failed", err)
		}
		return
	}
	if strings.TrimSpace(input.ClientNonce) != "" &&
		strings.TrimSpace(response.Message.Body) != strings.TrimSpace(messageBody) {
		if cleanupErr := s.deleteVoiceFileByID(voiceMessage.ID); cleanupErr != nil && s.logger != nil {
			s.logger.Warn("cleanup duplicated voice upload failed", "voiceMessageId", voiceMessage.ID, "error", cleanupErr)
		}
	}

	s.emitMessageCreatedEvent(identity.UserID, peerID, response.ConversationID, response.Message)
	s.respondJSON(w, http.StatusCreated, response)
}

func (s *Server) handleVoiceMessageFile(w http.ResponseWriter, r *http.Request) {
	voiceMessageID := strings.TrimSpace(r.PathValue("voiceMessageID"))
	if voiceMessageID == "" {
		s.respondError(w, http.StatusNotFound, "voice_not_found", "Ses mesaji bulunamadi.")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
	defer cancel()

	identity, err := s.requireIdentity(ctx, r)
	if err != nil {
		s.respondAccountError(w, err)
		return
	}

	s.voiceFilesMu.RLock()
	record, ok := s.voiceFiles[voiceMessageID]
	s.voiceFilesMu.RUnlock()
	if !ok {
		s.respondError(w, http.StatusNotFound, "voice_not_found", "Ses mesaji bulunamadi.")
		return
	}

	if identity.UserID != record.UploaderID && identity.UserID != record.PeerID {
		s.respondError(w, http.StatusForbidden, "voice_access_forbidden", "Bu ses mesajina erisim yetkin yok.")
		return
	}

	filePath := filepath.Join(s.voiceStorageDirectory(), record.FileName)
	file, err := os.Open(filePath)
	if err != nil {
		if os.IsNotExist(err) {
			s.respondError(w, http.StatusNotFound, "voice_not_found", "Ses dosyasi bulunamadi.")
			return
		}
		s.respondError(w, http.StatusInternalServerError, "voice_read_failed", "Ses dosyasi okunamadi.")
		return
	}
	defer file.Close()

	stat, err := file.Stat()
	if err != nil {
		s.respondError(w, http.StatusInternalServerError, "voice_read_failed", "Ses dosyasi okunamadi.")
		return
	}

	serveVoiceFileContent(w, r, file, record, stat)
}

func (s *Server) loadVoiceFilesIndex() {
	if err := s.ensureVoiceStorageDir(); err != nil {
		return
	}

	indexPath := s.voiceFilesIndexPath()
	raw, err := os.ReadFile(indexPath)
	if err != nil {
		return
	}

	var payload voiceFilesIndex
	if err := json.Unmarshal(raw, &payload); err != nil {
		return
	}

	next := make(map[string]voiceFileRecord, len(payload.Items))
	for _, item := range payload.Items {
		if strings.TrimSpace(item.ID) == "" || strings.TrimSpace(item.FileName) == "" {
			continue
		}
		next[item.ID] = item
	}

	s.voiceFilesMu.Lock()
	s.voiceFiles = next
	s.voiceFilesMu.Unlock()
}

func (s *Server) persistVoiceFilesIndexLocked() error {
	records := make([]voiceFileRecord, 0, len(s.voiceFiles))
	for _, item := range s.voiceFiles {
		records = append(records, item)
	}
	sort.Slice(records, func(left, right int) bool {
		return records[left].CreatedAt < records[right].CreatedAt
	})

	payload := voiceFilesIndex{
		Items: records,
	}
	raw, err := json.Marshal(payload)
	if err != nil {
		return err
	}

	if err := s.ensureVoiceStorageDir(); err != nil {
		return err
	}

	indexPath := s.voiceFilesIndexPath()
	tempPath := indexPath + ".tmp"
	if err := os.WriteFile(tempPath, raw, 0o644); err != nil {
		return err
	}
	return os.Rename(tempPath, indexPath)
}

func (s *Server) storeVoiceUploadRecord(
	conversationID string,
	uploaderID string,
	peerID string,
	mimeType string,
	fileBytes []byte,
	durationSec int,
	waveform []float64,
) (voiceUploadResponseItem, error) {
	if err := s.ensureVoiceStorageDir(); err != nil {
		return voiceUploadResponseItem{}, err
	}

	voiceMessageID := newVoiceMessageID()
	extension := voiceFileExtensionForMimeType(mimeType)
	fileName := voiceMessageID + "." + extension
	absolutePath := filepath.Join(s.voiceStorageDirectory(), fileName)
	if err := os.WriteFile(absolutePath, fileBytes, 0o644); err != nil {
		return voiceUploadResponseItem{}, err
	}

	createdAt := time.Now().UTC().Format(time.RFC3339)
	record := voiceFileRecord{
		ConversationID: conversationID,
		CreatedAt:      createdAt,
		FileName:       fileName,
		ID:             voiceMessageID,
		MimeType:       mimeType,
		PeerID:         peerID,
		SizeBytes:      int64(len(fileBytes)),
		UploaderID:     uploaderID,
		Waveform:       waveform,
	}

	s.voiceFilesMu.Lock()
	s.voiceFiles[voiceMessageID] = record
	if persistErr := s.persistVoiceFilesIndexLocked(); persistErr != nil {
		delete(s.voiceFiles, voiceMessageID)
		s.voiceFilesMu.Unlock()
		_ = os.Remove(absolutePath)
		return voiceUploadResponseItem{}, persistErr
	}
	s.voiceFilesMu.Unlock()

	return voiceUploadResponseItem{
		ConversationID: conversationID,
		CreatedAt:      createdAt,
		DurationSec:    durationSec,
		FileName:       fileName,
		ID:             voiceMessageID,
		MimeType:       mimeType,
		SizeBytes:      int64(len(fileBytes)),
		URL:            "/api/v1/messages/voice/files/" + voiceMessageID,
		Waveform:       waveform,
	}, nil
}

func (s *Server) deleteVoiceFileByID(voiceMessageID string) error {
	voiceMessageID = strings.TrimSpace(voiceMessageID)
	if voiceMessageID == "" {
		return nil
	}

	s.voiceFilesMu.Lock()
	defer s.voiceFilesMu.Unlock()

	record, ok := s.voiceFiles[voiceMessageID]
	if !ok {
		return nil
	}
	delete(s.voiceFiles, voiceMessageID)

	if strings.TrimSpace(record.FileName) != "" {
		filePath := filepath.Join(s.voiceStorageDirectory(), record.FileName)
		if err := os.Remove(filePath); err != nil && !os.IsNotExist(err) {
			return err
		}
	}

	return s.persistVoiceFilesIndexLocked()
}

func (s *Server) deleteVoiceFilesForConversation(conversationID string) error {
	conversationID = strings.TrimSpace(conversationID)
	if conversationID == "" {
		return nil
	}

	s.voiceFilesMu.Lock()
	defer s.voiceFilesMu.Unlock()

	removedAny := false
	for voiceMessageID, item := range s.voiceFiles {
		if strings.TrimSpace(item.ConversationID) != conversationID {
			continue
		}

		removedAny = true
		delete(s.voiceFiles, voiceMessageID)
		if strings.TrimSpace(item.FileName) == "" {
			continue
		}

		filePath := filepath.Join(s.voiceStorageDirectory(), item.FileName)
		if err := os.Remove(filePath); err != nil && !os.IsNotExist(err) {
			return err
		}
	}

	if !removedAny {
		return nil
	}

	return s.persistVoiceFilesIndexLocked()
}

func (s *Server) voiceStorageDirectory() string {
	migrationsDir := strings.TrimSpace(s.cfg.MigrationsDir)
	if migrationsDir != "" {
		backendRoot := filepath.Clean(filepath.Dir(migrationsDir))
		return filepath.Join(backendRoot, "storage", "voice", "messages")
	}

	return filepath.Join("backend", "storage", "voice", "messages")
}

func (s *Server) voiceFilesIndexPath() string {
	return filepath.Join(s.voiceStorageDirectory(), voiceIndexFileName)
}

func (s *Server) ensureVoiceStorageDir() error {
	return os.MkdirAll(s.voiceStorageDirectory(), 0o755)
}

func newVoiceMessageID() string {
	buffer := make([]byte, 6)
	if _, err := rand.Read(buffer); err != nil {
		return "voice_" + time.Now().UTC().Format("20060102150405")
	}
	return "voice_" + hex.EncodeToString(buffer)
}

func normalizeVoiceDuration(value int) int {
	if value < minVoiceDurationSec {
		return minVoiceDurationSec
	}
	if value > maxVoiceDurationSec {
		return maxVoiceDurationSec
	}
	return value
}

func normalizeVoiceMimeType(value string) string {
	normalized := strings.ToLower(strings.TrimSpace(value))
	switch normalized {
	case "audio/aac":
		return "audio/aac"
	case "audio/mpeg", "audio/mp3":
		return "audio/mpeg"
	case "audio/mp4", "audio/m4a", "audio/x-m4a":
		return "audio/mp4"
	default:
		return ""
	}
}

func voiceFileExtensionForMimeType(mimeType string) string {
	switch mimeType {
	case "audio/aac":
		return "aac"
	case "audio/mpeg":
		return "mp3"
	default:
		return "m4a"
	}
}

func normalizeVoiceBase64(value string) string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return ""
	}
	if strings.HasPrefix(strings.ToLower(trimmed), "data:") {
		if commaIndex := strings.Index(trimmed, ","); commaIndex >= 0 {
			trimmed = trimmed[commaIndex+1:]
		}
	}
	trimmed = strings.ReplaceAll(trimmed, "\n", "")
	trimmed = strings.ReplaceAll(trimmed, "\r", "")
	trimmed = strings.ReplaceAll(trimmed, "\t", "")
	trimmed = strings.ReplaceAll(trimmed, " ", "")
	return strings.TrimSpace(trimmed)
}

func decodeVoiceBase64(value string) ([]byte, error) {
	decoded, err := base64.StdEncoding.DecodeString(value)
	if err == nil {
		return decoded, nil
	}
	return base64.RawStdEncoding.DecodeString(value)
}

func normalizeVoiceWaveform(values []float64) []float64 {
	if len(values) == 0 {
		return []float64{}
	}

	normalized := make([]float64, 0, minInt(len(values), maxVoiceWaveformPoints))
	for _, value := range values {
		if math.IsNaN(value) || math.IsInf(value, 0) {
			continue
		}
		if value < 0 {
			value = 0
		}
		if value > 1 {
			value = 1
		}
		normalized = append(normalized, value)
		if len(normalized) >= maxVoiceWaveformPoints {
			break
		}
	}
	if len(normalized) == 0 {
		return []float64{}
	}
	return normalized
}

func minInt(left int, right int) int {
	if left < right {
		return left
	}
	return right
}

func serveVoiceFileContent(
	w http.ResponseWriter,
	r *http.Request,
	file *os.File,
	record voiceFileRecord,
	stat os.FileInfo,
) {
	contentType := strings.TrimSpace(record.MimeType)
	if contentType == "" {
		contentType = "audio/mp4"
	}
	w.Header().Set("Accept-Ranges", "bytes")
	w.Header().Set("Cache-Control", "private, max-age=86400")
	w.Header().Set("Content-Type", contentType)
	http.ServeContent(w, r, record.FileName, stat.ModTime(), file)
}
