package account

import (
	"errors"
	"fmt"
	"net/mail"
	"strings"
	"time"
	"unicode"
)

const (
	minPasswordLength    = 10
	maxPasswordLength    = 12
	minUsernameLength    = 3
	maxUsernameLength    = 20
	maxFullNameLength    = 120
	maxCityLength        = 80
	maxFavoriteCarLength = 80
	maxBioLength         = 280
	maxHeroTaglineLength = 120
	maxAvatarURLLength   = 500
)

var commonEmailDomainTypos = map[string]string{
	"gamil.com":     "gmail.com",
	"gmai.com":      "gmail.com",
	"gmail.co":      "gmail.com",
	"gmail.con":     "gmail.com",
	"gmail.om":      "gmail.com",
	"gmal.com":      "gmail.com",
	"gmial.com":     "gmail.com",
	"gnail.com":     "gmail.com",
	"googlmail.com": "gmail.com",
	"hotnail.com":   "hotmail.com",
	"hotmai.com":    "hotmail.com",
	"hotmial.com":   "hotmail.com",
	"outlok.com":    "outlook.com",
	"outllok.com":   "outlook.com",
	"outloo.com":    "outlook.com",
	"yaho.com":      "yahoo.com",
	"yhoo.com":      "yahoo.com",
}

type emailDomainSuggestionError struct {
	address         string
	domain          string
	suggestedDomain string
}

func (e *emailDomainSuggestionError) Error() string {
	return fmt.Sprintf(
		"email domain is invalid. did you mean %s?",
		e.SuggestedAddress(),
	)
}

func (e *emailDomainSuggestionError) SuggestedAddress() string {
	localPart, _, ok := strings.Cut(e.address, "@")
	if !ok || localPart == "" || e.suggestedDomain == "" {
		return e.address
	}

	return localPart + "@" + e.suggestedDomain
}

func normalizeRegisterInput(input RegisterInput) (RegisterInput, error) {
	fullName, err := normalizeRequiredTextValue(input.FullName, "fullName", 2, maxFullNameLength)
	if err != nil {
		return RegisterInput{}, err
	}

	email, err := normalizeEmail(input.Email)
	if err != nil {
		return RegisterInput{}, err
	}

	password, err := normalizePasswordValue(input.Password, "password")
	if err != nil {
		return RegisterInput{}, err
	}

	usernameSeed := strings.TrimSpace(input.Username)
	usernameProvided := usernameSeed != ""
	if usernameSeed == "" {
		usernameSeed = fullName
	}
	username, err := normalizeUsernameValue(usernameSeed)
	if err != nil {
		if usernameProvided {
			return RegisterInput{}, err
		}
		username = "macdriver"
	}

	city, err := normalizeOptionalTextValue(input.City, "city", maxCityLength, "Istanbul")
	if err != nil {
		return RegisterInput{}, err
	}

	favoriteCar, err := normalizeOptionalTextValue(
		input.FavoriteCar,
		"favoriteCar",
		maxFavoriteCarLength,
		"BMW M4 Competition",
	)
	if err != nil {
		return RegisterInput{}, err
	}

	return RegisterInput{
		City:        city,
		Email:       email,
		FavoriteCar: favoriteCar,
		FullName:    fullName,
		Password:    password,
		Username:    username,
	}, nil
}

func normalizeLoginInput(input LoginInput) (LoginInput, error) {
	identifier, err := normalizeLoginIdentifier(input)
	if err != nil {
		return LoginInput{}, err
	}

	password := strings.TrimSpace(input.Password)
	if password == "" {
		return LoginInput{}, errors.New("password is required")
	}
	if err := rejectEmoji("password", password); err != nil {
		return LoginInput{}, err
	}

	return LoginInput{
		Email:      identifier,
		Identifier: identifier,
		Password:   password,
	}, nil
}

func normalizeResendInput(input ResendVerificationInput) (ResendVerificationInput, error) {
	email, err := normalizeEmail(input.Email)
	if err != nil {
		return ResendVerificationInput{}, err
	}

	return ResendVerificationInput{Email: email}, nil
}

