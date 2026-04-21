package account

import (
	"errors"
	"testing"
)

func TestNormalizePasswordValueAcceptsTenToTwelveCharacters(t *testing.T) {
	validPasswords := []string{
		"1234567890",
		"123456789012",
	}

	for _, password := range validPasswords {
		if _, err := normalizePasswordValue(password, "password"); err != nil {
			t.Fatalf("expected password %q to be valid, got error: %v", password, err)
		}
	}
}

func TestNormalizePasswordValueRejectsOutOfRangeLengths(t *testing.T) {
	invalidPasswords := []string{
		"123456789",
		"1234567890123",
	}

	for _, password := range invalidPasswords {
		if _, err := normalizePasswordValue(password, "password"); err == nil {
			t.Fatalf("expected password %q to be rejected", password)
		}
	}
}

func TestNormalizePasswordValueRejectsEmoji(t *testing.T) {
	if _, err := normalizePasswordValue("123456789\U0001F642", "password"); err == nil {
		t.Fatal("expected password with emoji to be rejected")
	}
}

func TestNormalizeUsernameValueCanonicalizesInput(t *testing.T) {
	testCases := []struct {
		input string
		want  string
	}{
		{input: "Caglar Ozturk", want: "caglarozturk"},
		{input: "\u00C7a\u011Flar_\u00D6zt\u00FCrk", want: "caglar_ozturk"},
		{input: "__driver", want: "__driver"},
	}

	for _, testCase := range testCases {
		got, err := normalizeUsernameValue(testCase.input)
		if err != nil {
			t.Fatalf("expected username %q to normalize, got error: %v", testCase.input, err)
		}
		if got != testCase.want {
			t.Fatalf("expected username %q to normalize to %q, got %q", testCase.input, testCase.want, got)
		}
	}
}

func TestNormalizeUsernameValueRejectsEmoji(t *testing.T) {
	if _, err := normalizeUsernameValue("driver\U0001F697"); err == nil {
		t.Fatal("expected emoji username to be rejected")
	}
}

func TestNormalizeUsernameValueRejectsUnsupportedCharacters(t *testing.T) {
	if _, err := normalizeUsernameValue("driver.mode"); err == nil {
		t.Fatal("expected dotted username to be rejected")
	}
}

func TestNormalizeUsernameValueRejectsTooShortCanonicalValue(t *testing.T) {
	if _, err := normalizeUsernameValue("__"); err == nil {
		t.Fatal("expected short canonical username to be rejected")
	}
}

func TestNormalizeRegisterInputRejectsEmojiInFullName(t *testing.T) {
	_, err := normalizeRegisterInput(RegisterInput{
		City:        "Istanbul",
		Email:       "driver@macradar.app",
		FavoriteCar: "M3",
		FullName:    "Local \U0001F642 Driver",
		Password:    "1234567890",
		Username:    "localdriver",
	})
	if err == nil {
		t.Fatal("expected fullName with emoji to be rejected")
	}
}

func TestNormalizeUpdateProfileInputRejectsEmoji(t *testing.T) {
	fullName := "Local Driver"

	_, err := normalizeUpdateProfileInput(UpdateProfileInput{
		AvatarURL:   ptrString("https://example.com/avatar.png"),
		Bio:         ptrString("Route hunter \U0001F697"),
		BirthYear:   ptrInt(1998),
		City:        ptrString("Istanbul"),
		FavoriteCar: ptrString("M4"),
		FullName:    &fullName,
		HeroTagline: ptrString("Compact profile"),
	})
	if err == nil {
		t.Fatal("expected profile bio with emoji to be rejected")
	}
}

func TestNormalizeUpdateProfileInputRejectsInvalidBirthYear(t *testing.T) {
	fullName := "Local Driver"

	_, err := normalizeUpdateProfileInput(UpdateProfileInput{
		AvatarURL:   ptrString("https://example.com/avatar.png"),
		Bio:         ptrString("Route hunter"),
		BirthYear:   ptrInt(1800),
		City:        ptrString("Istanbul"),
		FavoriteCar: ptrString("M4"),
		FullName:    &fullName,
		HeroTagline: ptrString("Compact profile"),
	})
	if err == nil {
		t.Fatal("expected invalid birthYear to be rejected")
	}
}

