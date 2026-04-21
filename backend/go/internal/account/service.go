package account

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"macradar/backend/internal/mail"

	"github.com/jackc/pgx/v5"
	"golang.org/x/crypto/bcrypt"
)

type ServiceConfig struct {
	AppBaseURL                  string
	AuthDebugPreview            bool
	Environment                 string
	GoogleWebClientID           string
	JWTSecret                   string
	LoginAttemptWindow          time.Duration
	LoginMaxAttempts            int
	PasswordHashCost            int
	PasswordResetCodeTTL        time.Duration
	PasswordResetMaxAttempts    int
	PasswordResetMaxSendsWindow int
	PasswordResetResendCooldown time.Duration
	PasswordResetSendWindow     time.Duration
	VerificationMaxSendsWindow  int
	VerificationResendCooldown  time.Duration
	VerificationSendWindow      time.Duration
	VerificationTokenTTL        time.Duration
}

type Service struct {
	cfg    ServiceConfig
	logger *slog.Logger
	mailer mail.Service
	repo   *Repository
}

const verificationMaxAttempts = 5
const (
	defaultPasswordHashCost = bcrypt.DefaultCost
	minPasswordHashCost     = 8
	maxPasswordHashCost     = 14
)

func NewService(repo *Repository, mailer mail.Service, cfg ServiceConfig, logger *slog.Logger) *Service {
	cfg.PasswordHashCost = normalizePasswordHashCost(cfg.PasswordHashCost)

	return &Service{
		cfg:    cfg,
		logger: logger,
		mailer: mailer,
		repo:   repo,
	}
}

func (s *Service) Overview(ctx context.Context) (Overview, error) {
	return s.repo.Overview(ctx)
}

func (s *Service) ResetDevelopmentAuthData(ctx context.Context) (DevelopmentResetResult, error) {
	return s.repo.ResetDevelopmentAuthData(ctx)
}

func (s *Service) Register(ctx context.Context, input RegisterInput) (VerificationChallengeResponse, error) {
	normalized, err := normalizeRegisterInput(input)
	if err != nil {
		return VerificationChallengeResponse{}, validationError(err)
	}

	passwordHash, err := bcrypt.GenerateFromPassword([]byte(normalized.Password), s.cfg.PasswordHashCost)
	if err != nil {
		return VerificationChallengeResponse{}, err
	}

	rawCode, _, err := newNumericCode(6)
	if err != nil {
		return VerificationChallengeResponse{}, err
	}
	codeHash := hashVerificationCode(normalized.Email, rawCode)

	now := time.Now().UTC()
	expiresAt := now.Add(s.cfg.VerificationTokenTTL)
	var response VerificationChallengeResponse

	if err := s.withTx(ctx, func(tx pgx.Tx) error {
		if err := s.repo.LockEmailTx(ctx, tx, normalized.Email); err != nil {
			return err
		}

		user, found, err := s.repo.FindUserByEmailTx(ctx, tx, normalized.Email, true)
		if err != nil {
			return err
		}

		message := "Email adresinize 6 haneli dogrulama kodu gonderdik. Lutfen kodu uygulamaya girerek hesabinizi aktive edin."

		if !found {
			usernameTaken, err := s.repo.UsernameTakenTx(ctx, tx, normalized.Username, "")
			if err != nil {
				return err
			}
			if usernameTaken {
				return usernameTakenError()
			}

			user, err = s.repo.InsertLocalUserTx(ctx, tx, normalized, string(passwordHash), normalized.Username)
			if err != nil {
				return err
			}
		} else {
			if user.IsEmailVerified || user.Status == UserStatusActive {
				return emailInUseError()
			}
			if user.Status == UserStatusDisabled {
				return accountDisabledError()
			}
			if user.AuthProvider != "local" && user.AuthProvider != "" {
				return emailInUseError()
			}

			usernameTaken, err := s.repo.UsernameTakenTx(ctx, tx, normalized.Username, user.ID)
			if err != nil {
				return err
			}
			if usernameTaken {
				return usernameTakenError()
			}

			if err := s.repo.UpdatePendingLocalUserTx(ctx, tx, user.ID, normalized, string(passwordHash), normalized.Username); err != nil {
				return err
			}
			message = "Bu email adresi icin bekleyen hesap bulundu. Yeni 6 haneli dogrulama kodu hazirlandi."
		}

		if err := s.ensureVerificationCanBeSentTx(ctx, tx, user.ID, now); err != nil {
			return err
		}

		if err := s.repo.InvalidateUnusedVerificationTokensTx(ctx, tx, user.ID); err != nil {
			return err
		}

		if err := s.repo.InsertVerificationTokenTx(ctx, tx, user.ID, codeHash, expiresAt); err != nil {
			return err
		}

		response = VerificationChallengeResponse{
			DebugCode:         s.debugVerificationCode(rawCode),
			Email:             normalized.Email,
			ExpiresAt:         expiresAt,
			Message:           "Email adresinize 6 haneli dogrulama kodu gonderdik. Kodu uygulamaya girerek hesabinizi aktive edin.",
			ResendAvailableAt: now.Add(s.cfg.VerificationResendCooldown),
			Status:            UserStatusPendingVerification,
		}
		if strings.Contains(message, "bekleyen hesap") {
			response.Message = "Bu email adresi icin yeni 6 haneli dogrulama kodu gonderildi."
		}

		return nil
	}); err != nil {
		return VerificationChallengeResponse{}, err
	}

	if err := s.mailer.SendVerificationEmail(ctx, mail.VerificationEmailInput{
		Code:      rawCode,
		ExpiresAt: expiresAt,
		ToAddress: normalized.Email,
		ToName:    normalized.FullName,
	}); err != nil {
		s.logger.Error("verification email send failed", slog.Any("error", err), slog.String("email", normalized.Email))
		if s.cfg.AuthDebugPreview {
			response.Message = "Dogrulama emaili gonderilemedi. Debug kod ile bu cihazda devam edebilirsiniz."
			return response, nil
		}
		_ = s.repo.DeleteVerificationToken(ctx, codeHash)
		return VerificationChallengeResponse{}, verificationEmailFailedError()
	}

	return response, nil
}

func (s *Service) CheckUsernameAvailability(ctx context.Context, username string) (UsernameAvailabilityResponse, error) {
	normalized, err := normalizeUsernameValue(username)
	if err != nil {
		return UsernameAvailabilityResponse{}, validationError(err)
	}

	taken, err := s.repo.UsernameTaken(ctx, normalized)
	if err != nil {
		return UsernameAvailabilityResponse{}, err
	}

	return UsernameAvailabilityResponse{Available: !taken}, nil
}

