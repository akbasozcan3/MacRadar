package server

import (
	"context"
	"errors"
	"html/template"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"macradar/backend/internal/account"
	"macradar/backend/internal/i18n"
	"macradar/backend/internal/meta"
)

func (s *Server) handleBootstrap(w http.ResponseWriter, r *http.Request) {
	s.respondJSON(w, http.StatusOK, map[string]any{
		"implementation": "go",
		"serverTime":     time.Now().UTC().Format(time.RFC3339Nano),
		"service":        "go",
		"status":         "ok",
		"version":        "launch-bootstrap-v1",
	})
}

func (s *Server) handleAppI18n(w http.ResponseWriter, r *http.Request) {
	locale := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("locale")))
	if locale == "" {
		locale = "en"
	}

	switch locale {
	case "en":
		setPrivateCacheControl(w, 3600)
		s.respondJSON(w, http.StatusOK, map[string]any{
			"locale":  "en",
			"strings": i18n.EnglishStrings(),
			"version": i18n.EnglishBundleVersion(),
		})
	case "tr":
		setPrivateCacheControl(w, 3600)
		s.respondJSON(w, http.StatusOK, map[string]any{
			"locale":  "tr",
			"strings": map[string]string{},
			"version": "0",
		})
	default:
		s.respondError(w, http.StatusBadRequest, "invalid_locale", "locale yalnizca en veya tr olabilir.")
	}
}

func (s *Server) handleOverview(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
	defer cancel()

	overview, err := s.accounts.Overview(ctx)
	if err != nil {
		s.respondError(w, http.StatusInternalServerError, "overview_query_failed", "Genel ozet bilgileri alinamadi.")
		return
	}

	s.respondJSON(w, http.StatusOK, overview)
}

func (s *Server) handleCountryCallingCodes(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "public, max-age=86400")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(meta.CountryCallingCodesJSON)
}

func (s *Server) handleUsernameCheck(w http.ResponseWriter, r *http.Request) {
	username := strings.TrimSpace(r.URL.Query().Get("username"))
	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
	defer cancel()

	response, err := s.accounts.CheckUsernameAvailability(ctx, username)
	if err != nil {
		s.respondAccountError(w, err)
		return
	}

	setPrivateCacheControl(w, 5)
	s.respondJSON(w, http.StatusOK, response)
}

func (s *Server) handleRegister(w http.ResponseWriter, r *http.Request) {
	var input account.RegisterInput
	if err := s.decodeJSON(r, &input); err != nil {
		s.respondDecodeError(w, err, "invalid_register_payload")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 8*time.Second)
	defer cancel()

	response, err := s.accounts.Register(ctx, input)
	if err != nil {
		s.respondAccountError(w, err)
		return
	}

	s.respondJSON(w, http.StatusCreated, response)
}

func (s *Server) handleLogin(w http.ResponseWriter, r *http.Request) {
	var input account.LoginInput
	if err := s.decodeJSON(r, &input); err != nil {
		s.respondDecodeError(w, err, "invalid_login_payload")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 6*time.Second)
	defer cancel()

	response, err := s.accounts.Login(ctx, input, s.clientMetadata(r))
	if err != nil {
		s.respondAccountError(w, err)
		return
	}

	s.respondJSON(w, http.StatusOK, response)
}

func (s *Server) handleVerifyEmail(w http.ResponseWriter, r *http.Request) {
	token := strings.TrimSpace(r.URL.Query().Get("token"))
	ctx, cancel := context.WithTimeout(r.Context(), 6*time.Second)
	defer cancel()

	result, err := s.accounts.VerifyEmail(ctx, token)
	if err != nil {
		if s.acceptsHTML(r) {
			s.renderVerificationPage(w, s.accounts.VerificationResultForError(err, result))
			return
		}

		s.respondAccountError(w, err)
		return
	}

	if s.acceptsHTML(r) {
		s.renderVerificationPage(w, result)
		return
	}

	s.respondJSON(w, http.StatusOK, result)
}

