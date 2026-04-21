package mail

import (
	"strings"
	"testing"
	"time"
)

func TestRenderVerificationEmail(t *testing.T) {
	service := &SMTPService{}
	expiresAt := time.Date(2026, time.March, 11, 10, 30, 0, 0, time.UTC)
	expectedExpiresText := expiresAt.Local().Format("02 Jan 2006 15:04")

	htmlBody, textBody, err := service.renderVerificationEmail(VerificationEmailInput{
		Code:      "481205",
		ExpiresAt: expiresAt,
		ToName:    "Eren",
	})
	if err != nil {
		t.Fatalf("renderVerificationEmail returned error: %v", err)
	}

	assertContains(t, htmlBody, "Email dogrulama kodunuz")
	assertContains(t, htmlBody, "MacRadar Security")
	assertContains(t, htmlBody, "Eren")
	assertContains(t, htmlBody, "481205")
	assertContains(t, htmlBody, expectedExpiresText)
	assertContains(t, textBody, "MacRadar hesabinizi aktif etmek icin bu 6 haneli dogrulama kodunu")
	assertContains(t, textBody, "481205")
	assertNotContains(t, htmlBody, "linear-gradient")
	assertNotContains(t, htmlBody, "background:")
}

func TestRenderPasswordResetEmail(t *testing.T) {
	service := &SMTPService{}
	expiresAt := time.Date(2026, time.March, 11, 12, 45, 0, 0, time.UTC)
	expectedExpiresText := expiresAt.Local().Format("02 Jan 2006 15:04")

	htmlBody, textBody, err := service.renderPasswordResetEmail(PasswordResetCodeEmailInput{
		Code:      "483921",
		ExpiresAt: expiresAt,
		ToName:    "Eren",
	})
	if err != nil {
		t.Fatalf("renderPasswordResetEmail returned error: %v", err)
	}

	assertContains(t, htmlBody, "Sifre yenileme kodunuz")
	assertContains(t, htmlBody, "MacRadar Security")
	assertContains(t, htmlBody, "483921")
	assertContains(t, htmlBody, expectedExpiresText)
	assertContains(t, textBody, "MacRadar sifrenizi yenilemek icin guvenlik kodunuz")
	assertContains(t, textBody, "483921")
	assertNotContains(t, htmlBody, "linear-gradient")
	assertNotContains(t, htmlBody, "background:")
}

func TestBuildMessageUsesParsedRecipientEnvelope(t *testing.T) {
	service := &SMTPService{
		headerFrom: "MacRadar Security <security@macradar.app>",
	}

	_, envelopeTo, err := service.buildMessage(
		"Eren Akbas <ERENAKBAS38@GMAIL.COM>",
		"Test Subject",
		"<p>test</p>",
		"test",
	)
	if err != nil {
		t.Fatalf("buildMessage returned error: %v", err)
	}
	if envelopeTo != "erenakbas38@gmail.com" {
		t.Fatalf("envelopeTo = %q, want %q", envelopeTo, "erenakbas38@gmail.com")
	}
}

func TestBuildMessageRejectsMultipleRecipients(t *testing.T) {
	service := &SMTPService{
		headerFrom: "MacRadar Security <security@macradar.app>",
	}

	_, _, err := service.buildMessage(
		"driver@gmail.com, driver@gmal.com",
		"Test Subject",
		"<p>test</p>",
		"test",
	)
	if err == nil {
		t.Fatal("expected error for multiple recipients, got nil")
	}
}

func assertContains(t *testing.T, body string, want string) {
	t.Helper()

	if !strings.Contains(body, want) {
		t.Fatalf("expected body to contain %q, got %q", want, body)
	}
}

func assertNotContains(t *testing.T, body string, want string) {
	t.Helper()

	if strings.Contains(body, want) {
		t.Fatalf("expected body not to contain %q, got %q", want, body)
	}
}