func (s *Service) ResendVerification(ctx context.Context, input ResendVerificationInput) (VerificationChallengeResponse, error) {
	normalized, err := normalizeResendInput(input)
	if err != nil {
		return VerificationChallengeResponse{}, validationError(err)
	}

	rawCode, _, err := newNumericCode(6)
	if err != nil {
		return VerificationChallengeResponse{}, err
	}
	codeHash := hashVerificationCode(normalized.Email, rawCode)

	now := time.Now().UTC()
	expiresAt := now.Add(s.cfg.VerificationTokenTTL)
	var (
		fullName string
		response VerificationChallengeResponse
	)

	if err := s.withTx(ctx, func(tx pgx.Tx) error {
		if err := s.repo.LockEmailTx(ctx, tx, normalized.Email); err != nil {
			return err
		}

		user, found, err := s.repo.FindUserByEmailTx(ctx, tx, normalized.Email, true)
		if err != nil {
			return err
		}
		if !found {
			return verificationNotPendingError()
		}
		if user.Status == UserStatusDisabled {
			return accountDisabledError()
		}
		if user.IsEmailVerified || user.Status == UserStatusActive {
			return emailAlreadyVerifiedError()
		}

		if err := s.ensureVerificationCanBeSentTx(ctx, tx, user.ID, now); err != nil {
			return err
		}

		if err := s.repo.InvalidateUnusedVerificationTokensTx(ctx, tx, user.ID); err != nil {
			return err
		}
		if err := s.repo.InsertVerificationTokenTx(ctx, tx, user.ID, codeHash, expiresAt); err != nil {
			return err
		}

		fullName = user.FullName
		response = VerificationChallengeResponse{
			DebugCode:         s.debugVerificationCode(rawCode),
			Email:             normalized.Email,
			ExpiresAt:         expiresAt,
			Message:           "Yeni 6 haneli dogrulama kodu email adresinize gonderildi.",
			ResendAvailableAt: now.Add(s.cfg.VerificationResendCooldown),
			Status:            UserStatusPendingVerification,
		}
		return nil
	}); err != nil {
		return VerificationChallengeResponse{}, err
	}

	if err := s.mailer.SendVerificationEmail(ctx, mail.VerificationEmailInput{
		Code:      rawCode,
		ExpiresAt: expiresAt,
		ToAddress: normalized.Email,
		ToName:    fullName,
	}); err != nil {
		s.logger.Error("verification email resend failed", slog.Any("error", err), slog.String("email", normalized.Email))
		if s.cfg.AuthDebugPreview {
			response.Message = "Dogrulama emaili gonderilemedi. Debug kod ile devam edebilirsiniz."
			return response, nil
		}
		_ = s.repo.DeleteVerificationToken(ctx, codeHash)
		return VerificationChallengeResponse{}, verificationEmailFailedError()
	}

	return response, nil
}

func (s *Service) ConfirmEmailVerification(ctx context.Context, input VerifyEmailConfirmInput) (VerifyEmailResult, error) {
	normalized, err := normalizeVerificationConfirmInput(input)
	if err != nil {
		return VerifyEmailResult{}, validationError(err)
	}

	now := time.Now().UTC()
	result := VerifyEmailResult{
		Email: normalized.Email,
	}

	err = s.withTx(ctx, func(tx pgx.Tx) error {
		if err := s.repo.LockEmailTx(ctx, tx, normalized.Email); err != nil {
			return err
		}

		user, found, err := s.repo.FindUserByEmailTx(ctx, tx, normalized.Email, true)
		if err != nil {
			return err
		}
		if !found {
			result.Message = "Dogrulama kodu gecersiz."
			result.Status = VerifyEmailStatusInvalid
			return invalidVerificationError()
		}
		if user.IsEmailVerified || user.Status == UserStatusActive {
			result.Message = "Email adresiniz zaten dogrulanmis."
			result.Status = VerifyEmailStatusAlreadyVerified
			return emailAlreadyVerifiedError()
		}

		record, found, err := s.repo.FindActiveVerificationTokenTx(ctx, tx, user.ID)
		if err != nil {
			return err
		}
		if !found {
			result.Message = "Dogrulama kodu gecersiz."
			result.Status = VerifyEmailStatusInvalid
			return invalidVerificationError()
		}

		if now.After(record.ExpiresAt) {
			if err := s.repo.MarkVerificationTokenUsedTx(ctx, tx, record.ID, now); err != nil {
				return err
			}
			result.Message = "Dogrulama kodunun suresi dolmus. Yeni kod isteyin."
			result.Status = VerifyEmailStatusExpired
			return verificationExpiredError(map[string]any{
				"email": normalized.Email,
			})
		}

		if record.AttemptCount >= verificationMaxAttempts {
			if err := s.repo.MarkVerificationTokenUsedTx(ctx, tx, record.ID, now); err != nil {
				return err
			}
			result.Message = "Bu kod icin cok fazla hatali deneme yapildi. Yeni kod isteyin."
			result.Status = VerifyEmailStatusInvalid
			return verificationLockedError()
		}

		if hashVerificationCode(normalized.Email, normalized.Code) != record.TokenHash {
			if err := s.repo.IncrementVerificationAttemptTx(ctx, tx, record.ID, now); err != nil {
				return err
			}

			nextAttempts := record.AttemptCount + 1
			if nextAttempts >= verificationMaxAttempts {
				if err := s.repo.MarkVerificationTokenUsedTx(ctx, tx, record.ID, now); err != nil {
					return err
				}
				result.Message = "Bu kod icin cok fazla hatali deneme yapildi. Yeni kod isteyin."
				result.Status = VerifyEmailStatusInvalid
				return verificationLockedError()
			}

			result.Message = "Dogrulama kodu gecersiz."
			result.Status = VerifyEmailStatusInvalid
			return invalidVerificationError()
		}

		if err := s.repo.MarkUserEmailVerifiedTx(ctx, tx, user.ID); err != nil {
			return err
		}
		if err := s.repo.MarkVerificationTokenUsedTx(ctx, tx, record.ID, now); err != nil {
			return err
		}

		result.Message = "Email adresiniz dogrulandi. Artik giris yapabilirsiniz."
		result.Status = VerifyEmailStatusVerified
		result.VerifiedAt = &now
		return nil
	})
	if err != nil {
		return result, err
	}

	return result, nil
}