func (s *Server) handleResendVerification(w http.ResponseWriter, r *http.Request) {
	var input account.ResendVerificationInput
	if err := s.decodeJSON(r, &input); err != nil {
		s.respondDecodeError(w, err, "invalid_resend_payload")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 8*time.Second)
	defer cancel()

	response, err := s.accounts.ResendVerification(ctx, input)
	if err != nil {
		s.respondAccountError(w, err)
		return
	}

	s.respondJSON(w, http.StatusOK, response)
}

func (s *Server) handleConfirmVerifyEmail(w http.ResponseWriter, r *http.Request) {
	var input account.VerifyEmailConfirmInput
	if err := s.decodeJSON(r, &input); err != nil {
		s.respondDecodeError(w, err, "invalid_verify_email_payload")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 8*time.Second)
	defer cancel()

	response, err := s.accounts.ConfirmEmailVerification(ctx, input)
	if err != nil {
		s.respondAccountError(w, err)
		return
	}

	s.respondJSON(w, http.StatusOK, response)
}

func (s *Server) handleSocialLogin(w http.ResponseWriter, r *http.Request) {
	var input account.SocialLoginInput
	if err := s.decodeJSON(r, &input); err != nil {
		s.respondDecodeError(w, err, "invalid_social_payload")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 6*time.Second)
	defer cancel()

	response, err := s.accounts.SocialLogin(ctx, input)
	if err != nil {
		s.respondAccountError(w, err)
		return
	}

	s.respondJSON(w, http.StatusOK, response)
}

func (s *Server) handlePasswordResetRequest(w http.ResponseWriter, r *http.Request) {
	var input account.PasswordResetRequestInput
	if err := s.decodeJSON(r, &input); err != nil {
		s.respondDecodeError(w, err, "invalid_password_reset_request_payload")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 8*time.Second)
	defer cancel()

	response, err := s.accounts.RequestPasswordReset(ctx, input)
	if err != nil {
		s.respondAccountError(w, err)
		return
	}

	s.respondJSON(w, http.StatusOK, response)
}

func (s *Server) handlePasswordResetConfirm(w http.ResponseWriter, r *http.Request) {
	var input account.PasswordResetConfirmInput
	if err := s.decodeJSON(r, &input); err != nil {
		s.respondDecodeError(w, err, "invalid_password_reset_confirm_payload")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 8*time.Second)
	defer cancel()

	response, err := s.accounts.ConfirmPasswordReset(ctx, input)
	if err != nil {
		s.respondAccountError(w, err)
		return
	}

	s.respondJSON(w, http.StatusOK, response)
}

