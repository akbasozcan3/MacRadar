package account

import (
	"errors"
	"net/http"
	"strings"
	"time"
)

var (
	ErrEmailAlreadyVerified    = errors.New("email already verified")
	ErrEmailInUse              = errors.New("email is already in use")
	ErrEmailNotVerified        = errors.New("email is not verified")
	ErrBlockedUserNotFound     = errors.New("blocked user not found")
	ErrProfileNotFound         = errors.New("profile not found")
	ErrFollowRequestNotFound   = errors.New("follow request not found")
	ErrCurrentPasswordInvalid  = errors.New("current password is invalid")
	ErrInvalidCredentials      = errors.New("invalid email or password")
	ErrPasswordResetNotAllowed = errors.New("password reset not allowed for this account")
	ErrInvalidResetCode        = errors.New("invalid password reset code")
	ErrInvalidVerification     = errors.New("invalid verification code")
	ErrPasswordRecoveryOnly    = errors.New("password change requires recovery flow")
	ErrPasswordResetExpired    = errors.New("password reset code expired")
	ErrPasswordResetLocked     = errors.New("password reset code locked")
	ErrPasswordResetRateLimit  = errors.New("password reset rate limited")
	ErrResendRateLimited       = errors.New("verification resend rate limited")
	ErrTooManyLoginAttempts    = errors.New("too many login attempts")
	ErrUnauthorized            = errors.New("authorization required")
	ErrUsernameTaken           = errors.New("username is already taken")
	ErrVerificationExpired     = errors.New("verification code expired")
	ErrVerificationLocked      = errors.New("verification code locked")
	ErrVerificationNotPending  = errors.New("verification not pending")
	ErrVerificationUsed        = errors.New("verification code already used")
)

type AppError struct {
	Code    string         `json:"code"`
	Details map[string]any `json:"details,omitempty"`
	Err     error          `json:"-"`
	Message string         `json:"message"`
	Status  int            `json:"-"`
}

func (e *AppError) Error() string {
	if e.Message != "" {
		return e.Message
	}
	if e.Err != nil {
		return e.Err.Error()
	}
	return "request failed"
}

func (e *AppError) Unwrap() error {
	return e.Err
}

func newAppError(status int, code string, message string, err error, details map[string]any) error {
	return &AppError{
		Code:    code,
		Details: details,
		Err:     err,
		Message: message,
		Status:  status,
	}
}

func validationError(err error) error {
	var domainErr *emailDomainSuggestionError
	if errors.As(err, &domainErr) {
		return invalidEmailDomainError(domainErr)
	}

	return newAppError(http.StatusBadRequest, "validation_error", err.Error(), err, nil)
}

func unauthorizedError() error {
	return newAppError(http.StatusUnauthorized, "unauthorized", "Oturum dogrulanamadi.", ErrUnauthorized, nil)
}

func invalidCredentialsError() error {
	return newAppError(http.StatusUnauthorized, "invalid_credentials", "Email, kullanici adi veya sifre hatali.", ErrInvalidCredentials, nil)
}

func currentPasswordInvalidError() error {
	return newAppError(http.StatusUnauthorized, "current_password_invalid", "Mevcut sifre dogrulanamadi.", ErrCurrentPasswordInvalid, nil)
}

func emailInUseError() error {
	return newAppError(http.StatusConflict, "email_in_use", "Bu email ile yeni kayit tamamlanamadi. Hesap size aitse giris yapin veya sifre yenileme kullanin.", ErrEmailInUse, map[string]any{
		"nextStep": "login_or_reset",
	})
}

func usernameTakenError() error {
	return newAppError(http.StatusConflict, "username_taken", "Bu kullanici adi alinmis.", ErrUsernameTaken, map[string]any{
		"field": "username",
	})
}

func emailAlreadyVerifiedError() error {
	return newAppError(http.StatusConflict, "email_already_verified", "Bu email adresi zaten dogrulanmis.", ErrEmailAlreadyVerified, nil)
}

func verificationNotPendingError() error {
	return newAppError(http.StatusNotFound, "verification_not_pending", "Bu email adresi icin bekleyen bir dogrulama kaydi bulunamadi.", ErrVerificationNotPending, nil)
}

func emailNotVerifiedError(details map[string]any) error {
	return newAppError(http.StatusForbidden, "email_not_verified", "Email adresinizi dogrulamadan giris yapamazsiniz.", ErrEmailNotVerified, details)
}

func invalidVerificationError() error {
	return newAppError(http.StatusBadRequest, "invalid_verification_code", "Dogrulama kodu gecersiz.", ErrInvalidVerification, nil)
}

func verificationExpiredError(details map[string]any) error {
	return newAppError(http.StatusGone, "verification_code_expired", "Dogrulama kodunun suresi dolmus. Yeni kod isteyin.", ErrVerificationExpired, details)
}

func verificationUsedError() error {
	return newAppError(http.StatusConflict, "verification_code_used", "Bu dogrulama kodu daha once kullanilmis.", ErrVerificationUsed, nil)
}

func verificationLockedError() error {
	return newAppError(http.StatusTooManyRequests, "verification_code_locked", "Bu kod icin cok fazla hatali deneme yapildi. Yeni kod isteyin.", ErrVerificationLocked, nil)
}