func (s *Service) RequestPasswordReset(ctx context.Context, input PasswordResetRequestInput) (PasswordResetChallengeResponse, error) {
	normalized, err := normalizePasswordResetRequestInput(input)
	if err != nil {
		return PasswordResetChallengeResponse{}, validationError(err)
	}

	now := time.Now().UTC()
	response := PasswordResetChallengeResponse{
		Delivery:          "email",
		Email:             normalized.Email,
		ExpiresAt:         now.Add(s.cfg.PasswordResetCodeTTL),
		Message:           "Email adresinize 6 haneli sifre yenileme kodu gonderildi.",
		ResendAvailableAt: now.Add(s.cfg.PasswordResetResendCooldown),
	}

	rawCode, _, err := newNumericCode(6)
	if err != nil {
		return PasswordResetChallengeResponse{}, err
	}
	codeHash := hashPasswordResetCode(normalized.Email, rawCode)

	expiresAt := now.Add(s.cfg.PasswordResetCodeTTL)
	var (
		fullName string
		userID   string
	)
	denyPasswordReset := func(reason string) error {
		s.logger.Info("password reset eligibility denied",
			slog.String("email", normalized.Email),
			slog.String("reason", reason),
		)
		if s.cfg.AuthDebugPreview {
			return passwordResetNotAllowedDiagnosticError(reason)
		}
		return passwordResetNotAllowedError()
	}

	if err := s.withTx(ctx, func(tx pgx.Tx) error {
		if err := s.repo.LockEmailTx(ctx, tx, normalized.Email); err != nil {
			return err
		}

		user, found, err := s.repo.FindUserByEmailTx(ctx, tx, normalized.Email, true)
		if err != nil {
			return err
		}
		if !found {
			return denyPasswordReset("not_found")
		}
		if user.Status != UserStatusActive || !user.IsEmailVerified {
			return denyPasswordReset("inactive_or_unverified")
		}
		if strings.TrimSpace(user.Email) == "" {
			return denyPasswordReset("empty_email")
		}
		if strings.TrimSpace(user.PasswordHash) == "" {
			return denyPasswordReset("no_password")
		}
		if user.AuthProvider != "local" && strings.TrimSpace(user.AuthProvider) != "" {
			return denyPasswordReset("not_local")
		}

		if err := s.ensurePasswordResetCanBeSentTx(ctx, tx, user.ID, now); err != nil {
			return err
		}

		if err := s.repo.InvalidateUnusedPasswordResetCodesTx(ctx, tx, user.ID); err != nil {
			return err
		}

		if err := s.repo.InsertPasswordResetCodeTx(ctx, tx, user.ID, codeHash, expiresAt); err != nil {
			return err
		}

		fullName = user.FullName
		userID = user.ID
		response.DebugCode = s.debugPasswordResetCode(rawCode)
		response.ExpiresAt = expiresAt
		response.ResendAvailableAt = now.Add(s.cfg.PasswordResetResendCooldown)
		return nil
	}); err != nil {
		return PasswordResetChallengeResponse{}, err
	}

	if err := s.mailer.SendPasswordResetCodeEmail(ctx, mail.PasswordResetCodeEmailInput{
		Code:      rawCode,
		ExpiresAt: expiresAt,
		ToAddress: normalized.Email,
		ToName:    fullName,
	}); err != nil {
		s.logger.Error("password reset code send failed", slog.Any("error", err), slog.String("email", normalized.Email))
		if s.cfg.AuthDebugPreview {
			response.Message = "Sifre yenileme emaili gonderilemedi. Debug kod ile bu cihazda devam edebilirsiniz."
			return response, nil
		}
		_ = s.repo.DeletePasswordResetCode(ctx, userID, codeHash)
		return PasswordResetChallengeResponse{}, passwordResetEmailFailedError()
	}

	return response, nil
}

func (s *Service) ConfirmPasswordReset(ctx context.Context, input PasswordResetConfirmInput) (PasswordOperationResponse, error) {
	normalized, err := normalizePasswordResetConfirmInput(input)
	if err != nil {
		return PasswordOperationResponse{}, validationError(err)
	}

	passwordHash, err := bcrypt.GenerateFromPassword([]byte(normalized.NewPassword), s.cfg.PasswordHashCost)
	if err != nil {
		return PasswordOperationResponse{}, err
	}

	now := time.Now().UTC()
	if err := s.withTx(ctx, func(tx pgx.Tx) error {
		if err := s.repo.LockEmailTx(ctx, tx, normalized.Email); err != nil {
			return err
		}

		user, found, err := s.repo.FindUserByEmailTx(ctx, tx, normalized.Email, true)
		if err != nil {
			return err
		}
		if !found || user.Status != UserStatusActive || !user.IsEmailVerified {
			return invalidPasswordResetCodeError(-1)
		}

		resetCode, found, err := s.repo.FindActivePasswordResetCodeTx(ctx, tx, user.ID)
		if err != nil {
			return err
		}
		if !found {
			return invalidPasswordResetCodeError(-1)
		}

		if now.After(resetCode.ExpiresAt) {
			if err := s.repo.MarkPasswordResetCodeUsedTx(ctx, tx, resetCode.ID, now); err != nil {
				return err
			}
			return passwordResetExpiredError()
		}

		if resetCode.AttemptCount >= s.cfg.PasswordResetMaxAttempts {
			if err := s.repo.MarkPasswordResetCodeUsedTx(ctx, tx, resetCode.ID, now); err != nil {
				return err
			}
			return passwordResetLockedError()
		}

		if !matchesPasswordResetCode(normalized.Email, normalized.Code, resetCode.CodeHash) {
			if err := s.repo.IncrementPasswordResetCodeAttemptTx(ctx, tx, resetCode.ID, now); err != nil {
				return err
			}

			nextAttempts := resetCode.AttemptCount + 1
			if nextAttempts >= s.cfg.PasswordResetMaxAttempts {
				if err := s.repo.MarkPasswordResetCodeUsedTx(ctx, tx, resetCode.ID, now); err != nil {
					return err
				}
				return passwordResetLockedError()
			}

			return invalidPasswordResetCodeError(s.cfg.PasswordResetMaxAttempts - nextAttempts)
		}

		if err := s.repo.UpdatePasswordTx(ctx, tx, user.ID, string(passwordHash)); err != nil {
			return err
		}
		if err := s.repo.MarkPasswordResetCodeUsedTx(ctx, tx, resetCode.ID, now); err != nil {
			return err
		}
		if err := s.repo.DeleteSessionsByUserTx(ctx, tx, user.ID, ""); err != nil {
			return err
		}

		return nil
	}); err != nil {
		return PasswordOperationResponse{}, err
	}

	return PasswordOperationResponse{
		Message: "Şifreniz Güncellendi. Yeni Şifreniz ile giriş yapabilirsiniz.",
	}, nil
}

