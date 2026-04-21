package server

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"image"
	"image/color"
	"image/jpeg"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"macradar/backend/internal/explore"
)

const (
	maxProfilePhotoUploadBytes = 16 * 1024 * 1024
	maxProfileVideoUploadBytes = 80 * 1024 * 1024
	postMediaIndexFileName     = "index.json"
)

type profilePostMediaUploadResponse struct {
	Asset profilePostMediaUploadResponseItem `json:"asset"`
}

type profilePostMediaUploadResponseItem struct {
	ID         string `json:"id"`
	MediaType  string `json:"mediaType"`
	MediaURL   string `json:"mediaUrl"`
	MimeType   string `json:"mimeType"`
	SizeBytes  int64  `json:"sizeBytes"`
	UploadedAt string `json:"uploadedAt"`
}

type postMediaFileRecord struct {
	CreatedAt  string `json:"createdAt"`
	FileName   string `json:"fileName"`
	ID         string `json:"id"`
	MediaType  string `json:"mediaType"`
	MimeType   string `json:"mimeType"`
	SizeBytes  int64  `json:"sizeBytes"`
	UploaderID string `json:"uploaderId"`
}

type postMediaFilesIndex struct {
	Items []postMediaFileRecord `json:"items"`
}

func (s *Server) handleUploadProfilePostMedia(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()

	identity, err := s.requireIdentity(ctx, r)
	if err != nil {
		s.respondAccountError(w, err)
		return
	}

	if err := r.ParseMultipartForm(maxProfileVideoUploadBytes); err != nil {
		var maxBytesErr *http.MaxBytesError
		if errors.As(err, &maxBytesErr) {
			s.respondError(
				w,
				http.StatusRequestEntityTooLarge,
				"profile_post_media_too_large",
				"Gonderi medyasi izin verilen boyutu asiyor.",
			)
			return
		}
		s.respondError(w, http.StatusBadRequest, "invalid_profile_post_media", "Medya formu cozumlenemedi.")
		return
	}

	file, header, err := r.FormFile("file")
	if err != nil {
		s.respondError(w, http.StatusBadRequest, "profile_post_media_required", "Yuklenecek medya dosyasi gerekli.")
		return
	}
	defer file.Close()

	requestedMediaType := normalizeUploadedPostMediaType(r.FormValue("mediaType"))
	if requestedMediaType == "" {
		s.respondError(w, http.StatusBadRequest, "invalid_profile_post_media_type", "Medya tipi photo veya video olmalidir.")
		return
	}

	maxAllowedBytes := maxProfilePhotoUploadBytes
	if requestedMediaType == "video" {
		maxAllowedBytes = maxProfileVideoUploadBytes
	}

	fileBytes, err := io.ReadAll(io.LimitReader(file, int64(maxAllowedBytes)+1))
	if err != nil {
		s.respondError(w, http.StatusInternalServerError, "profile_post_media_read_failed", "Medya dosyasi okunamadi.")
		return
	}
	if len(fileBytes) == 0 {
		s.respondError(w, http.StatusBadRequest, "profile_post_media_required", "Bos medya dosyasi yuklenemez.")
		return
	}
	if len(fileBytes) > maxAllowedBytes {
		s.respondError(
			w,
			http.StatusRequestEntityTooLarge,
			"profile_post_media_too_large",
			"Gonderi medyasi izin verilen boyutu asiyor.",
		)
		return
	}

	mimeType := normalizeProfilePostMediaMimeType(
		header.Header.Get("Content-Type"),
		http.DetectContentType(fileBytes),
	)
	if mimeType == "" {
		s.respondError(w, http.StatusBadRequest, "invalid_profile_post_media_type", "Bu medya dosya tipi desteklenmiyor.")
		return
	}
	if !isProfilePostMediaTypeCompatible(requestedMediaType, mimeType) {
		s.respondError(w, http.StatusBadRequest, "invalid_profile_post_media_type", "Medya tipi ile dosya formati uyusmuyor.")
		return
	}

	if err := s.ensurePostMediaStorageDir(); err != nil {
		s.respondError(w, http.StatusInternalServerError, "profile_post_media_storage_unavailable", "Gonderi medya alani hazirlanamadi.")
		return
	}

	mediaID := newProfilePostMediaID()
	fileName := mediaID + "." + profilePostMediaExtensionForMimeType(mimeType)
	absolutePath := filepath.Join(s.postMediaStorageDirectory(), fileName)
	if err := os.WriteFile(absolutePath, fileBytes, 0o644); err != nil {
		s.respondError(w, http.StatusInternalServerError, "profile_post_media_write_failed", "Medya dosyasi kaydedilemedi.")
		return
	}

	uploadedAt := time.Now().UTC().Format(time.RFC3339)
	record := postMediaFileRecord{
		CreatedAt:  uploadedAt,
		FileName:   fileName,
		ID:         mediaID,
		MediaType:  requestedMediaType,
		MimeType:   mimeType,
		SizeBytes:  int64(len(fileBytes)),
		UploaderID: identity.UserID,
	}

	s.postMediaFilesMu.Lock()
	s.postMediaFiles[mediaID] = record
	if persistErr := s.persistPostMediaFilesIndexLocked(); persistErr != nil {
		delete(s.postMediaFiles, mediaID)
		s.postMediaFilesMu.Unlock()
		_ = os.Remove(absolutePath)
		s.respondError(w, http.StatusInternalServerError, "profile_post_media_index_failed", "Medya kaydi sonlandirilamadi.")
		return
	}
	s.postMediaFilesMu.Unlock()

	mediaURL := profilePostMediaPath(mediaID)
	s.respondJSON(w, http.StatusCreated, profilePostMediaUploadResponse{
		Asset: profilePostMediaUploadResponseItem{
			ID:         mediaID,
			MediaType:  requestedMediaType,
			MediaURL:   mediaURL,
			MimeType:   mimeType,
			SizeBytes:  int64(len(fileBytes)),
			UploadedAt: uploadedAt,
		},
	})
}