func normalizeVerificationConfirmInput(input VerifyEmailConfirmInput) (VerifyEmailConfirmInput, error) {
	email, err := normalizeEmail(input.Email)
	if err != nil {
		return VerifyEmailConfirmInput{}, err
	}

	if err := rejectEmoji("code", input.Code); err != nil {
		return VerifyEmailConfirmInput{}, err
	}

	code := normalizeNumericCode(input.Code)
	if len(code) != 6 {
		return VerifyEmailConfirmInput{}, errors.New("code must be 6 digits")
	}

	return VerifyEmailConfirmInput{
		Code:  code,
		Email: email,
	}, nil
}

func normalizePasswordResetRequestInput(input PasswordResetRequestInput) (PasswordResetRequestInput, error) {
	email, err := normalizeEmail(input.Email)
	if err != nil {
		return PasswordResetRequestInput{}, err
	}

	return PasswordResetRequestInput{Email: email}, nil
}

func normalizePasswordResetConfirmInput(input PasswordResetConfirmInput) (PasswordResetConfirmInput, error) {
	email, err := normalizeEmail(input.Email)
	if err != nil {
		return PasswordResetConfirmInput{}, err
	}

	if err := rejectEmoji("code", input.Code); err != nil {
		return PasswordResetConfirmInput{}, err
	}

	code := normalizeNumericCode(input.Code)
	if len(code) != 6 {
		return PasswordResetConfirmInput{}, errors.New("code must be 6 digits")
	}

	newPassword, err := normalizePasswordValue(input.NewPassword, "newPassword")
	if err != nil {
		return PasswordResetConfirmInput{}, err
	}

	return PasswordResetConfirmInput{
		Code:        code,
		Email:       email,
		NewPassword: newPassword,
	}, nil
}

func normalizePasswordChangeInput(input PasswordChangeInput) (PasswordChangeInput, error) {
	currentPassword := strings.TrimSpace(input.CurrentPassword)
	if currentPassword == "" {
		return PasswordChangeInput{}, errors.New("currentPassword is required")
	}
	if err := rejectEmoji("currentPassword", currentPassword); err != nil {
		return PasswordChangeInput{}, err
	}

	newPassword, err := normalizePasswordValue(input.NewPassword, "newPassword")
	if err != nil {
		return PasswordChangeInput{}, err
	}

	if currentPassword == newPassword {
		return PasswordChangeInput{}, errors.New("newPassword must be different from currentPassword")
	}

	return PasswordChangeInput{
		CurrentPassword: currentPassword,
		NewPassword:     newPassword,
	}, nil
}

func normalizeSocialInput(input SocialLoginInput) (SocialLoginInput, error) {
	provider := strings.ToLower(strings.TrimSpace(input.Provider))
	if provider != "google" && provider != "facebook" {
		return SocialLoginInput{}, errors.New("provider must be google or facebook")
	}

	fullName := strings.TrimSpace(input.FullName)
	if fullName == "" {
		if provider == "google" {
			fullName = "Google Driver"
		} else {
			fullName = "Facebook Driver"
		}
	}
	fullName, err := normalizeRequiredTextValue(fullName, "fullName", 2, maxFullNameLength)
	if err != nil {
		return SocialLoginInput{}, err
	}

	username := strings.TrimSpace(input.Username)
	usernameProvided := username != ""
	if username == "" {
		username = fullName
	}
	username, err = normalizeUsernameValue(username)
	if err != nil {
		if usernameProvided {
			return SocialLoginInput{}, err
		}
		username = "macdriver"
	}

	email := strings.TrimSpace(input.Email)
	if email == "" {
		providerPart := sanitizeUsername(provider)
		if providerPart == "" {
			providerPart = "driver"
		}
		namePart := sanitizeUsername(fullName)
		if namePart == "" {
			namePart = "member"
		}
		email = fmt.Sprintf("%s.%s@macradar.app", providerPart, namePart)
	}

	normalizedEmail, err := normalizeEmail(email)
	if err != nil {
		return SocialLoginInput{}, err
	}

	city, err := normalizeOptionalTextValue(input.City, "city", maxCityLength, "Istanbul")
	if err != nil {
		return SocialLoginInput{}, err
	}

	avatarURL, err := normalizeOptionalTextValue(
		input.AvatarURL,
		"avatarUrl",
		maxAvatarURLLength,
		defaultAvatarURL(fullName),
	)
	if err != nil {
		return SocialLoginInput{}, err
	}

	return SocialLoginInput{
		AvatarURL: avatarURL,
		City:      city,
		Email:     normalizedEmail,
		FullName:  fullName,
		GoogleIDToken: strings.TrimSpace(input.GoogleIDToken),
		Provider:  provider,
		Username:  username,
	}, nil
}