func (s *Service) VerifyEmail(ctx context.Context, rawToken string) (VerifyEmailResult, error) {
	tokenHash := hashToken(rawToken)
	if tokenHash == "" {
		return VerifyEmailResult{
			Message: "Dogrulama baglantisi gecersiz.",
			Status:  VerifyEmailStatusInvalid,
		}, invalidVerificationError()
	}

	now := time.Now().UTC()
	result := VerifyEmailResult{}

	err := s.withTx(ctx, func(tx pgx.Tx) error {
		record, found, err := s.repo.FindVerificationTokenByHashTx(ctx, tx, tokenHash)
		if err != nil {
			return err
		}
		if !found {
			result = VerifyEmailResult{
				Message: "Dogrulama kodu gecersiz.",
				Status:  VerifyEmailStatusInvalid,
			}
			return invalidVerificationError()
		}

		result.Email = record.Email

		if record.UsedAt != nil {
			result.Message = "Bu dogrulama kodu daha once kullanilmis."
			result.Status = VerifyEmailStatusAlreadyUsed
			return verificationUsedError()
		}

		if record.IsEmailVerified || record.Status == UserStatusActive {
			_ = s.repo.MarkVerificationTokenUsedTx(ctx, tx, record.ID, now)
			result.Message = "Email adresiniz zaten dogrulanmis."
			result.Status = VerifyEmailStatusAlreadyVerified
			return emailAlreadyVerifiedError()
		}

		if now.After(record.ExpiresAt) {
			result.Message = "Dogrulama baglantisinin suresi dolmus."
			result.Status = VerifyEmailStatusExpired
			return verificationExpiredError(map[string]any{
				"email": record.Email,
			})
		}

		if err := s.repo.MarkUserEmailVerifiedTx(ctx, tx, record.UserID); err != nil {
			return err
		}
		if err := s.repo.MarkVerificationTokenUsedTx(ctx, tx, record.ID, now); err != nil {
			return err
		}

		result.Message = "Email adresiniz dogrulandi. Artik giris yapabilirsiniz."
		result.Status = VerifyEmailStatusVerified
		result.VerifiedAt = &now
		return nil
	})
	if err != nil {
		return result, err
	}

	return result, nil
}

func (s *Service) Login(ctx context.Context, input LoginInput, meta RequestMetadata) (AuthResponse, error) {
	normalized, err := normalizeLoginInput(input)
	if err != nil {
		return AuthResponse{}, validationError(err)
	}

	if err := s.enforceLoginRateLimit(ctx, normalized.Identifier, meta.IPAddress); err != nil {
		return AuthResponse{}, err
	}

	user, found, err := s.repo.FindUserByLoginIdentifier(ctx, normalized.Identifier)
	if err != nil {
		return AuthResponse{}, err
	}
	if !found {
		_ = s.repo.RecordLoginAttempt(ctx, normalized.Identifier, meta.IPAddress, false)
		return AuthResponse{}, invalidCredentialsError()
	}

	if user.Status == UserStatusDisabled {
		return AuthResponse{}, accountDisabledError()
	}

	if !user.IsEmailVerified || user.Status != UserStatusActive {
		_ = s.repo.RecordLoginAttempt(ctx, normalized.Identifier, meta.IPAddress, false)

		resendAvailableAt, expiresAt, err := s.latestVerificationState(ctx, user.ID)
		if err != nil {
			return AuthResponse{}, err
		}

		return AuthResponse{}, emailNotVerifiedError(map[string]any{
			"email":             user.Email,
			"expiresAt":         expiresAt,
			"resendAvailableAt": resendAvailableAt,
			"status":            user.Status,
		})
	}

	if user.PasswordHash == "" || bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(normalized.Password)) != nil {
		_ = s.repo.RecordLoginAttempt(ctx, normalized.Identifier, meta.IPAddress, false)
		return AuthResponse{}, invalidCredentialsError()
	}

	session, err := s.createSession(ctx, user.ID, "local")
	if err != nil {
		return AuthResponse{}, err
	}

	if err := s.repo.RecordLoginAttempt(ctx, normalized.Identifier, meta.IPAddress, true); err != nil {
		s.logger.Warn("login attempt success record failed", slog.Any("error", err))
	}

	if err := s.repo.ClearBioByUserID(ctx, user.ID); err != nil {
		return AuthResponse{}, err
	}

	profile, err := s.repo.ProfileByID(ctx, user.ID)
	if err != nil {
		return AuthResponse{}, err
	}

	return AuthResponse{
		Profile: profile,
		Session: session,
	}, nil
}

func (s *Service) SocialLogin(ctx context.Context, input SocialLoginInput) (AuthResponse, error) {
	normalized, err := normalizeSocialInput(input)
	if err != nil {
		return AuthResponse{}, validationError(err)
	}
	if normalized.Provider == "facebook" && strings.EqualFold(strings.TrimSpace(s.cfg.Environment), "production") {
		return AuthResponse{}, validationError(errors.New("facebook social login is not enabled"))
	}
	if normalized.Provider == "google" && normalized.GoogleIDToken != "" {
		verifiedGoogleIdentity, verifyErr := s.verifyGoogleIDToken(ctx, normalized.GoogleIDToken)
		if verifyErr != nil {
			return AuthResponse{}, validationError(verifyErr)
		}
		if !strings.EqualFold(strings.TrimSpace(verifiedGoogleIdentity.Email), normalized.Email) {
			return AuthResponse{}, validationError(errors.New("google email mismatch"))
		}
		expectedAudience := strings.TrimSpace(s.cfg.GoogleWebClientID)
		if expectedAudience != "" && strings.TrimSpace(verifiedGoogleIdentity.Audience) != expectedAudience {
			return AuthResponse{}, validationError(errors.New("google audience mismatch"))
		}
		normalized.Email = strings.ToLower(strings.TrimSpace(verifiedGoogleIdentity.Email))
	}
	if normalized.Provider == "google" && normalized.GoogleIDToken == "" && strings.EqualFold(strings.TrimSpace(s.cfg.Environment), "production") {
		return AuthResponse{}, validationError(errors.New("google id token is required"))
	}

	var userID string
	if err := s.withTx(ctx, func(tx pgx.Tx) error {
		if err := s.repo.LockEmailTx(ctx, tx, normalized.Email); err != nil {
			return err
		}

		existing, found, err := s.repo.FindUserByEmailTx(ctx, tx, normalized.Email, true)
		if err != nil {
			return err
		}

		var existingRef *userRecord
		if found {
			existingRef = &existing
		}

		user, err := s.repo.UpsertSocialUserTx(ctx, tx, existingRef, normalized)
		if err != nil {
			return err
		}

		userID = user.ID
		return nil
	}); err != nil {
		return AuthResponse{}, err
	}

	session, err := s.createSession(ctx, userID, normalized.Provider)
	if err != nil {
		return AuthResponse{}, err
	}

	if err := s.repo.ClearBioByUserID(ctx, userID); err != nil {
		return AuthResponse{}, err
	}

	profile, err := s.repo.ProfileByID(ctx, userID)
	if err != nil {
		return AuthResponse{}, err
	}

	return AuthResponse{
		Profile: profile,
		Session: session,
	}, nil
}

