package account

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
)

const sessionTTL = 30 * 24 * time.Hour
const sessionTouchInterval = 5 * time.Minute

type sessionClaims struct {
	Exp      int64  `json:"exp"`
	Iat      int64  `json:"iat"`
	Provider string `json:"provider"`
	Session  string `json:"sid"`
	Subject  string `json:"sub"`
}

var encodedJWTHeader = base64.RawURLEncoding.EncodeToString([]byte(`{"alg":"HS256","typ":"JWT"}`))

func newVerificationToken() (string, string, error) {
	raw, err := randomToken(32)
	if err != nil {
		return "", "", err
	}

	return raw, hashToken(raw), nil
}

func hashVerificationCode(email string, code string) string {
	email = strings.ToLower(strings.TrimSpace(email))
	code = strings.TrimSpace(code)
	if email == "" || code == "" {
		return ""
	}

	return hashToken(email + ":" + code)
}

func hashPasswordResetCode(email string, code string) string {
	return hashVerificationCode(email, code)
}

func matchesPasswordResetCode(email string, code string, storedHash string) bool {
	if storedHash == "" {
		return false
	}

	return hashPasswordResetCode(email, code) == storedHash || hashToken(code) == storedHash
}

func newNumericCode(length int) (string, string, error) {
	if length <= 0 {
		return "", "", errors.New("code length must be positive")
	}

	maxValue := uint64(1)
	for i := 0; i < length; i++ {
		maxValue *= 10
	}

	buffer := make([]byte, 8)
	if _, err := rand.Read(buffer); err != nil {
		return "", "", err
	}

	value := binary.BigEndian.Uint64(buffer) % maxValue
	raw := fmt.Sprintf("%0*d", length, value)
	return raw, hashToken(raw), nil
}

func newSessionToken(secret string, sessionID string, userID string, provider string, expiresAt time.Time) (string, string, error) {
	if strings.TrimSpace(secret) == "" {
		return "", "", errors.New("jwt secret is required")
	}

	claims := sessionClaims{
		Exp:      expiresAt.UTC().Unix(),
		Iat:      time.Now().UTC().Unix(),
		Provider: provider,
		Session:  sessionID,
		Subject:  userID,
	}

	payload, err := json.Marshal(claims)
	if err != nil {
		return "", "", err
	}

	encodedPayload := base64.RawURLEncoding.EncodeToString(payload)
	signingInput := encodedJWTHeader + "." + encodedPayload
	signature := signToken(secret, signingInput)
	token := signingInput + "." + signature

	return token, hashToken(token), nil
}

func parseSessionToken(secret string, token string) (SessionIdentity, error) {
	parts := strings.Split(strings.TrimSpace(token), ".")
	if len(parts) != 3 {
		return SessionIdentity{}, unauthorizedError()
	}

	signingInput := parts[0] + "." + parts[1]
	expectedSignature := signToken(secret, signingInput)
	if !hmac.Equal([]byte(expectedSignature), []byte(parts[2])) {
		return SessionIdentity{}, unauthorizedError()
	}

	payload, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return SessionIdentity{}, unauthorizedError()
	}

	var claims sessionClaims
	if err := json.Unmarshal(payload, &claims); err != nil {
		return SessionIdentity{}, unauthorizedError()
	}

	if claims.Subject == "" || claims.Session == "" || claims.Exp <= time.Now().UTC().Unix() {
		return SessionIdentity{}, unauthorizedError()
	}

	return SessionIdentity{
		ExpiresAt: time.Unix(claims.Exp, 0).UTC(),
		Provider:  claims.Provider,
		SessionID: claims.Session,
		UserID:    claims.Subject,
	}, nil
}

func randomToken(byteLength int) (string, error) {
	buffer := make([]byte, byteLength)
	if _, err := rand.Read(buffer); err != nil {
		return "", err
	}

	return base64.RawURLEncoding.EncodeToString(buffer), nil
}

func hashToken(token string) string {
	token = strings.TrimSpace(token)
	if token == "" {
		return ""
	}

	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

func signToken(secret string, signingInput string) string {
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte(signingInput))
	return base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

func newID(prefix string) string {
	raw, err := randomIDComponent(6)
	if err != nil {
		return fmt.Sprintf("%s_%d", prefix, time.Now().UnixNano())
	}

	return fmt.Sprintf("%s_%d_%s", prefix, time.Now().UnixMilli(), raw)
}

func randomIDComponent(byteLength int) (string, error) {
	buffer := make([]byte, byteLength)
	if _, err := rand.Read(buffer); err != nil {
		return "", err
	}

	return hex.EncodeToString(buffer), nil
}