func digitsOnlyASCII(value string) string {
	var b strings.Builder
	for _, r := range value {
		if r >= '0' && r <= '9' {
			b.WriteRune(r)
		}
	}
	return b.String()
}

func normalizeProfilePhoneFields(dialRaw, nationalRaw string) (dial string, national string, err error) {
	nationalDigits := digitsOnlyASCII(nationalRaw)
	if len(nationalDigits) == 0 {
		return "", "", nil
	}
	dialDigits := digitsOnlyASCII(dialRaw)
	if len(dialDigits) == 0 {
		dialDigits = "90"
	}
	if len(dialDigits) < 1 || len(dialDigits) > 4 {
		return "", "", errors.New("invalid phone dial code")
	}
	if len(nationalDigits) < 4 || len(nationalDigits) > 14 {
		return "", "", errors.New("invalid phone national number")
	}
	if len(dialDigits)+len(nationalDigits) > 15 {
		return "", "", errors.New("phone number is too long")
	}
	if dialDigits == "90" {
		if len(nationalDigits) != 10 || nationalDigits[0] != '5' {
			return "", "", errors.New("Turkiye cep numarasi 10 hane ve 5 ile baslamali")
		}
	}
	return dialDigits, nationalDigits, nil
}

func normalizeUpdateProfileInput(input UpdateProfileInput) (UpdateProfileInput, error) {
	normalized := UpdateProfileInput{}
	hasUpdate := false

	if input.FullName != nil {
		fullName, err := normalizeRequiredTextValue(*input.FullName, "fullName", 2, 60)
		if err != nil {
			return UpdateProfileInput{}, err
		}

		normalized.FullName = &fullName
		hasUpdate = true
	}

	if input.AvatarURL != nil {
		avatarURL, err := normalizeOptionalTextValue(*input.AvatarURL, "avatarUrl", 500, "")
		if err != nil {
			return UpdateProfileInput{}, err
		}
		if avatarURL != "" && !isAllowedAvatarURL(avatarURL) {
			return UpdateProfileInput{}, errors.New("avatarUrl must be an https url or profile media path")
		}

		normalized.AvatarURL = &avatarURL
		hasUpdate = true
	}

	if input.Bio != nil {
		bio, err := normalizeOptionalTextValue(*input.Bio, "bio", 500, "")
		if err != nil {
			return UpdateProfileInput{}, err
		}

		normalized.Bio = &bio
		hasUpdate = true
	}

	if input.City != nil {
		city, err := normalizeOptionalTextValue(*input.City, "city", 70, "")
		if err != nil {
			return UpdateProfileInput{}, err
		}

		normalized.City = &city
		hasUpdate = true
	}

	if input.Email != nil {
		email, err := normalizeEmail(*input.Email)
		if err != nil {
			return UpdateProfileInput{}, err
		}

		normalized.Email = &email
		hasUpdate = true
	}

	if input.FavoriteCar != nil {
		favoriteCar, err := normalizeOptionalTextValue(*input.FavoriteCar, "favoriteCar", 64, "")
		if err != nil {
			return UpdateProfileInput{}, err
		}

		normalized.FavoriteCar = &favoriteCar
		hasUpdate = true
	}

	if input.HeroTagline != nil {
		heroTagline, err := normalizeOptionalTextValue(*input.HeroTagline, "heroTagline", 120, "")
		if err != nil {
			return UpdateProfileInput{}, err
		}

		normalized.HeroTagline = &heroTagline
		hasUpdate = true
	}

	if input.Username != nil {
		username, err := normalizeUsernameValue(*input.Username)
		if err != nil {
			return UpdateProfileInput{}, err
		}

		normalized.Username = &username
		hasUpdate = true
	}

	if input.BirthYear != nil {
		birthYear, err := normalizeBirthYearValue(*input.BirthYear)
		if err != nil {
			return UpdateProfileInput{}, err
		}

		normalized.BirthYear = &birthYear
		hasUpdate = true
	}

	if input.Phone != nil {
		dialIn := ""
		if input.PhoneDialCode != nil {
			dialIn = *input.PhoneDialCode
		}
		dial, national, err := normalizeProfilePhoneFields(dialIn, *input.Phone)
		if err != nil {
			return UpdateProfileInput{}, err
		}

		normalized.Phone = &national
		normalized.PhoneDialCode = &dial
		hasUpdate = true
	}

	if !hasUpdate {
		return UpdateProfileInput{}, errors.New("no changes are provided")
	}

	return normalized, nil
}