func resendRateLimitedError(retryAt time.Time) error {
	return newAppError(http.StatusTooManyRequests, "verification_resend_rate_limited", "Cok sik dogrulama emaili istiyorsunuz. Lutfen biraz bekleyin.", ErrResendRateLimited, map[string]any{
		"resendAvailableAt": retryAt.UTC(),
	})
}

func passwordResetRateLimitedError(retryAt time.Time) error {
	return newAppError(http.StatusTooManyRequests, "password_reset_rate_limited", "Cok sik sifre yenileme kodu istiyorsunuz. Lutfen biraz bekleyin.", ErrPasswordResetRateLimit, map[string]any{
		"resendAvailableAt": retryAt.UTC(),
	})
}

func invalidPasswordResetCodeError(remainingAttempts int) error {
	details := map[string]any{}
	if remainingAttempts >= 0 {
		details["remainingAttempts"] = remainingAttempts
	}

	return newAppError(http.StatusUnauthorized, "invalid_password_reset_code", "Guvenlik kodu gecersiz.", ErrInvalidResetCode, details)
}

func passwordResetExpiredError() error {
	return newAppError(http.StatusGone, "password_reset_code_expired", "Guvenlik kodunun suresi dolmus. Yeni kod isteyin.", ErrPasswordResetExpired, nil)
}

func passwordResetLockedError() error {
	return newAppError(http.StatusTooManyRequests, "password_reset_code_locked", "Bu kod icin cok fazla hatali deneme yapildi. Yeni kod isteyin.", ErrPasswordResetLocked, nil)
}

func passwordResetEmailFailedError() error {
	return newAppError(http.StatusServiceUnavailable, "password_reset_email_failed", "Sifre yenileme kodu su anda gonderilemiyor. Lutfen tekrar deneyin.", nil, nil)
}

func passwordResetNotAllowedError() error {
	return newAppError(http.StatusNotFound, "password_reset_not_allowed", "Bu email ile sifre sifirlama yapilamaz. Kayitli ve aktif bir yerel hesap kullandiginizdan emin olun.", ErrPasswordResetNotAllowed, nil)
}

func passwordResetNotAllowedDiagnosticError(reason string) error {
	normalizedReason := strings.TrimSpace(reason)
	details := map[string]any{}
	if normalizedReason != "" {
		details["reason"] = normalizedReason
	}

	message := "Bu email ile sifre sifirlama yapilamaz. Kayitli ve aktif bir yerel hesap kullandiginizdan emin olun."
	switch normalizedReason {
	case "not_found":
		message = "Sifre sifirlama uygun degil: bu email icin kayitli hesap bulunamadi."
	case "inactive_or_unverified":
		message = "Sifre sifirlama uygun degil: hesap aktif ve email dogrulanmis olmali."
	case "empty_email":
		message = "Sifre sifirlama uygun degil: hesap email bilgisi eksik."
	case "no_password":
		message = "Sifre sifirlama uygun degil: bu hesapta aktif sifre yok."
	case "not_local":
		message = "Sifre sifirlama uygun degil: bu hesap sosyal giris ile bagli."
	}

	return newAppError(http.StatusNotFound, "password_reset_not_allowed", message, ErrPasswordResetNotAllowed, details)
}

func passwordRecoveryOnlyError() error {
	return newAppError(http.StatusBadRequest, "password_recovery_required", "Bu hesapta aktif bir sifre bulunmuyor. Email kodu ile sifre olusturun.", ErrPasswordRecoveryOnly, nil)
}

func tooManyLoginAttemptsError(retryAt time.Time) error {
	return newAppError(http.StatusTooManyRequests, "too_many_login_attempts", "Cok fazla basarisiz giris denemesi yaptiniz. Lutfen biraz sonra tekrar deneyin.", ErrTooManyLoginAttempts, map[string]any{
		"retryAt": retryAt.UTC(),
	})
}

func verificationEmailFailedError() error {
	return newAppError(http.StatusServiceUnavailable, "verification_email_failed", "Dogrulama kodu su anda email ile gonderilemiyor. Lutfen tekrar deneyin.", nil, nil)
}

func accountDisabledError() error {
	return newAppError(http.StatusForbidden, "account_inactive", "Bu hesap su anda aktif degil.", nil, nil)
}

func followRequestNotFoundError() error {
	return newAppError(http.StatusNotFound, "follow_request_not_found", "Takip istegi bulunamadi.", ErrFollowRequestNotFound, nil)
}

func blockedUserNotFoundError() error {
	return newAppError(http.StatusNotFound, "blocked_user_not_found", "Engellenecek kullanici bulunamadi.", ErrBlockedUserNotFound, nil)
}

func profileNotFoundError() error {
	return newAppError(http.StatusNotFound, "profile_not_found", "Kullanici profili bulunamadi.", ErrProfileNotFound, nil)
}

func invalidEmailDomainError(err *emailDomainSuggestionError) error {
	details := map[string]any{
		"domain": err.domain,
		"field":  "email",
	}

	if err.suggestedDomain != "" {
		details["suggestedDomain"] = err.suggestedDomain
	}

	suggestedEmail := err.SuggestedAddress()
	if suggestedEmail != "" {
		details["suggestedEmail"] = suggestedEmail
	}

	return newAppError(
		http.StatusBadRequest,
		"invalid_email_domain",
		"Email alan adi gecersiz gorunuyor. Lutfen email adresinizi kontrol edin.",
		err,
		details,
	)
}