type googleTokenInfo struct {
	Audience      string `json:"aud"`
	Email         string `json:"email"`
	EmailVerified string `json:"email_verified"`
	ExpiresIn     string `json:"expires_in"`
}

func (s *Service) verifyGoogleIDToken(ctx context.Context, idToken string) (googleTokenInfo, error) {
	trimmedToken := strings.TrimSpace(idToken)
	if trimmedToken == "" {
		return googleTokenInfo{}, errors.New("google id token is required")
	}

	requestURL := "https://oauth2.googleapis.com/tokeninfo?id_token=" + url.QueryEscape(trimmedToken)
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, requestURL, nil)
	if err != nil {
		return googleTokenInfo{}, errors.New("google token request could not be created")
	}

	httpClient := &http.Client{Timeout: 5 * time.Second}
	response, err := httpClient.Do(request)
	if err != nil {
		return googleTokenInfo{}, errors.New("google token verification request failed")
	}
	defer response.Body.Close()

	if response.StatusCode != http.StatusOK {
		return googleTokenInfo{}, fmt.Errorf("google token verification failed with status %d", response.StatusCode)
	}

	var tokenInfo googleTokenInfo
	if err := json.NewDecoder(response.Body).Decode(&tokenInfo); err != nil {
		return googleTokenInfo{}, errors.New("google token verification response is invalid")
	}

	if !strings.EqualFold(strings.TrimSpace(tokenInfo.EmailVerified), "true") {
		return googleTokenInfo{}, errors.New("google email is not verified")
	}
	if strings.TrimSpace(tokenInfo.Email) == "" {
		return googleTokenInfo{}, errors.New("google token missing email")
	}
	expiresInSec, parseErr := strconv.Atoi(strings.TrimSpace(tokenInfo.ExpiresIn))
	if parseErr == nil && expiresInSec <= 0 {
		return googleTokenInfo{}, errors.New("google token expired")
	}

	return tokenInfo, nil
}

func (s *Service) AuthenticateSession(ctx context.Context, token string) (SessionIdentity, error) {
	identity, err := parseSessionToken(s.cfg.JWTSecret, token)
	if err != nil {
		return SessionIdentity{}, err
	}

	resolvedIdentity, err := s.repo.FindSessionIdentity(ctx, identity, hashToken(token))
	if err != nil {
		return SessionIdentity{}, err
	}

	if err := s.repo.TouchSession(ctx, resolvedIdentity.SessionID); err != nil {
		return SessionIdentity{}, err
	}

	return resolvedIdentity, nil
}

func (s *Service) DeleteSession(ctx context.Context, token string) error {
	tokenHash := hashToken(token)
	if tokenHash == "" {
		return nil
	}

	identity, err := parseSessionToken(s.cfg.JWTSecret, token)
	if err != nil {
		return s.repo.DeleteSession(ctx, "", tokenHash)
	}

	return s.repo.DeleteSession(ctx, identity.SessionID, tokenHash)
}

func (s *Service) ProfileByToken(ctx context.Context, token string) (Profile, error) {
	identity, err := s.AuthenticateSession(ctx, token)
	if err != nil {
		return Profile{}, err
	}

	return s.repo.ProfileByID(ctx, identity.UserID)
}

func (s *Service) PublicProfileByToken(
	ctx context.Context,
	token string,
	targetUserID string,
) (PublicProfile, error) {
	identity, err := s.AuthenticateSession(ctx, token)
	if err != nil {
		return PublicProfile{}, err
	}

	targetUserID = strings.TrimSpace(targetUserID)
	if targetUserID == "" {
		return PublicProfile{}, validationError(errors.New("target user id is invalid"))
	}

	return s.repo.PublicProfileByID(ctx, identity.UserID, targetUserID)
}

func (s *Service) PrivacySettingsByToken(ctx context.Context, token string) (PrivacySettings, error) {
	identity, err := s.AuthenticateSession(ctx, token)
	if err != nil {
		return PrivacySettings{}, err
	}

	return s.repo.PrivacySettingsByUserID(ctx, identity.UserID)
}

func (s *Service) PrivacySettingsByUserID(ctx context.Context, userID string) (PrivacySettings, error) {
	return s.repo.PrivacySettingsByUserID(ctx, userID)
}

func (s *Service) MessageNotificationActorLabelByUserID(ctx context.Context, userID string) string {
	normalizedUserID := strings.TrimSpace(userID)
	if normalizedUserID == "" {
		return "MacRadar"
	}

	user, found, err := s.repo.FindUserByID(ctx, normalizedUserID)
	if err != nil || !found {
		return "MacRadar"
	}

	if username := strings.TrimSpace(user.Username); username != "" {
		return username
	}
	if fullName := strings.TrimSpace(user.FullName); fullName != "" {
		return fullName
	}
	return "MacRadar"
}

func (s *Service) MapPreferencesByToken(ctx context.Context, token string) (MapPreferences, error) {
	identity, err := s.AuthenticateSession(ctx, token)
	if err != nil {
		return MapPreferences{}, err
	}

	return s.repo.MapPreferencesByUserID(ctx, identity.UserID)
}

func (s *Service) ProfileAppSettingsByToken(
	ctx context.Context,
	token string,
) (ProfileAppSettings, error) {
	identity, err := s.AuthenticateSession(ctx, token)
	if err != nil {
		return ProfileAppSettings{}, err
	}

	return s.repo.ProfileAppSettingsByUserID(ctx, identity.UserID)
}

func (s *Service) ProfileRequestSummaryByToken(
	ctx context.Context,
	token string,
) (ProfileRequestSummary, error) {
	identity, err := s.AuthenticateSession(ctx, token)
	if err != nil {
		return ProfileRequestSummary{}, err
	}

	return s.repo.ProfileRequestSummaryByUserID(ctx, identity.UserID)
}

func (s *Service) ListProfileNotificationsByToken(
	ctx context.Context,
	token string,
	category string,
	cursor string,
	limit int,
	offset int,
) (ProfileNotificationsResponse, error) {
	identity, err := s.AuthenticateSession(ctx, token)
	if err != nil {
		return ProfileNotificationsResponse{}, err
	}

	return s.repo.ListProfileNotifications(ctx, identity.UserID, category, cursor, limit, offset)
}

func (s *Service) MarkNotificationsReadByToken(
	ctx context.Context,
	token string,
	input MarkNotificationsReadInput,
) (MarkNotificationsReadResponse, error) {
	identity, err := s.AuthenticateSession(ctx, token)
	if err != nil {
		return MarkNotificationsReadResponse{}, err
	}

	return s.repo.MarkNotificationsRead(ctx, identity.UserID, input, time.Now().UTC())
}