func isAllowedAvatarURL(value string) bool {
	normalized := strings.ToLower(strings.TrimSpace(value))
	return strings.HasPrefix(normalized, "https://") ||
		strings.HasPrefix(normalized, "http://") ||
		strings.HasPrefix(normalized, "/api/v1/profile/post-media/files/")
}

func normalizeBirthYearValue(value int) (int, error) {
	currentYear := time.Now().UTC().Year()
	if value < 1930 || value > currentYear+1 {
		return 0, fmt.Errorf("birthYear must be between 1930 and %d", currentYear+1)
	}

	return value, nil
}

func normalizeUpdatePrivacySettingsInput(
	input UpdatePrivacySettingsInput,
) (UpdatePrivacySettingsInput, error) {
	if input.IsPrivateAccount == nil && input.IsMapVisible == nil {
		return UpdatePrivacySettingsInput{}, errors.New("at least one privacy setting is required")
	}

	normalized := UpdatePrivacySettingsInput{}
	if input.IsPrivateAccount != nil {
		next := *input.IsPrivateAccount
		normalized.IsPrivateAccount = &next
	}
	if input.IsMapVisible != nil {
		next := *input.IsMapVisible
		normalized.IsMapVisible = &next
	}

	return normalized, nil
}

func normalizeUpdateMapPreferencesInput(
	input UpdateMapPreferencesInput,
) (UpdateMapPreferencesInput, error) {
	if input.MapFilterMode == nil &&
		input.MapThemeMode == nil &&
		input.ShowLocalLayer == nil &&
		input.ShowRemoteLayer == nil &&
		input.TrackingEnabled == nil {
		return UpdateMapPreferencesInput{}, errors.New("at least one map preference is required")
	}

	normalized := UpdateMapPreferencesInput{}
	if input.MapFilterMode != nil {
		next, err := normalizeMapFilterModeValue(*input.MapFilterMode)
		if err != nil {
			return UpdateMapPreferencesInput{}, err
		}
		normalized.MapFilterMode = &next
	}

	if input.MapThemeMode != nil {
		next, err := normalizeMapThemeModeValue(*input.MapThemeMode)
		if err != nil {
			return UpdateMapPreferencesInput{}, err
		}
		normalized.MapThemeMode = &next
	}

	if input.ShowLocalLayer != nil {
		next := *input.ShowLocalLayer
		normalized.ShowLocalLayer = &next
	}
	if input.ShowRemoteLayer != nil {
		next := *input.ShowRemoteLayer
		normalized.ShowRemoteLayer = &next
	}
	if input.TrackingEnabled != nil {
		next := *input.TrackingEnabled
		normalized.TrackingEnabled = &next
	}

	return normalized, nil
}

func normalizeUpdateProfileAppSettingsInput(
	input UpdateProfileAppSettingsInput,
) (UpdateProfileAppSettingsInput, error) {
	if input.Gender == nil &&
		input.Language == nil &&
		input.NotifyFollowRequests == nil &&
		input.NotifyMessages == nil &&
		input.NotifyPostLikes == nil &&
		input.OnlyFollowedUsersCanMessage == nil {
		return UpdateProfileAppSettingsInput{}, errors.New("at least one app setting is required")
	}

	normalized := UpdateProfileAppSettingsInput{}
	if input.Gender != nil {
		next, err := normalizeProfileGenderValue(*input.Gender)
		if err != nil {
			return UpdateProfileAppSettingsInput{}, err
		}
		normalized.Gender = &next
	}

	if input.Language != nil {
		next, err := normalizeAppLanguageValue(*input.Language)
		if err != nil {
			return UpdateProfileAppSettingsInput{}, err
		}
		normalized.Language = &next
	}
	if input.NotifyFollowRequests != nil {
		next := *input.NotifyFollowRequests
		normalized.NotifyFollowRequests = &next
	}
	if input.NotifyMessages != nil {
		next := *input.NotifyMessages
		normalized.NotifyMessages = &next
	}
	if input.NotifyPostLikes != nil {
		next := *input.NotifyPostLikes
		normalized.NotifyPostLikes = &next
	}
	if input.OnlyFollowedUsersCanMessage != nil {
		next := *input.OnlyFollowedUsersCanMessage
		normalized.OnlyFollowedUsersCanMessage = &next
	}

	return normalized, nil
}

