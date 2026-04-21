package account

import "testing"

func TestHashPasswordResetCodeIncludesEmail(t *testing.T) {
	first := hashPasswordResetCode("first@macradar.app", "123456")
	second := hashPasswordResetCode("second@macradar.app", "123456")

	if first == second {
		t.Fatal("password reset code hash should change when email changes")
	}
}

func TestMatchesPasswordResetCodeSupportsLegacyHashes(t *testing.T) {
	email := "driver@macradar.app"
	code := "123456"

	if !matchesPasswordResetCode(email, code, hashPasswordResetCode(email, code)) {
		t.Fatal("expected salted password reset hash to match")
	}

	if !matchesPasswordResetCode(email, code, hashToken(code)) {
		t.Fatal("expected legacy password reset hash to match")
	}
}