func TestNormalizeUpdateProfileInputRequiresAtLeastOneField(t *testing.T) {
	_, err := normalizeUpdateProfileInput(UpdateProfileInput{})
	if err == nil {
		t.Fatal("expected empty profile payload to be rejected")
	}
}

func TestNormalizeUpdateProfileInputSupportsPartialPayload(t *testing.T) {
	city := "Istanbul"

	normalized, err := normalizeUpdateProfileInput(UpdateProfileInput{
		City: &city,
	})
	if err != nil {
		t.Fatalf("expected profile partial payload to normalize, got error: %v", err)
	}

	if normalized.City == nil || *normalized.City != city {
		t.Fatal("expected city to be normalized")
	}
}

func TestNormalizeUpdateProfileInputAcceptsPhoneDigits(t *testing.T) {
	phone := "532 123 45 67"
	dial := "90"

	normalized, err := normalizeUpdateProfileInput(UpdateProfileInput{
		Phone:         &phone,
		PhoneDialCode: &dial,
	})
	if err != nil {
		t.Fatalf("expected phone to normalize, got error: %v", err)
	}
	if normalized.Phone == nil || *normalized.Phone != "5321234567" {
		t.Fatalf("expected digits-only phone, got %#v", normalized.Phone)
	}
	if normalized.PhoneDialCode == nil || *normalized.PhoneDialCode != "90" {
		t.Fatalf("expected dial 90, got %#v", normalized.PhoneDialCode)
	}
}

func TestNormalizeUpdateProfileInputClearsPhoneToEmpty(t *testing.T) {
	phone := "   "

	normalized, err := normalizeUpdateProfileInput(UpdateProfileInput{
		Phone: &phone,
	})
	if err != nil {
		t.Fatalf("expected empty phone, got error: %v", err)
	}
	if normalized.Phone == nil || *normalized.Phone != "" {
		t.Fatalf("expected cleared phone, got %#v", normalized.Phone)
	}
	if normalized.PhoneDialCode == nil || *normalized.PhoneDialCode != "" {
		t.Fatalf("expected cleared dial, got %#v", normalized.PhoneDialCode)
	}
}

func TestNormalizeUpdateProfileInputRejectsInvalidPhone(t *testing.T) {
	phone := "4321234567"

	_, err := normalizeUpdateProfileInput(UpdateProfileInput{
		Phone: &phone,
	})
	if err == nil {
		t.Fatal("expected invalid phone to be rejected")
	}
}

func TestNormalizeUpdateProfileInputAcceptsUSDial(t *testing.T) {
	phone := "4155550123"
	dial := "1"

	normalized, err := normalizeUpdateProfileInput(UpdateProfileInput{
		Phone:         &phone,
		PhoneDialCode: &dial,
	})
	if err != nil {
		t.Fatalf("expected US phone, got error: %v", err)
	}
	if normalized.Phone == nil || *normalized.Phone != "4155550123" {
		t.Fatalf("unexpected national: %#v", normalized.Phone)
	}
	if normalized.PhoneDialCode == nil || *normalized.PhoneDialCode != "1" {
		t.Fatalf("unexpected dial: %#v", normalized.PhoneDialCode)
	}
}

func TestNormalizeUpdateProfileInputAcceptsProfileMediaAvatarPath(t *testing.T) {
	avatarURL := "/api/v1/profile/post-media/files/post_media_abc123"

	normalized, err := normalizeUpdateProfileInput(UpdateProfileInput{
		AvatarURL: &avatarURL,
	})
	if err != nil {
		t.Fatalf("expected avatar url to normalize, got error: %v", err)
	}
	if normalized.AvatarURL == nil || *normalized.AvatarURL != avatarURL {
		t.Fatal("expected avatar url to be preserved")
	}
}

func TestNormalizeUpdateProfileInputRejectsUnsafeAvatarURL(t *testing.T) {
	avatarURL := "javascript:alert(1)"

	_, err := normalizeUpdateProfileInput(UpdateProfileInput{
		AvatarURL: &avatarURL,
	})
	if err == nil {
		t.Fatal("expected unsafe avatar url to be rejected")
	}
}

func ptrString(value string) *string {
	return &value
}

func ptrInt(value int) *int {
	return &value
}