func normalizeMapFilterModeValue(value MapFilterMode) (MapFilterMode, error) {
	switch value {
	case MapFilterModeStreetFriends:
		return MapFilterModeStreetFriends, nil
	case MapFilterModeAll:
		return MapFilterModeAll, nil
	default:
		return "", errors.New("mapFilterMode is invalid")
	}
}

func normalizeMapThemeModeValue(value MapThemeMode) (MapThemeMode, error) {
	switch value {
	case MapThemeModeDark:
		return MapThemeModeDark, nil
	case MapThemeModeLight:
		return MapThemeModeLight, nil
	case MapThemeModeStreet:
		return MapThemeModeStreet, nil
	default:
		return "", errors.New("mapThemeMode is invalid")
	}
}

func normalizeAppLanguageValue(value AppLanguage) (AppLanguage, error) {
	switch value {
	case AppLanguageEnglish:
		return AppLanguageEnglish, nil
	case AppLanguageTurkish:
		return AppLanguageTurkish, nil
	default:
		return "", errors.New("language is invalid")
	}
}

func normalizeProfileGenderValue(value ProfileGender) (ProfileGender, error) {
	switch value {
	case ProfileGenderMale:
		return ProfileGenderMale, nil
	case ProfileGenderFemale:
		return ProfileGenderFemale, nil
	case ProfileGenderNonBinary:
		return ProfileGenderNonBinary, nil
	case ProfileGenderPreferNotToSay:
		return ProfileGenderPreferNotToSay, nil
	default:
		return "", errors.New("gender is invalid")
	}
}

func normalizeEmail(value string) (string, error) {
	if err := rejectEmoji("email", value); err != nil {
		return "", err
	}

	email := strings.ToLower(strings.TrimSpace(value))
	if email == "" {
		return "", errors.New("email is required")
	}

	address, err := mail.ParseAddress(email)
	if err != nil || address.Address == "" {
		return "", errors.New("email is invalid")
	}

	normalized := strings.ToLower(strings.TrimSpace(address.Address))
	localPart, domain, ok := strings.Cut(normalized, "@")
	if !ok || localPart == "" || domain == "" {
		return "", errors.New("email is invalid")
	}
	if !strings.Contains(domain, ".") || strings.Contains(domain, "..") {
		return "", errors.New("email is invalid")
	}

	if suggestedDomain, typo := commonEmailDomainTypos[domain]; typo {
		return "", &emailDomainSuggestionError{
			address:         normalized,
			domain:          domain,
			suggestedDomain: suggestedDomain,
		}
	}

	return normalized, nil
}

func normalizePasswordValue(value string, field string) (string, error) {
	password := strings.TrimSpace(value)
	if err := rejectEmoji(field, password); err != nil {
		return "", err
	}
	if len(password) < minPasswordLength || len(password) > maxPasswordLength {
		return "", fmt.Errorf("%s must be between %d and %d characters", field, minPasswordLength, maxPasswordLength)
	}

	return password, nil
}

func normalizeRequiredTextValue(value string, field string, minLength int, maxLength int) (string, error) {
	normalized := strings.TrimSpace(value)
	if normalized == "" {
		return "", fmt.Errorf("%s is required", field)
	}
	if err := rejectEmoji(field, normalized); err != nil {
		return "", err
	}

	length := len([]rune(normalized))
	if length < minLength || length > maxLength {
		return "", fmt.Errorf("%s must be between %d and %d characters", field, minLength, maxLength)
	}

	return normalized, nil
}

func normalizeOptionalTextValue(value string, field string, maxLength int, fallback string) (string, error) {
	normalized := strings.TrimSpace(value)
	if normalized == "" {
		normalized = fallback
	}
	if err := rejectEmoji(field, normalized); err != nil {
		return "", err
	}
	if len([]rune(normalized)) > maxLength {
		return "", fmt.Errorf("%s is too long", field)
	}

	return normalized, nil
}