func (s *Server) handleProfilePostMediaFile(w http.ResponseWriter, r *http.Request) {
	mediaID := strings.TrimSpace(r.PathValue("mediaID"))
	if mediaID == "" {
		s.respondError(w, http.StatusNotFound, "profile_post_media_not_found", "Gonderi medyasi bulunamadi.")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
	defer cancel()

	identity, err := s.requireIdentity(ctx, r)
	if err != nil {
		s.respondAccountError(w, err)
		return
	}

	s.postMediaFilesMu.RLock()
	record, ok := s.postMediaFiles[mediaID]
	s.postMediaFilesMu.RUnlock()
	if !ok {
		s.respondError(w, http.StatusNotFound, "profile_post_media_not_found", "Gonderi medyasi bulunamadi.")
		return
	}

	// Avatar gibi henüz bir posta bağlı olmayan yüklemelerde, dosyayı yükleyen kullanıcıya
	// doğrudan erişim izni ver.
	if record.UploaderID != identity.UserID {
		if err := s.repo.AuthorizeProfilePostMedia(ctx, identity.UserID, profilePostMediaPath(mediaID)); err != nil {
			switch {
			case errors.Is(err, explore.ErrPostNotFound):
				s.respondError(w, http.StatusNotFound, "profile_post_media_not_found", "Gonderi medyasi bulunamadi.")
			case errors.Is(err, explore.ErrBlockedRelationship):
				s.respondError(w, http.StatusForbidden, "blocked_relationship", "Bu medya erisimi engellendi.")
			case errors.Is(err, explore.ErrProfilePrivate), errors.Is(err, explore.ErrPostAccessForbidden):
				s.respondError(w, http.StatusForbidden, "profile_post_media_forbidden", "Bu gonderi medyasini gorme yetkin yok.")
			default:
				s.respondInternalError(w, "profile_post_media_access_failed", err)
			}
			return
		}
	}

	filePath := filepath.Join(s.postMediaStorageDirectory(), record.FileName)
	file, err := os.Open(filePath)
	if err != nil {
		if os.IsNotExist(err) {
			s.respondError(w, http.StatusNotFound, "profile_post_media_not_found", "Gonderi medyasi bulunamadi.")
			return
		}
		s.respondError(w, http.StatusInternalServerError, "profile_post_media_read_failed", "Medya dosyasi okunamadi.")
		return
	}
	defer file.Close()

	stat, err := file.Stat()
	if err != nil {
		s.respondError(w, http.StatusInternalServerError, "profile_post_media_read_failed", "Medya dosyasi okunamadi.")
		return
	}

	contentType := strings.TrimSpace(record.MimeType)
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	w.Header().Set("Cache-Control", "private, max-age=86400")
	w.Header().Set("Content-Type", contentType)
	// Stream media via ServeContent so video players can use Range requests (206).
	http.ServeContent(w, r, record.FileName, stat.ModTime(), file)
}

var (
	postVideoThumbnailJPEGOnce sync.Once
	postVideoThumbnailJPEG     []byte
)

func postVideoPlaceholderThumbnailJPEG() []byte {
	postVideoThumbnailJPEGOnce.Do(func() {
		img := image.NewRGBA(image.Rect(0, 0, 360, 220))
		fill := color.RGBA{R: 0x15, G: 0x23, B: 0x42, A: 0xff}
		for y := 0; y < 220; y++ {
			for x := 0; x < 360; x++ {
				img.Set(x, y, fill)
			}
		}
		var buf bytes.Buffer
		_ = jpeg.Encode(&buf, img, &jpeg.Options{Quality: 78})
		postVideoThumbnailJPEG = buf.Bytes()
	})
	return postVideoThumbnailJPEG
}

func (s *Server) handleProfilePostMediaThumbnail(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		s.respondError(w, http.StatusMethodNotAllowed, "method_not_allowed", "Bu kaynak icin yontem desteklenmiyor.")
		return
	}

	mediaID := strings.TrimSpace(r.PathValue("mediaID"))
	if mediaID == "" {
		s.respondError(w, http.StatusNotFound, "profile_post_media_not_found", "Gonderi medyasi bulunamadi.")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
	defer cancel()

	identity, err := s.requireIdentity(ctx, r)
	if err != nil {
		s.respondAccountError(w, err)
		return
	}

	s.postMediaFilesMu.RLock()
	record, ok := s.postMediaFiles[mediaID]
	s.postMediaFilesMu.RUnlock()
	if !ok {
		s.respondError(w, http.StatusNotFound, "profile_post_media_not_found", "Gonderi medyasi bulunamadi.")
		return
	}

	if record.UploaderID != identity.UserID {
		if err := s.repo.AuthorizeProfilePostMedia(ctx, identity.UserID, profilePostMediaPath(mediaID)); err != nil {
			switch {
			case errors.Is(err, explore.ErrPostNotFound):
				s.respondError(w, http.StatusNotFound, "profile_post_media_not_found", "Gonderi medyasi bulunamadi.")
			case errors.Is(err, explore.ErrBlockedRelationship):
				s.respondError(w, http.StatusForbidden, "blocked_relationship", "Bu medya erisimi engellendi.")
			case errors.Is(err, explore.ErrProfilePrivate), errors.Is(err, explore.ErrPostAccessForbidden):
				s.respondError(w, http.StatusForbidden, "profile_post_media_forbidden", "Bu gonderi medyasini gorme yetkin yok.")
			default:
				s.respondInternalError(w, "profile_post_media_access_failed", err)
			}
			return
		}
	}

	filePath := filepath.Join(s.postMediaStorageDirectory(), record.FileName)
	file, err := os.Open(filePath)
	if err != nil {
		if os.IsNotExist(err) {
			s.respondError(w, http.StatusNotFound, "profile_post_media_not_found", "Gonderi medyasi bulunamadi.")
			return
		}
		s.respondError(w, http.StatusInternalServerError, "profile_post_media_read_failed", "Medya dosyasi okunamadi.")
		return
	}
	defer file.Close()

	stat, err := file.Stat()
	if err != nil {
		s.respondError(w, http.StatusInternalServerError, "profile_post_media_read_failed", "Medya dosyasi okunamadi.")
		return
	}

	mimeType := strings.TrimSpace(strings.ToLower(record.MimeType))
	isVideo := strings.EqualFold(record.MediaType, "video") || strings.HasPrefix(mimeType, "video/")
	if isVideo {
		payload := postVideoPlaceholderThumbnailJPEG()
		w.Header().Set("Cache-Control", "private, max-age=86400")
		w.Header().Set("Content-Length", strconv.Itoa(len(payload)))
		w.Header().Set("Content-Type", "image/jpeg")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write(payload)
		return
	}

	contentType := strings.TrimSpace(record.MimeType)
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	w.Header().Set("Cache-Control", "private, max-age=86400")
	w.Header().Set("Content-Length", strconv.FormatInt(stat.Size(), 10))
	w.Header().Set("Content-Type", contentType)
	w.WriteHeader(http.StatusOK)
	_, _ = io.Copy(w, file)
}

func (s *Server) loadPostMediaFilesIndex() {
	if err := s.ensurePostMediaStorageDir(); err != nil {
		return
	}

	indexPath := s.postMediaFilesIndexPath()
	raw, err := os.ReadFile(indexPath)
	if err != nil {
		return
	}

	var payload postMediaFilesIndex
	if err := json.Unmarshal(raw, &payload); err != nil {
		return
	}

	next := make(map[string]postMediaFileRecord, len(payload.Items))
	for _, item := range payload.Items {
		if strings.TrimSpace(item.ID) == "" || strings.TrimSpace(item.FileName) == "" {
			continue
		}
		next[item.ID] = item
	}

	s.postMediaFilesMu.Lock()
	s.postMediaFiles = next
	s.postMediaFilesMu.Unlock()
}

func (s *Server) persistPostMediaFilesIndexLocked() error {
	records := make([]postMediaFileRecord, 0, len(s.postMediaFiles))
	for _, item := range s.postMediaFiles {
		records = append(records, item)
	}
	sort.Slice(records, func(left, right int) bool {
		return records[left].CreatedAt < records[right].CreatedAt
	})

	raw, err := json.Marshal(postMediaFilesIndex{Items: records})
	if err != nil {
		return err
	}

	if err := s.ensurePostMediaStorageDir(); err != nil {
		return err
	}

	indexPath := s.postMediaFilesIndexPath()
	tempPath := indexPath + ".tmp"
	if err := os.WriteFile(tempPath, raw, 0o644); err != nil {
		return err
	}
	return os.Rename(tempPath, indexPath)
}

func (s *Server) postMediaStorageDirectory() string {
	migrationsDir := strings.TrimSpace(s.cfg.MigrationsDir)
	if migrationsDir != "" {
		backendRoot := filepath.Clean(filepath.Dir(migrationsDir))
		return filepath.Join(backendRoot, "storage", "profile-post-media")
	}

	return filepath.Join("backend", "storage", "profile-post-media")
}

func (s *Server) postMediaFilesIndexPath() string {
	return filepath.Join(s.postMediaStorageDirectory(), postMediaIndexFileName)
}

func (s *Server) ensurePostMediaStorageDir() error {
	return os.MkdirAll(s.postMediaStorageDirectory(), 0o755)
}

func profilePostMediaPath(mediaID string) string {
	return "/api/v1/profile/post-media/files/" + strings.TrimSpace(mediaID)
}

func newProfilePostMediaID() string {
	buffer := make([]byte, 6)
	if _, err := rand.Read(buffer); err != nil {
		return "post_media_" + time.Now().UTC().Format("20060102150405")
	}
	return "post_media_" + hex.EncodeToString(buffer)
}

func normalizeUploadedPostMediaType(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "photo":
		return "photo"
	case "video":
		return "video"
	default:
		return ""
	}
}

func normalizeProfilePostMediaMimeType(values ...string) string {
	for _, candidate := range values {
		switch strings.ToLower(strings.TrimSpace(candidate)) {
		case "image/jpeg", "image/jpg":
			return "image/jpeg"
		case "image/png":
			return "image/png"
		case "image/heic", "image/heif":
			return "image/heic"
		case "video/mp4":
			return "video/mp4"
		case "video/quicktime":
			return "video/quicktime"
		}
	}
	return ""
}

func isProfilePostMediaTypeCompatible(mediaType string, mimeType string) bool {
	switch mediaType {
	case "photo":
		return strings.HasPrefix(mimeType, "image/")
	case "video":
		return strings.HasPrefix(mimeType, "video/")
	default:
		return false
	}
}

func profilePostMediaExtensionForMimeType(mimeType string) string {
	switch mimeType {
	case "image/png":
		return "png"
	case "image/heic":
		return "heic"
	case "video/quicktime":
		return "mov"
	case "video/mp4":
		return "mp4"
	default:
		return "jpg"
	}
}