func TestContainsEmojiDetectsKeycapSequence(t *testing.T) {
	if !containsEmoji("5\uFE0F\u20E3") {
		t.Fatal("expected keycap emoji to be detected")
	}
}

func TestNormalizeEmailRejectsCommonDomainTypo(t *testing.T) {
	_, err := normalizeEmail("driver@gmal.com")
	if err == nil {
		t.Fatal("expected typo domain to be rejected")
	}

	var domainErr *emailDomainSuggestionError
	if !errors.As(err, &domainErr) {
		t.Fatalf("expected emailDomainSuggestionError, got %T", err)
	}
	if domainErr.suggestedDomain != "gmail.com" {
		t.Fatalf("suggestedDomain = %q, want %q", domainErr.suggestedDomain, "gmail.com")
	}
	if domainErr.SuggestedAddress() != "driver@gmail.com" {
		t.Fatalf("suggested address = %q, want %q", domainErr.SuggestedAddress(), "driver@gmail.com")
	}
}

func TestValidationErrorMapsEmailDomainTypoToAppError(t *testing.T) {
	_, err := normalizeEmail("driver@gmal.com")
	if err == nil {
		t.Fatal("expected typo domain to be rejected")
	}

	appErr, ok := validationError(err).(*AppError)
	if !ok {
		t.Fatalf("expected AppError, got %T", err)
	}
	if appErr.Code != "invalid_email_domain" {
		t.Fatalf("code = %q, want %q", appErr.Code, "invalid_email_domain")
	}
	if appErr.Details["suggestedEmail"] != "driver@gmail.com" {
		t.Fatalf("details[suggestedEmail] = %v, want %q", appErr.Details["suggestedEmail"], "driver@gmail.com")
	}
}

func TestNormalizeUpdateMapPreferencesInputRequiresAtLeastOneField(t *testing.T) {
	_, err := normalizeUpdateMapPreferencesInput(UpdateMapPreferencesInput{})
	if err == nil {
		t.Fatal("expected map preferences payload without fields to be rejected")
	}
}

func TestNormalizeUpdateMapPreferencesInputRejectsInvalidModes(t *testing.T) {
	invalidFilter := MapFilterMode("any")
	if _, err := normalizeUpdateMapPreferencesInput(UpdateMapPreferencesInput{
		MapFilterMode: &invalidFilter,
	}); err == nil {
		t.Fatal("expected invalid mapFilterMode to be rejected")
	}

	invalidTheme := MapThemeMode("blue")
	if _, err := normalizeUpdateMapPreferencesInput(UpdateMapPreferencesInput{
		MapThemeMode: &invalidTheme,
	}); err == nil {
		t.Fatal("expected invalid mapThemeMode to be rejected")
	}
}

func TestNormalizeUpdateMapPreferencesInputAcceptsValidPayload(t *testing.T) {
	filterMode := MapFilterModeAll
	themeMode := MapThemeModeLight
	showLocal := false
	showRemote := true
	tracking := false

	normalized, err := normalizeUpdateMapPreferencesInput(UpdateMapPreferencesInput{
		MapFilterMode:   &filterMode,
		MapThemeMode:    &themeMode,
		ShowLocalLayer:  &showLocal,
		ShowRemoteLayer: &showRemote,
		TrackingEnabled: &tracking,
	})
	if err != nil {
		t.Fatalf("expected map preferences payload to normalize, got error: %v", err)
	}

	if normalized.MapFilterMode == nil || *normalized.MapFilterMode != MapFilterModeAll {
		t.Fatal("normalized mapFilterMode mismatch")
	}
	if normalized.MapThemeMode == nil || *normalized.MapThemeMode != MapThemeModeLight {
		t.Fatal("normalized mapThemeMode mismatch")
	}
	if normalized.ShowLocalLayer == nil || *normalized.ShowLocalLayer != showLocal {
		t.Fatal("normalized showLocalLayer mismatch")
	}
	if normalized.ShowRemoteLayer == nil || *normalized.ShowRemoteLayer != showRemote {
		t.Fatal("normalized showRemoteLayer mismatch")
	}
	if normalized.TrackingEnabled == nil || *normalized.TrackingEnabled != tracking {
		t.Fatal("normalized trackingEnabled mismatch")
	}
}