func (s *Service) UpdateProfile(ctx context.Context, userID string, input UpdateProfileInput) (Profile, error) {
	normalized, err := normalizeUpdateProfileInput(input)
	if err != nil {
		return Profile{}, validationError(err)
	}

	record, found, err := s.repo.FindUserByID(ctx, userID)
	if err != nil {
		return Profile{}, err
	}
	if !found {
		return Profile{}, unauthorizedError()
	}

	if (normalized.Username != nil || normalized.Email != nil) && record.AuthProvider != "local" {
		return Profile{}, validationError(errors.New("username/email updates are only available for local accounts"))
	}

	if normalized.Username != nil && strings.EqualFold(strings.TrimSpace(*normalized.Username), strings.TrimSpace(record.Username)) {
		normalized.Username = nil
	}
	if normalized.Email != nil && strings.EqualFold(strings.TrimSpace(*normalized.Email), strings.TrimSpace(record.Email)) {
		normalized.Email = nil
	}

	if !hasAnyUpdateProfileFields(normalized) {
		return s.repo.ProfileByID(ctx, userID)
	}

	return s.repo.UpdateProfile(ctx, userID, normalized)
}

func hasAnyUpdateProfileFields(input UpdateProfileInput) bool {
	return input.AvatarURL != nil ||
		input.Bio != nil ||
		input.BirthYear != nil ||
		input.City != nil ||
		input.Email != nil ||
		input.FavoriteCar != nil ||
		input.FullName != nil ||
		input.HeroTagline != nil ||
		input.Phone != nil ||
		input.PhoneDialCode != nil ||
		input.Username != nil
}

func (s *Service) UpdatePrivacySettings(
	ctx context.Context,
	userID string,
	input UpdatePrivacySettingsInput,
) (PrivacySettings, error) {
	normalized, err := normalizeUpdatePrivacySettingsInput(input)
	if err != nil {
		return PrivacySettings{}, validationError(err)
	}

	return s.repo.UpdatePrivacySettings(ctx, userID, normalized)
}

func (s *Service) UpdateMapPreferences(
	ctx context.Context,
	userID string,
	input UpdateMapPreferencesInput,
) (MapPreferences, error) {
	normalized, err := normalizeUpdateMapPreferencesInput(input)
	if err != nil {
		return MapPreferences{}, validationError(err)
	}

	return s.repo.UpdateMapPreferences(ctx, userID, normalized)
}

func (s *Service) UpdateProfileAppSettings(
	ctx context.Context,
	userID string,
	input UpdateProfileAppSettingsInput,
) (ProfileAppSettings, error) {
	normalized, err := normalizeUpdateProfileAppSettingsInput(input)
	if err != nil {
		return ProfileAppSettings{}, validationError(err)
	}

	return s.repo.UpdateProfileAppSettings(ctx, userID, normalized)
}

func (s *Service) ListFollowRequestsByToken(
	ctx context.Context,
	token string,
) (FollowRequestListResponse, error) {
	identity, err := s.AuthenticateSession(ctx, token)
	if err != nil {
		return FollowRequestListResponse{}, err
	}

	return s.repo.ListFollowRequests(ctx, identity.UserID)
}

func (s *Service) ResolveFollowRequest(
	ctx context.Context,
	userID string,
	requesterID string,
	accept bool,
) (FollowRequestDecisionResponse, error) {
	requesterID = strings.TrimSpace(requesterID)
	if requesterID == "" || requesterID == userID {
		return FollowRequestDecisionResponse{}, validationError(errors.New("requester id is invalid"))
	}

	return s.repo.ResolveFollowRequest(ctx, userID, requesterID, accept)
}

func (s *Service) ListBlockedUsersByToken(
	ctx context.Context,
	token string,
) (BlockedUserListResponse, error) {
	identity, err := s.AuthenticateSession(ctx, token)
	if err != nil {
		return BlockedUserListResponse{}, err
	}

	return s.repo.ListBlockedUsers(ctx, identity.UserID)
}

func (s *Service) BlockUser(
	ctx context.Context,
	userID string,
	blockedUserID string,
) (BlockedUserOperationResponse, error) {
	blockedUserID = strings.TrimSpace(blockedUserID)
	if blockedUserID == "" || blockedUserID == userID {
		return BlockedUserOperationResponse{}, validationError(errors.New("blocked user id is invalid"))
	}

	return s.repo.BlockUser(ctx, userID, blockedUserID)
}

func (s *Service) UnblockUser(
	ctx context.Context,
	userID string,
	blockedUserID string,
) (BlockedUserOperationResponse, error) {
	blockedUserID = strings.TrimSpace(blockedUserID)
	if blockedUserID == "" || blockedUserID == userID {
		return BlockedUserOperationResponse{}, validationError(errors.New("blocked user id is invalid"))
	}

	return s.repo.UnblockUser(ctx, userID, blockedUserID)
}

func (s *Service) ReportUserByToken(
	ctx context.Context,
	token string,
	reportedUserID string,
	reason string,
) (UserReportResponse, error) {
	identity, err := s.AuthenticateSession(ctx, token)
	if err != nil {
		return UserReportResponse{}, err
	}

	reportedUserID = strings.TrimSpace(reportedUserID)
	if reportedUserID == "" {
		return UserReportResponse{}, validationError(errors.New("reported user id is invalid"))
	}

	return s.repo.ReportUser(ctx, identity.UserID, reportedUserID, reason)
}

func (s *Service) ChangePassword(ctx context.Context, userID string, sessionID string, input PasswordChangeInput) (PasswordOperationResponse, error) {
	normalized, err := normalizePasswordChangeInput(input)
	if err != nil {
		return PasswordOperationResponse{}, validationError(err)
	}

	user, found, err := s.repo.FindUserByID(ctx, userID)
	if err != nil {
		return PasswordOperationResponse{}, err
	}
	if !found {
		return PasswordOperationResponse{}, unauthorizedError()
	}
	if user.Status != UserStatusActive {
		return PasswordOperationResponse{}, accountDisabledError()
	}
	if strings.TrimSpace(user.PasswordHash) == "" {
		return PasswordOperationResponse{}, passwordRecoveryOnlyError()
	}
	if bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(normalized.CurrentPassword)) != nil {
		return PasswordOperationResponse{}, currentPasswordInvalidError()
	}

	passwordHash, err := bcrypt.GenerateFromPassword([]byte(normalized.NewPassword), s.cfg.PasswordHashCost)
	if err != nil {
		return PasswordOperationResponse{}, err
	}

	if err := s.withTx(ctx, func(tx pgx.Tx) error {
		if err := s.repo.UpdatePasswordTx(ctx, tx, user.ID, string(passwordHash)); err != nil {
			return err
		}
		if err := s.repo.DeleteSessionsByUserTx(ctx, tx, user.ID, sessionID); err != nil {
			return err
		}
		return nil
	}); err != nil {
		return PasswordOperationResponse{}, err
	}

	return PasswordOperationResponse{
		Message: "Şifreniz güncellendi. Diğer oturumlar güvenlik için kapatıldı.",
	}, nil
}

