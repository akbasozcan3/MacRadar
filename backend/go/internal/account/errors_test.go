package account

import "testing"

func TestEmailInUseErrorProvidesRecoveryHint(t *testing.T) {
	appErr, ok := emailInUseError().(*AppError)
	if !ok {
		t.Fatal("expected emailInUseError to return *AppError")
	}

	if appErr.Code != "email_in_use" {
		t.Fatalf("code = %q, want %q", appErr.Code, "email_in_use")
	}
	if appErr.Message == "Bu email adresi zaten kullaniliyor." {
		t.Fatal("expected email_in_use message to be action-oriented")
	}
	if appErr.Details["nextStep"] != "login_or_reset" {
		t.Fatalf("details[nextStep] = %v, want %q", appErr.Details["nextStep"], "login_or_reset")
	}
}