func (s *Server) handleResetDevelopmentAuth(w http.ResponseWriter, r *http.Request) {
	if s.cfg.Environment == "production" {
		s.respondError(w, http.StatusNotFound, "not_found", "Kaynak bulunamadi.")
		return
	}
	if !s.isLoopbackRequest(r) {
		s.respondError(w, http.StatusForbidden, "forbidden", "Bu islem yalnizca yerel gelistirme istegi olarak calisabilir.")
		return
	}

	expectedToken := strings.TrimSpace(s.cfg.DevelopmentResetToken)
	providedToken := strings.TrimSpace(r.Header.Get("X-MacRadar-Reset-Token"))
	if expectedToken == "" || providedToken == "" || providedToken != expectedToken {
		s.respondError(w, http.StatusForbidden, "forbidden", "Gelistirme sifirlama anahtari gecersiz.")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()

	result, err := s.accounts.ResetDevelopmentAuthData(ctx)
	if err != nil {
		s.respondError(w, http.StatusInternalServerError, "auth_reset_failed", "Gelistirme auth verisi sifirlanamadi.")
		return
	}

	s.respondJSON(w, http.StatusOK, result)
}

func (s *Server) handleLogout(w http.ResponseWriter, r *http.Request) {
	token := s.bearerToken(r)
	if token == "" {
		s.respondAccountError(w, account.ErrUnauthorized)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
	defer cancel()

	if err := s.accounts.DeleteSession(ctx, token); err != nil {
		s.respondError(w, http.StatusInternalServerError, "logout_failed", "Oturum kapatilamadi.")
		return
	}

	s.respondJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) handleProfile(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
	defer cancel()

	profile, err := s.accounts.ProfileByToken(ctx, s.bearerToken(r))
	if err != nil {
		s.respondAccountError(w, err)
		return
	}

	s.respondJSON(w, http.StatusOK, profile)
}

func (s *Server) handlePublicProfile(w http.ResponseWriter, r *http.Request) {
	targetUserID := strings.TrimSpace(r.PathValue("userID"))
	if targetUserID == "" {
		s.respondError(w, http.StatusBadRequest, "invalid_user_id", "user id is required")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
	defer cancel()

	profile, err := s.accounts.PublicProfileByToken(ctx, s.bearerToken(r), targetUserID)
	if err != nil {
		s.respondAccountError(w, err)
		return
	}

	s.respondJSON(w, http.StatusOK, profile)
}

func (s *Server) handleReportUser(w http.ResponseWriter, r *http.Request) {
	targetUserID := strings.TrimSpace(r.PathValue("userID"))
	if targetUserID == "" {
		s.respondError(w, http.StatusBadRequest, "invalid_user_id", "user id is required")
		return
	}

	var input account.UserReportInput
	if err := s.decodeJSON(r, &input); err != nil && !errors.Is(err, io.EOF) {
		s.respondDecodeError(w, err, "invalid_user_report_payload")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
	defer cancel()

	response, err := s.accounts.ReportUserByToken(ctx, s.bearerToken(r), targetUserID, input.Reason)
	if err != nil {
		s.respondAccountError(w, err)
		return
	}

	s.respondJSON(w, http.StatusCreated, response)
}

func (s *Server) handleUpdateProfile(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
	defer cancel()

	identity, err := s.requireIdentity(ctx, r)
	if err != nil {
		s.respondAccountError(w, err)
		return
	}

	var input account.UpdateProfileInput
	if err := s.decodeJSON(r, &input); err != nil {
		s.respondDecodeError(w, err, "invalid_profile_payload")
		return
	}

	profile, err := s.accounts.UpdateProfile(ctx, identity.UserID, input)
	if err != nil {
		s.respondAccountError(w, err)
		return
	}

	s.respondJSON(w, http.StatusOK, profile)
}

func (s *Server) handleDeleteAccount(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 8*time.Second)
	defer cancel()

	identity, err := s.requireIdentity(ctx, r)
	if err != nil {
		s.respondAccountError(w, err)
		return
	}

	response, err := s.accounts.DeleteAccount(ctx, identity.UserID)
	if err != nil {
		s.respondAccountError(w, err)
		return
	}

	s.respondJSON(w, http.StatusOK, response)
}

func (s *Server) handleRequestDeleteAccountCode(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 8*time.Second)
	defer cancel()

	identity, err := s.requireIdentity(ctx, r)
	if err != nil {
		s.respondAccountError(w, err)
		return
	}

	response, err := s.accounts.RequestDeleteAccountCode(ctx, identity.UserID)
	if err != nil {
		s.respondAccountError(w, err)
		return
	}

	s.respondJSON(w, http.StatusOK, response)
}

type deleteAccountConfirmInput struct {
	Code string `json:"code"`
}

func (s *Server) handleConfirmDeleteAccount(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 8*time.Second)
	defer cancel()

	identity, err := s.requireIdentity(ctx, r)
	if err != nil {
		s.respondAccountError(w, err)
		return
	}

	var input deleteAccountConfirmInput
	if err := s.decodeJSON(r, &input); err != nil {
		s.respondDecodeError(w, err, "invalid_delete_account_confirm_payload")
		return
	}

	response, err := s.accounts.ConfirmDeleteAccount(ctx, identity.UserID, input.Code)
	if err != nil {
		s.respondAccountError(w, err)
		return
	}

	s.respondJSON(w, http.StatusOK, response)
}

func (s *Server) handleProfilePrivacy(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
	defer cancel()

	settings, err := s.accounts.PrivacySettingsByToken(ctx, s.bearerToken(r))
	if err != nil {
		s.respondAccountError(w, err)
		return
	}

	s.respondJSON(w, http.StatusOK, settings)
}

func (s *Server) handleUpdateProfilePrivacy(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
	defer cancel()

	identity, err := s.requireIdentity(ctx, r)
	if err != nil {
		s.respondAccountError(w, err)
		return
	}

	var input account.UpdatePrivacySettingsInput
	if err := s.decodeJSON(r, &input); err != nil {
		s.respondDecodeError(w, err, "invalid_privacy_payload")
		return
	}

	settings, err := s.accounts.UpdatePrivacySettings(ctx, identity.UserID, input)
	if err != nil {
		s.respondAccountError(w, err)
		return
	}

	s.respondJSON(w, http.StatusOK, settings)
}

func (s *Server) handleMapPreferences(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
	defer cancel()

	preferences, err := s.accounts.MapPreferencesByToken(ctx, s.bearerToken(r))
	if err != nil {
		s.respondAccountError(w, err)
		return
	}

	s.respondJSON(w, http.StatusOK, preferences)
}

func (s *Server) handleUpdateMapPreferences(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
	defer cancel()

	identity, err := s.requireIdentity(ctx, r)
	if err != nil {
		s.respondAccountError(w, err)
		return
	}

	var input account.UpdateMapPreferencesInput
	if err := s.decodeJSON(r, &input); err != nil {
		s.respondDecodeError(w, err, "invalid_map_preferences_payload")
		return
	}

	preferences, err := s.accounts.UpdateMapPreferences(ctx, identity.UserID, input)
	if err != nil {
		s.respondAccountError(w, err)
		return
	}

	s.respondJSON(w, http.StatusOK, preferences)
}

func (s *Server) handleProfileAppSettings(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
	defer cancel()

	settings, err := s.accounts.ProfileAppSettingsByToken(ctx, s.bearerToken(r))
	if err != nil {
		s.respondAccountError(w, err)
		return
	}

	s.respondJSON(w, http.StatusOK, settings)
}

func (s *Server) handleProfileRequestSummary(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
	defer cancel()

	summary, err := s.accounts.ProfileRequestSummaryByToken(ctx, s.bearerToken(r))
	if err != nil {
		s.respondAccountError(w, err)
		return
	}

	s.respondJSON(w, http.StatusOK, summary)
}

func (s *Server) handleProfileNotifications(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
	defer cancel()

	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	if limit <= 0 {
		limit = 30
	}
	offset, _ := strconv.Atoi(r.URL.Query().Get("offset"))
	category := strings.TrimSpace(r.URL.Query().Get("category"))
	cursor := strings.TrimSpace(r.URL.Query().Get("cursor"))

	response, err := s.accounts.ListProfileNotificationsByToken(ctx, s.bearerToken(r), category, cursor, limit, offset)
	if err != nil {
		s.respondAccountError(w, err)
		return
	}

	s.respondJSON(w, http.StatusOK, response)
}

func (s *Server) handleMarkNotificationsRead(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
	defer cancel()

	var input account.MarkNotificationsReadInput
	if err := s.decodeJSON(r, &input); err != nil {
		s.respondDecodeError(w, err, "invalid_notifications_read_payload")
		return
	}

	response, err := s.accounts.MarkNotificationsReadByToken(ctx, s.bearerToken(r), input)
	if err != nil {
		s.respondAccountError(w, err)
		return
	}

	s.respondJSON(w, http.StatusOK, response)
}

func (s *Server) handleProfileHelp(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
	defer cancel()

	if _, err := s.requireIdentity(ctx, r); err != nil {
		s.respondAccountError(w, err)
		return
	}

	type helpItem struct {
		Description string `json:"description"`
		Title       string `json:"title"`
	}

	response := struct {
		Items        []helpItem `json:"items"`
		SupportEmail string     `json:"supportEmail"`
		SupportHours string     `json:"supportHours"`
		UpdatedAt    time.Time  `json:"updatedAt"`
	}{
		Items: []helpItem{
			{
				Title:       "Gizli hesapta takip istekleri nerede?",
				Description: "Profil ekranindaki Takip Istekleri kartindan tum bekleyen talepleri yonetebilirsin.",
			},
			{
				Title:       "Dil degisikligi kaydolmadi",
				Description: "Dil tercihi backend'e kaydedilir. Baglanti hatasi durumunda ayarlari yenileyip tekrar dene.",
			},
			{
				Title:       "Sifre degistiremiyorum",
				Description: "Yeni sifre 10-12 karakter araliginda olmali ve mevcut sifre dogru girilmelidir.",
			},
			{
				Title:       "Bildirimler gelmiyor",
				Description: "Bildirim tercihlerini acik tut ve cihaz bildirim izinlerini kontrol et.",
			},
		},
		SupportEmail: "support@macradar.app",
		SupportHours: "Hafta ici 09:00-18:00",
		UpdatedAt:    time.Now().UTC(),
	}

	s.respondJSON(w, http.StatusOK, response)
}
func (s *Server) handleUpdateProfileAppSettings(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
	defer cancel()

	identity, err := s.requireIdentity(ctx, r)
	if err != nil {
		s.respondAccountError(w, err)
		return
	}

	var input account.UpdateProfileAppSettingsInput
	if err := s.decodeJSON(r, &input); err != nil {
		s.respondDecodeError(w, err, "invalid_profile_app_settings_payload")
		return
	}

	settings, err := s.accounts.UpdateProfileAppSettings(ctx, identity.UserID, input)
	if err != nil {
		s.respondAccountError(w, err)
		return
	}

	s.respondJSON(w, http.StatusOK, settings)
}

func (s *Server) handleFollowRequests(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
	defer cancel()

	response, err := s.accounts.ListFollowRequestsByToken(ctx, s.bearerToken(r))
	if err != nil {
		s.respondAccountError(w, err)
		return
	}

	setPrivateCacheControl(w, 20)
	s.respondJSON(w, http.StatusOK, response)
}

func (s *Server) handleAcceptFollowRequest(w http.ResponseWriter, r *http.Request) {
	s.handleResolveFollowRequest(w, r, true)
}

func (s *Server) handleRejectFollowRequest(w http.ResponseWriter, r *http.Request) {
	s.handleResolveFollowRequest(w, r, false)
}

func (s *Server) handleResolveFollowRequest(w http.ResponseWriter, r *http.Request, accept bool) {
	requesterID := strings.TrimSpace(r.PathValue("requesterID"))
	if requesterID == "" {
		s.respondError(w, http.StatusBadRequest, "invalid_requester_id", "requester id is required")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
	defer cancel()

	identity, err := s.requireIdentity(ctx, r)
	if err != nil {
		s.respondAccountError(w, err)
		return
	}

	response, err := s.accounts.ResolveFollowRequest(ctx, identity.UserID, requesterID, accept)
	if err != nil {
		s.respondAccountError(w, err)
		return
	}

	if accept {
		s.broadcastRequestRealtimeEvent(
			identity.UserID,
			"request.resolved",
			"follow",
			requesterID,
			identity.UserID,
			-1,
			"accepted",
		)
	} else {
		s.broadcastRequestRealtimeEvent(
			identity.UserID,
			"request.cancelled",
			"follow",
			requesterID,
			identity.UserID,
			-1,
			"rejected",
		)
	}

	s.respondJSON(w, http.StatusOK, response)
}

func (s *Server) handleBlockedUsers(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
	defer cancel()

	response, err := s.accounts.ListBlockedUsersByToken(ctx, s.bearerToken(r))
	if err != nil {
		s.respondAccountError(w, err)
		return
	}

	s.respondJSON(w, http.StatusOK, response)
}

func (s *Server) handleBlockUser(w http.ResponseWriter, r *http.Request) {
	s.handleBlockUserMutation(w, r, true)
}

func (s *Server) handleUnblockUser(w http.ResponseWriter, r *http.Request) {
	s.handleBlockUserMutation(w, r, false)
}

func (s *Server) handleBlockUserMutation(w http.ResponseWriter, r *http.Request, shouldBlock bool) {
	blockedUserID := strings.TrimSpace(r.PathValue("blockedUserID"))
	if blockedUserID == "" {
		s.respondError(w, http.StatusBadRequest, "invalid_blocked_user_id", "blocked user id is required")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
	defer cancel()

	identity, err := s.requireIdentity(ctx, r)
	if err != nil {
		s.respondAccountError(w, err)
		return
	}

	var response account.BlockedUserOperationResponse
	if shouldBlock {
		response, err = s.accounts.BlockUser(ctx, identity.UserID, blockedUserID)
	} else {
		response, err = s.accounts.UnblockUser(ctx, identity.UserID, blockedUserID)
	}
	if err != nil {
		s.respondAccountError(w, err)
		return
	}

	// Do not broadcast unblock relationship events to avoid surfacing
	// "old request restored/read" style side effects on the peer UI.
	if shouldBlock {
		s.emitMessageRelationshipEvent(identity.UserID, blockedUserID, true)
	}
	s.respondJSON(w, http.StatusOK, response)
}

func (s *Server) handleChangePassword(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 6*time.Second)
	defer cancel()

	identity, err := s.requireIdentity(ctx, r)
	if err != nil {
		s.respondAccountError(w, err)
		return
	}

	var input account.PasswordChangeInput
	if err := s.decodeJSON(r, &input); err != nil {
		s.respondDecodeError(w, err, "invalid_change_password_payload")
		return
	}

	response, err := s.accounts.ChangePassword(ctx, identity.UserID, identity.SessionID, input)
	if err != nil {
		s.respondAccountError(w, err)
		return
	}

	s.respondJSON(w, http.StatusOK, response)
}

func (s *Server) respondAccountError(w http.ResponseWriter, err error) {
	var appErr *account.AppError
	if errors.As(err, &appErr) {
		s.respondErrorWithDetails(w, appErr.Status, appErr.Code, appErr.Message, appErr.Details)
		return
	}

	switch {
	case errors.Is(err, account.ErrUnauthorized):
		s.respondError(w, http.StatusUnauthorized, "unauthorized", "Oturum dogrulanamadi.")
	case errors.Is(err, account.ErrInvalidCredentials):
		s.respondError(w, http.StatusUnauthorized, "invalid_credentials", "Email veya sifre hatali.")
	case errors.Is(err, account.ErrEmailInUse):
		s.respondError(w, http.StatusConflict, "email_in_use", "Bu email adresi zaten kullaniliyor.")
	default:
		s.logger.Error("unhandled account error", "error", err)
		s.respondError(w, http.StatusInternalServerError, "request_failed", "Islem su anda tamamlanamadi.")
	}
}

func (s *Server) optionalIdentity(r *http.Request) (*account.SessionIdentity, error) {
	token := s.bearerToken(r)
	if token == "" {
		return nil, nil
	}

	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
	defer cancel()

	identity, err := s.accounts.AuthenticateSession(ctx, token)
	if err != nil {
		return nil, err
	}

	return &identity, nil
}

func (s *Server) requireIdentity(ctx context.Context, r *http.Request) (account.SessionIdentity, error) {
	token := s.bearerToken(r)
	if token == "" {
		return account.SessionIdentity{}, account.ErrUnauthorized
	}

	return s.accounts.AuthenticateSession(ctx, token)
}

func (s *Server) bearerToken(r *http.Request) string {
	value := strings.TrimSpace(r.Header.Get("Authorization"))
	const prefix = "Bearer "
	if value != "" {
		if strings.HasPrefix(strings.ToLower(value), strings.ToLower(prefix)) {
			return strings.TrimSpace(value[len(prefix):])
		}
	}

	// Some native media/websocket clients may not reliably send custom headers.
	// Accept token query fallback for websocket upgrades and protected voice files.
	normalizedPath := strings.ToLower(strings.TrimSpace(r.URL.Path))
	if strings.HasPrefix(normalizedPath, "/ws/") ||
		strings.HasPrefix(normalizedPath, "/api/v1/messages/voice/files/") ||
		strings.HasPrefix(normalizedPath, "/api/v1/profile/post-media/files/") {
		if token := strings.TrimSpace(r.URL.Query().Get("token")); token != "" {
			return token
		}
		if token := strings.TrimSpace(r.URL.Query().Get("access_token")); token != "" {
			return token
		}
	}

	return ""
}

func (s *Server) acceptsHTML(r *http.Request) bool {
	if strings.EqualFold(strings.TrimSpace(r.URL.Query().Get("format")), "json") {
		return false
	}

	return strings.Contains(strings.ToLower(r.Header.Get("Accept")), "text/html")
}

func (s *Server) renderVerificationPage(w http.ResponseWriter, result account.VerifyEmailResult) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	statusCode := http.StatusOK
	if result.Status != account.VerifyEmailStatusVerified {
		statusCode = http.StatusBadRequest
	}
	w.WriteHeader(statusCode)
	_ = verificationPageTemplate.Execute(w, map[string]any{
		"description": "MacRadar email verification result",
		"email":       result.Email,
		"message":     result.Message,
		"status":      result.Status,
		"title":       s.accounts.VerificationPageTitle(result),
	})
}

var verificationPageTemplate = template.Must(template.New("verification-page").Parse(`
<!DOCTYPE html>
<html lang="tr">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>{{ .title }}</title>
    <style>
      body {
        margin: 0;
        padding: 0;
        background: radial-gradient(circle at top, #f4eadf 0%, #f0ece6 35%, #e6edf4 100%);
        font-family: Arial, sans-serif;
        color: #223045;
      }
      .shell {
        min-height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 24px;
      }
      .card {
        width: 100%;
        max-width: 640px;
        background: rgba(255,255,255,0.94);
        border: 1px solid rgba(221, 215, 207, 0.9);
        border-radius: 28px;
        box-shadow: 0 28px 60px rgba(24, 31, 43, 0.16);
        overflow: hidden;
      }
      .hero {
        padding: 32px;
        background: linear-gradient(135deg, #223045, #de8236);
        color: #ffffff;
      }
      .hero h1 {
        margin: 10px 0 0;
        font-size: 34px;
        line-height: 42px;
      }
      .body {
        padding: 32px;
      }
      .status {
        display: inline-block;
        margin-bottom: 16px;
        padding: 8px 14px;
        border-radius: 999px;
        background: #f3efe8;
        color: #de8236;
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 1px;
        text-transform: uppercase;
      }
      .message {
        margin: 0;
        font-size: 17px;
        line-height: 28px;
      }
      .meta {
        margin-top: 18px;
        color: #66707c;
        font-size: 14px;
        line-height: 22px;
      }
    </style>
  </head>
  <body>
    <main class="shell">
      <section class="card">
        <div class="hero">
          <div style="font-size:13px;letter-spacing:2px;text-transform:uppercase;opacity:0.82;">MacRadar</div>
          <h1>{{ .title }}</h1>
        </div>
        <div class="body">
          <div class="status">{{ .status }}</div>
          <p class="message">{{ .message }}</p>
          {{ if .email }}
            <p class="meta">Email: {{ .email }}</p>
          {{ end }}
          <p class="meta">MacRadar uygulamasina geri donup giris yapabilirsiniz.</p>
        </div>
      </section>
    </main>
  </body>
</html>
`))