func (s *Service) DeleteAccount(ctx context.Context, userID string) (DeleteAccountResponse, error) {
	normalizedUserID := strings.TrimSpace(userID)
	if normalizedUserID == "" {
		return DeleteAccountResponse{}, unauthorizedError()
	}

	user, found, err := s.repo.FindUserByID(ctx, normalizedUserID)
	if err != nil {
		return DeleteAccountResponse{}, err
	}
	if !found {
		return DeleteAccountResponse{}, unauthorizedError()
	}

	if err := s.withTx(ctx, func(tx pgx.Tx) error {
		if err := s.repo.DeleteSessionsByUserTx(ctx, tx, user.ID, ""); err != nil {
			return err
		}
		if err := s.repo.DeleteLoginAttemptsByEmailTx(ctx, tx, user.Email); err != nil {
			return err
		}
		if err := s.repo.DeleteUserByIDTx(ctx, tx, user.ID); err != nil {
			return err
		}
		return nil
	}); err != nil {
		return DeleteAccountResponse{}, err
	}

	return DeleteAccountResponse{
		Deleted: true,
		Message: "Hesabiniz kalici olarak silindi.",
		UserID:  user.ID,
	}, nil
}

func (s *Service) RequestDeleteAccountCode(ctx context.Context, userID string) (PasswordResetChallengeResponse, error) {
	normalizedUserID := strings.TrimSpace(userID)
	if normalizedUserID == "" {
		return PasswordResetChallengeResponse{}, unauthorizedError()
	}

	user, found, err := s.repo.FindUserByID(ctx, normalizedUserID)
	if err != nil {
		return PasswordResetChallengeResponse{}, err
	}
	if !found {
		return PasswordResetChallengeResponse{}, unauthorizedError()
	}
	if user.Status != UserStatusActive || !user.IsEmailVerified {
		return PasswordResetChallengeResponse{}, passwordResetNotAllowedError()
	}
	email, err := normalizeEmail(user.Email)
	if err != nil {
		return PasswordResetChallengeResponse{}, validationError(err)
	}

	now := time.Now().UTC()
	rawCode, _, err := newNumericCode(6)
	if err != nil {
		return PasswordResetChallengeResponse{}, err
	}
	codeHash := hashPasswordResetCode(email, rawCode)
	expiresAt := now.Add(s.cfg.PasswordResetCodeTTL)

	response := PasswordResetChallengeResponse{
		Delivery:          "email",
		DebugCode:         s.debugPasswordResetCode(rawCode),
		Email:             email,
		ExpiresAt:         expiresAt,
		Message:           "Hesap silme onay kodu email adresinize gonderildi.",
		ResendAvailableAt: now.Add(s.cfg.PasswordResetResendCooldown),
	}

	if err := s.withTx(ctx, func(tx pgx.Tx) error {
		if err := s.repo.LockEmailTx(ctx, tx, email); err != nil {
			return err
		}
		if err := s.ensurePasswordResetCanBeSentTx(ctx, tx, user.ID, now); err != nil {
			return err
		}
		if err := s.repo.InvalidateUnusedPasswordResetCodesTx(ctx, tx, user.ID); err != nil {
			return err
		}
		if err := s.repo.InsertPasswordResetCodeTx(ctx, tx, user.ID, codeHash, expiresAt); err != nil {
			return err
		}
		return nil
	}); err != nil {
		return PasswordResetChallengeResponse{}, err
	}

	if err := s.mailer.SendPasswordResetCodeEmail(ctx, mail.PasswordResetCodeEmailInput{
		Code:      rawCode,
		ExpiresAt: expiresAt,
		ToAddress: email,
		ToName:    user.FullName,
	}); err != nil {
		s.logger.Error("delete account code send failed", slog.Any("error", err), slog.String("email", email))
		if s.cfg.AuthDebugPreview {
			response.Message = "Email gonderilemedi. Debug kod ile devam edebilirsiniz."
			return response, nil
		}
		_ = s.repo.DeletePasswordResetCode(ctx, user.ID, codeHash)
		return PasswordResetChallengeResponse{}, passwordResetEmailFailedError()
	}

	return response, nil
}

func (s *Service) ConfirmDeleteAccount(ctx context.Context, userID, code string) (DeleteAccountResponse, error) {
	normalizedUserID := strings.TrimSpace(userID)
	normalizedCode := strings.TrimSpace(code)
	if normalizedUserID == "" {
		return DeleteAccountResponse{}, unauthorizedError()
	}
	if len(normalizedCode) != 6 {
		return DeleteAccountResponse{}, invalidPasswordResetCodeError(-1)
	}

	user, found, err := s.repo.FindUserByID(ctx, normalizedUserID)
	if err != nil {
		return DeleteAccountResponse{}, err
	}
	if !found {
		return DeleteAccountResponse{}, unauthorizedError()
	}
	email, err := normalizeEmail(user.Email)
	if err != nil {
		return DeleteAccountResponse{}, validationError(err)
	}
	now := time.Now().UTC()

	if err := s.withTx(ctx, func(tx pgx.Tx) error {
		if err := s.repo.LockEmailTx(ctx, tx, email); err != nil {
			return err
		}

		resetCode, found, err := s.repo.FindActivePasswordResetCodeTx(ctx, tx, user.ID)
		if err != nil {
			return err
		}
		if !found {
			return invalidPasswordResetCodeError(-1)
		}

		if now.After(resetCode.ExpiresAt) {
			if err := s.repo.MarkPasswordResetCodeUsedTx(ctx, tx, resetCode.ID, now); err != nil {
				return err
			}
			return passwordResetExpiredError()
		}

		if resetCode.AttemptCount >= s.cfg.PasswordResetMaxAttempts {
			if err := s.repo.MarkPasswordResetCodeUsedTx(ctx, tx, resetCode.ID, now); err != nil {
				return err
			}
			return passwordResetLockedError()
		}

		if !matchesPasswordResetCode(email, normalizedCode, resetCode.CodeHash) {
			if err := s.repo.IncrementPasswordResetCodeAttemptTx(ctx, tx, resetCode.ID, now); err != nil {
				return err
			}
			nextAttempts := resetCode.AttemptCount + 1
			if nextAttempts >= s.cfg.PasswordResetMaxAttempts {
				if err := s.repo.MarkPasswordResetCodeUsedTx(ctx, tx, resetCode.ID, now); err != nil {
					return err
				}
				return passwordResetLockedError()
			}
			return invalidPasswordResetCodeError(s.cfg.PasswordResetMaxAttempts - nextAttempts)
		}

		if err := s.repo.MarkPasswordResetCodeUsedTx(ctx, tx, resetCode.ID, now); err != nil {
			return err
		}
		if err := s.repo.DeleteSessionsByUserTx(ctx, tx, user.ID, ""); err != nil {
			return err
		}
		if err := s.repo.DeleteLoginAttemptsByEmailTx(ctx, tx, user.Email); err != nil {
			return err
		}
		if err := s.repo.DeleteUserByIDTx(ctx, tx, user.ID); err != nil {
			return err
		}
		return nil
	}); err != nil {
		return DeleteAccountResponse{}, err
	}

	return DeleteAccountResponse{
		Deleted: true,
		Message: "Hesabiniz kalici olarak silindi.",
		UserID:  user.ID,
	}, nil
}