func normalizeUsernameValue(value string) (string, error) {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return "", errors.New("username is required")
	}
	if err := rejectEmoji("username", trimmed); err != nil {
		return "", err
	}

	canonical := canonicalUsernameInput(trimmed)
	if canonical == "" {
		return "", errors.New("username is invalid")
	}
	if len(canonical) < minUsernameLength || len(canonical) > maxUsernameLength {
		return "", fmt.Errorf("username must be between %d and %d characters", minUsernameLength, maxUsernameLength)
	}
	username := sanitizeUsername(trimmed)
	if username != canonical {
		return "", errors.New("username may only contain lowercase letters, digits, and underscore")
	}

	return username, nil
}

func normalizeLoginIdentifier(input LoginInput) (string, error) {
	identifier := strings.TrimSpace(input.Identifier)
	if identifier == "" {
		identifier = strings.TrimSpace(input.Email)
	}
	if identifier == "" {
		return "", errors.New("email or username is required")
	}
	if err := rejectEmoji("identifier", identifier); err != nil {
		return "", err
	}
	if strings.Contains(identifier, "@") {
		return normalizeEmail(identifier)
	}
	return normalizeUsernameValue(identifier)
}

func normalizeNumericCode(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}

	var builder strings.Builder
	for _, char := range value {
		if unicode.IsDigit(char) {
			builder.WriteRune(char)
		}
	}

	return builder.String()
}

func rejectEmoji(field string, value string) error {
	if containsEmoji(value) {
		return fmt.Errorf("%s cannot contain emoji", field)
	}

	return nil
}

func containsEmoji(value string) bool {
	for _, char := range value {
		switch {
		case char == '\u200d' || char == '\u20e3' || char == '\ufe0f':
			return true
		case char >= 0x1f1e6 && char <= 0x1f1ff:
			return true
		case char >= 0x1f300 && char <= 0x1faff:
			return true
		case char >= 0x2600 && char <= 0x27bf:
			return true
		}
	}

	return false
}

var turkishCharReplacer = strings.NewReplacer(
	"\u00e7", "c",
	"\u011f", "g",
	"\u0131", "i",
	"\u00f6", "o",
	"\u015f", "s",
	"\u00fc", "u",
	"\u00c7", "c",
	"\u011e", "g",
	"\u0130", "i",
	"\u00d6", "o",
	"\u015e", "s",
	"\u00dc", "u",
)

func sanitizeUsername(value string) string {
	value = canonicalUsernameInput(value)
	if value == "" {
		return ""
	}

	var builder strings.Builder

	for _, char := range value {
		switch {
		case isAllowedUsernameRune(char):
			builder.WriteRune(char)
		case char == '_':
			builder.WriteByte('_')
		}
	}

	result := builder.String()
	if len(result) > maxUsernameLength {
		return result[:maxUsernameLength]
	}

	return result
}

func canonicalUsernameInput(value string) string {
	value = turkishCharReplacer.Replace(strings.TrimSpace(strings.ToLower(value)))
	if value == "" {
		return ""
	}

	var builder strings.Builder
	for _, char := range value {
		if unicode.IsSpace(char) {
			continue
		}
		builder.WriteRune(char)
	}
	return builder.String()
}

func isAllowedUsernameRune(char rune) bool {
	return char <= unicode.MaxASCII &&
		(unicode.IsDigit(char) || (char >= 'a' && char <= 'z'))
}

func defaultHeroTagline(fullName string) string {
	return fmt.Sprintf("%s with premium route cards, compact landing, and synced profile.", strings.TrimSpace(fullName))
}

func defaultFavoriteCar(provider string) string {
	if provider == "facebook" {
		return "Mercedes-AMG GT"
	}

	return "Porsche 911 Turbo S"
}

func defaultAvatarURL(seed string) string {
	options := []string{
		"https://images.unsplash.com/photo-1544723795-3fb6469f5b39?auto=format&fit=crop&w=200&q=80",
		"https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=200&q=80",
		"https://images.unsplash.com/photo-1527980965255-d3b416303d12?auto=format&fit=crop&w=200&q=80",
		"https://images.unsplash.com/photo-1599566150163-29194dcaad36?auto=format&fit=crop&w=200&q=80",
	}

	index := stableIndex(strings.ToLower(strings.TrimSpace(seed)), len(options))
	return options[index]
}

func stableIndex(value string, size int) int {
	if size <= 1 {
		return 0
	}

	hash := uint32(2166136261)
	for _, char := range value {
		hash ^= uint32(char)
		hash *= 16777619
	}

	return int(hash % uint32(size))
}