func (s *Service) withTx(ctx context.Context, fn func(tx pgx.Tx) error) error {
	tx, err := s.repo.BeginTx(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	if err := fn(tx); err != nil {
		return err
	}

	return tx.Commit(ctx)
}

func (s *Service) ensureVerificationCanBeSentTx(ctx context.Context, tx pgx.Tx, userID string, now time.Time) error {
	count, oldest, latest, err := s.repo.VerificationSendWindowStateTx(ctx, tx, userID, now.Add(-s.cfg.VerificationSendWindow))
	if err != nil {
		return err
	}

	if latest != nil {
		nextAllowed := latest.Add(s.cfg.VerificationResendCooldown)
		if nextAllowed.After(now) {
			return resendRateLimitedError(nextAllowed)
		}
	}

	if oldest != nil && count >= s.cfg.VerificationMaxSendsWindow {
		retryAt := oldest.Add(s.cfg.VerificationSendWindow)
		if retryAt.After(now) {
			return resendRateLimitedError(retryAt)
		}
	}

	return nil
}

func (s *Service) ensurePasswordResetCanBeSentTx(ctx context.Context, tx pgx.Tx, userID string, now time.Time) error {
	count, oldest, latest, err := s.repo.PasswordResetSendWindowStateTx(ctx, tx, userID, now.Add(-s.cfg.PasswordResetSendWindow))
	if err != nil {
		return err
	}

	if latest != nil {
		nextAllowed := latest.Add(s.cfg.PasswordResetResendCooldown)
		if nextAllowed.After(now) {
			return passwordResetRateLimitedError(nextAllowed)
		}
	}

	if oldest != nil && count >= s.cfg.PasswordResetMaxSendsWindow {
		retryAt := oldest.Add(s.cfg.PasswordResetSendWindow)
		if retryAt.After(now) {
			return passwordResetRateLimitedError(retryAt)
		}
	}

	return nil
}

func (s *Service) enforceLoginRateLimit(ctx context.Context, email string, ipAddress string) error {
	windowStart := time.Now().UTC().Add(-s.cfg.LoginAttemptWindow)
	count, oldest, err := s.repo.FailedLoginAttemptState(ctx, email, ipAddress, windowStart)
	if err != nil {
		return err
	}

	if oldest != nil && count >= s.cfg.LoginMaxAttempts {
		retryAt := oldest.Add(s.cfg.LoginAttemptWindow)
		if retryAt.After(time.Now().UTC()) {
			return tooManyLoginAttemptsError(retryAt)
		}
	}

	return nil
}

func (s *Service) latestVerificationState(ctx context.Context, userID string) (time.Time, time.Time, error) {
	tx, err := s.repo.BeginTx(ctx)
	if err != nil {
		return time.Now().UTC(), time.Now().UTC(), err
	}
	defer tx.Rollback(ctx)

	createdAt, expiresAt, err := s.repo.LatestVerificationTokenTx(ctx, tx, userID)
	if err != nil {
		return time.Now().UTC(), time.Now().UTC(), err
	}

	now := time.Now().UTC()
	if createdAt == nil || expiresAt == nil {
		return now, now.Add(s.cfg.VerificationTokenTTL), nil
	}

	return createdAt.Add(s.cfg.VerificationResendCooldown), *expiresAt, nil
}

func (s *Service) createSession(ctx context.Context, userID string, provider string) (Session, error) {
	sessionID := newID("session")
	expiresAt := time.Now().UTC().Add(sessionTTL)
	token, tokenHash, err := newSessionToken(s.cfg.JWTSecret, sessionID, userID, provider, expiresAt)
	if err != nil {
		return Session{}, err
	}

	if err := s.withTx(ctx, func(tx pgx.Tx) error {
		return s.repo.InsertSessionTx(ctx, tx, sessionID, userID, provider, tokenHash, expiresAt)
	}); err != nil {
		return Session{}, err
	}

	return Session{
		ExpiresAt: expiresAt,
		Token:     token,
	}, nil
}

func (s *Service) VerificationPageTitle(result VerifyEmailResult) string {
	switch result.Status {
	case VerifyEmailStatusVerified:
		return "Email dogrulandi"
	case VerifyEmailStatusExpired:
		return "Kod suresi doldu"
	case VerifyEmailStatusAlreadyUsed:
		return "Kod kullanildi"
	case VerifyEmailStatusAlreadyVerified:
		return "Email zaten dogrulanmis"
	default:
		return "Dogrulama kodu gecersiz"
	}
}

func (s *Service) debugPasswordResetCode(rawCode string) string {
	if !s.cfg.AuthDebugPreview {
		return ""
	}

	return strings.TrimSpace(rawCode)
}

func (s *Service) debugVerificationCode(rawCode string) string {
	if !s.cfg.AuthDebugPreview {
		return ""
	}

	return strings.TrimSpace(rawCode)
}

func (s *Service) IsAppError(err error) (*AppError, bool) {
	var appErr *AppError
	if errors.As(err, &appErr) {
		return appErr, true
	}
	return nil, false
}

func normalizePasswordHashCost(value int) int {
	if value < minPasswordHashCost {
		return defaultPasswordHashCost
	}
	if value > maxPasswordHashCost {
		return maxPasswordHashCost
	}

	return value
}

func (s *Service) VerificationResultForError(_ error, fallback VerifyEmailResult) VerifyEmailResult {
	if fallback.Status != "" {
		return fallback
	}

	if strings.TrimSpace(fallback.Message) == "" {
		fallback.Message = "Dogrulama kodu gecersiz."
	}
	if fallback.Status == "" {
		fallback.Status = VerifyEmailStatusInvalid
	}
	return fallback
}
