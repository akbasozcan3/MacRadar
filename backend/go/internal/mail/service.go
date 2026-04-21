package mail

import (
	"bytes"
	"context"
	"crypto/tls"
	"errors"
	"fmt"
	"html/template"
	"net"
	stdmail "net/mail"
	"net/smtp"
	"strings"
	"time"
)

var ErrSMTPNotConfigured = errors.New("smtp configuration is incomplete")

type Config struct {
	AppBaseURL string
	From       string
	Host       string
	Pass       string
	Port       int
	User       string
}

type VerificationEmailInput struct {
	Code      string
	ExpiresAt time.Time
	ToAddress string
	ToName    string
}

type PasswordResetCodeEmailInput struct {
	Code      string
	ExpiresAt time.Time
	ToAddress string
	ToName    string
}

type Service interface {
	SendPasswordResetCodeEmail(ctx context.Context, input PasswordResetCodeEmailInput) error
	SendVerificationEmail(ctx context.Context, input VerificationEmailInput) error
}

type SMTPService struct {
	cfg          Config
	envelopeFrom string
	headerFrom   string
}

func NewSMTPService(cfg Config) Service {
	headerFrom, envelopeFrom := parseFromAddress(cfg.From)

	return &SMTPService{
		cfg:          cfg,
		envelopeFrom: envelopeFrom,
		headerFrom:   headerFrom,
	}
}

func (s *SMTPService) SendVerificationEmail(ctx context.Context, input VerificationEmailInput) error {
	if !s.isConfigured() {
		return ErrSMTPNotConfigured
	}

	htmlBody, textBody, err := s.renderVerificationEmail(input)
	if err != nil {
		return fmt.Errorf("render verification email: %w", err)
	}

	return s.sendMultipartEmail(
		ctx,
		input.ToAddress,
		"MacRadar email dogrulama kodunuz",
		htmlBody,
		textBody,
	)
}

func (s *SMTPService) SendPasswordResetCodeEmail(ctx context.Context, input PasswordResetCodeEmailInput) error {
	if !s.isConfigured() {
		return ErrSMTPNotConfigured
	}

	htmlBody, textBody, err := s.renderPasswordResetEmail(input)
	if err != nil {
		return fmt.Errorf("render password reset email: %w", err)
	}

	return s.sendMultipartEmail(
		ctx,
		input.ToAddress,
		"MacRadar sifre yenileme kodunuz",
		htmlBody,
		textBody,
	)
}

func (s *SMTPService) isConfigured() bool {
	return s.cfg.Host != "" && s.cfg.Port > 0 && s.envelopeFrom != ""
}

func (s *SMTPService) sendMultipartEmail(
	ctx context.Context,
	toAddress string,
	subject string,
	htmlBody string,
	textBody string,
) error {
	message, envelopeTo, err := s.buildMessage(toAddress, subject, htmlBody, textBody)
	if err != nil {
		return err
	}

	client, conn, err := s.openClient(ctx)
	if err != nil {
		return err
	}
	defer conn.Close()

	shouldClose := true
	defer func() {
		if shouldClose {
			_ = client.Close()
		}
	}()

	if err := client.Mail(s.envelopeFrom); err != nil {
		return fmt.Errorf("smtp mail from failed: %w", err)
	}
	if err := client.Rcpt(envelopeTo); err != nil {
		return fmt.Errorf("smtp recipient failed: %w", err)
	}

	writer, err := client.Data()
	if err != nil {
		return fmt.Errorf("smtp data failed: %w", err)
	}

	if _, err := writer.Write(message); err != nil {
		_ = writer.Close()
		return fmt.Errorf("smtp message write failed: %w", err)
	}
	if err := writer.Close(); err != nil {
		return fmt.Errorf("smtp message close failed: %w", err)
	}

	if err := client.Quit(); err != nil {
		return fmt.Errorf("smtp quit failed: %w", err)
	}

	shouldClose = false
	return nil
}

func (s *SMTPService) buildMessage(
	toAddress string,
	subject string,
	htmlBody string,
	textBody string,
) ([]byte, string, error) {
	headerTo, envelopeTo, err := parseRecipientAddress(toAddress)
	if err != nil {
		return nil, "", err
	}

	var message bytes.Buffer
	message.WriteString(fmt.Sprintf("Date: %s\r\n", time.Now().UTC().Format(time.RFC1123Z)))
	message.WriteString(fmt.Sprintf("From: %s\r\n", s.headerFrom))
	message.WriteString(fmt.Sprintf("To: %s\r\n", headerTo))
	message.WriteString(fmt.Sprintf("Subject: %s\r\n", subject))
	message.WriteString("MIME-Version: 1.0\r\n")
	message.WriteString("Content-Type: multipart/alternative; boundary=\"macradar-boundary\"\r\n")
	message.WriteString("\r\n")
	message.WriteString("--macradar-boundary\r\n")
	message.WriteString("Content-Type: text/plain; charset=\"UTF-8\"\r\n\r\n")
	message.WriteString(textBody)
	message.WriteString("\r\n--macradar-boundary\r\n")
	message.WriteString("Content-Type: text/html; charset=\"UTF-8\"\r\n\r\n")
	message.WriteString(htmlBody)
	message.WriteString("\r\n--macradar-boundary--")

	return message.Bytes(), envelopeTo, nil
}

func (s *SMTPService) openClient(ctx context.Context) (*smtp.Client, net.Conn, error) {
	address := fmt.Sprintf("%s:%d", s.cfg.Host, s.cfg.Port)
	dialer := &net.Dialer{Timeout: 3 * time.Second}

	if s.cfg.Port == 465 {
		conn, err := tls.DialWithDialer(dialer, "tcp", address, &tls.Config{
			MinVersion: tls.VersionTLS12,
			ServerName: s.cfg.Host,
		})
		if err != nil {
			return nil, nil, fmt.Errorf("smtp tls dial failed: %w", err)
		}

		client, err := smtp.NewClient(conn, s.cfg.Host)
		if err != nil {
			conn.Close()
			return nil, nil, fmt.Errorf("smtp client init failed: %w", err)
		}

		if err := s.authenticate(client); err != nil {
			conn.Close()
			return nil, nil, err
		}

		return client, conn, nil
	}

	conn, err := dialer.DialContext(ctx, "tcp", address)
	if err != nil {
		return nil, nil, fmt.Errorf("smtp dial failed: %w", err)
	}

	client, err := smtp.NewClient(conn, s.cfg.Host)
	if err != nil {
		conn.Close()
		return nil, nil, fmt.Errorf("smtp client init failed: %w", err)
	}

	if ok, _ := client.Extension("STARTTLS"); ok {
		if err := client.StartTLS(&tls.Config{
			MinVersion: tls.VersionTLS12,
			ServerName: s.cfg.Host,
		}); err != nil {
			client.Close()
			conn.Close()
			return nil, nil, fmt.Errorf("smtp starttls failed: %w", err)
		}
	} else if s.cfg.Port == 587 {
		client.Close()
		conn.Close()
		return nil, nil, errors.New("smtp server does not support STARTTLS on port 587")
	}

	if err := s.authenticate(client); err != nil {
		client.Close()
		conn.Close()
		return nil, nil, err
	}

	return client, conn, nil
}

func (s *SMTPService) authenticate(client *smtp.Client) error {
	if s.cfg.User == "" && s.cfg.Pass == "" {
		return nil
	}
	if s.cfg.User == "" || s.cfg.Pass == "" {
		return ErrSMTPNotConfigured
	}

	if ok, _ := client.Extension("AUTH"); !ok {
		return errors.New("smtp server does not support AUTH")
	}

	auth := smtp.PlainAuth("", s.cfg.User, s.cfg.Pass, s.cfg.Host)
	if err := client.Auth(auth); err != nil {
		return fmt.Errorf("smtp auth failed: %w", err)
	}

	return nil
}

func (s *SMTPService) renderVerificationEmail(input VerificationEmailInput) (string, string, error) {
	payload := struct {
		Code         string
		ExpiresText  string
		FullName     string
		LogoURL      string
		SafeLink     string
		SupportEmail string
	}{
		Code:         strings.TrimSpace(input.Code),
		ExpiresText:  input.ExpiresAt.Local().Format("02 Jan 2006 15:04"),
		FullName:     fallbackName(input.ToName),
		LogoURL:      s.logoURL(),
		SafeLink:     s.appLink("/login"),
		SupportEmail: s.supportEmail(),
	}

	var htmlBody bytes.Buffer
	if err := verificationTemplate.Execute(&htmlBody, payload); err != nil {
		return "", "", err
	}

	textBody := strings.TrimSpace(fmt.Sprintf(`
Merhaba %s,

MacRadar hesabinizi aktif etmek icin bu 6 haneli dogrulama kodunu uygulamaya girin:
%s

Kod %s tarihine kadar gecerlidir.

Destek: %s
Guvenli giris: %s

Eger bu kaydi siz baslatmadiysaniz bu emaili gormezden gelebilirsiniz.
`, payload.FullName, payload.Code, payload.ExpiresText, payload.SupportEmail, payload.SafeLink))

	return htmlBody.String(), textBody, nil
}

func (s *SMTPService) renderPasswordResetEmail(input PasswordResetCodeEmailInput) (string, string, error) {
	payload := struct {
		Code         string
		ExpiresText  string
		FullName     string
		LogoURL      string
		SafeLink     string
		SupportEmail string
	}{
		Code:         strings.TrimSpace(input.Code),
		ExpiresText:  input.ExpiresAt.Local().Format("02 Jan 2006 15:04"),
		FullName:     fallbackName(input.ToName),
		LogoURL:      s.logoURL(),
		SafeLink:     s.appLink("/login"),
		SupportEmail: s.supportEmail(),
	}

	var htmlBody bytes.Buffer
	if err := passwordResetTemplate.Execute(&htmlBody, payload); err != nil {
		return "", "", err
	}

	textBody := strings.TrimSpace(fmt.Sprintf(`
Merhaba %s,

MacRadar şifrenizi yenilemek için güvenlik kodunuz:
%s

Kod %s tarihine kadar gecerlidir.

Destek: %s
Güvenli giriş: %s

Bu islemi siz baslatmadiysaniz emaili gormezden gelebilirsiniz.
`, payload.FullName, payload.Code, payload.ExpiresText, payload.SupportEmail, payload.SafeLink))

	return htmlBody.String(), textBody, nil
}

func fallbackName(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return "MacRadar surucusu"
	}

	return value
}

func parseFromAddress(value string) (string, string) {
	value = strings.TrimSpace(value)
	if value == "" {
		return "", ""
	}

	if parsed, err := stdmail.ParseAddress(value); err == nil && parsed.Address != "" {
		return parsed.String(), parsed.Address
	}

	fallback := strings.Trim(value, "<>")
	if strings.Contains(fallback, "@") {
		return value, fallback
	}

	return value, ""
}

func parseRecipientAddress(value string) (string, string, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return "", "", errors.New("recipient email address is missing")
	}
	if strings.ContainsAny(value, "\r\n") {
		return "", "", errors.New("recipient email address is invalid")
	}

	if list, err := stdmail.ParseAddressList(value); err == nil {
		if len(list) != 1 {
			return "", "", errors.New("exactly one recipient email address is required")
		}
		address := strings.ToLower(strings.TrimSpace(list[0].Address))
		if address == "" {
			return "", "", errors.New("recipient email address is invalid")
		}
		return list[0].String(), address, nil
	}

	if parsed, err := stdmail.ParseAddress(value); err == nil && parsed.Address != "" {
		address := strings.ToLower(strings.TrimSpace(parsed.Address))
		if address == "" {
			return "", "", errors.New("recipient email address is invalid")
		}
		return parsed.String(), address, nil
	}

	return "", "", errors.New("recipient email address is invalid")
}

func (s *SMTPService) logoURL() string {
	const fallbackPublicLogoURL = "https://macradar.app/assets/macradar-email-logo.png"

	baseURL := strings.TrimRight(strings.TrimSpace(s.cfg.AppBaseURL), "/")
	if baseURL == "" {
		return fallbackPublicLogoURL
	}

	lower := strings.ToLower(baseURL)
	if strings.Contains(lower, "localhost") ||
		strings.Contains(lower, "127.0.0.1") ||
		strings.Contains(lower, "0.0.0.0") ||
		strings.Contains(lower, "10.0.2.2") ||
		strings.Contains(lower, "10.0.3.2") ||
		strings.Contains(lower, "::1") ||
		strings.Contains(lower, ".local") {
		return fallbackPublicLogoURL
	}

	return baseURL + "/assets/macradar-email-logo.png"
}

func (s *SMTPService) appLink(path string) string {
	baseURL := strings.TrimRight(strings.TrimSpace(s.cfg.AppBaseURL), "/")
	if baseURL == "" {
		return "https://macradar.app"
	}

	path = "/" + strings.TrimLeft(strings.TrimSpace(path), "/")
	return baseURL + path
}

func (s *SMTPService) supportEmail() string {
	if s.envelopeFrom != "" {
		return s.envelopeFrom
	}

	return "support@macradar.app"
}

var verificationTemplate = template.Must(template.New("verification-email").Parse(`
<!DOCTYPE html>
<html lang="tr">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>MacRadar Verification Code</title>
  </head>
  <body style="margin:0;padding:0;font-family:Arial,sans-serif;color:#111827;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
      <tr>
        <td align="center" style="padding:24px 14px;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;">
            <tr>
              <td style="padding:0 0 18px;">
                {{ if .LogoURL }}
                  <img src="{{ .LogoURL }}" alt="MacRadar" width="168" style="display:block;height:auto;border:0;outline:none;text-decoration:none;" />
                {{ else }}
                  <div style="font-size:32px;line-height:34px;font-weight:700;color:#111827;">MacRadar</div>
                  <div style="margin-top:2px;font-size:13px;line-height:18px;color:#4b5563;">MacRadar Security</div>
                {{ end }}
              </td>
            </tr>
            <tr>
              <td style="font-size:22px;line-height:30px;font-weight:700;padding:0 0 14px;">
                Email dogrulama kodunuz
              </td>
            </tr>
            <tr>
              <td style="font-size:16px;line-height:24px;padding:0 0 14px;">
                Merhaba {{ .FullName }},
              </td>
            </tr>
            <tr>
              <td style="font-size:17px;line-height:26px;padding:0 0 10px;">
                MacRadar Security hesabinizla iletisime gecenin siz oldugunu dogrulamak icin bu istegi onaylamanizi bekliyor.
              </td>
            </tr>
            <tr>
              <td style="font-size:36px;line-height:42px;font-weight:700;letter-spacing:8px;padding:0 0 12px;">
                {{ .Code }}
              </td>
            </tr>
            <tr>
              <td style="font-size:15px;line-height:23px;padding:0 0 4px;">
                <strong>When:</strong> {{ .ExpiresText }} tarihine kadar gecerlidir
              </td>
            </tr>
            <tr>
              <td style="font-size:15px;line-height:23px;padding:0 0 4px;">
                <strong>Device:</strong> MacRadar Mobile
              </td>
            </tr>
            <tr>
              <td style="font-size:15px;line-height:23px;padding:0 0 12px;">
                <strong>Near:</strong> Turkiye
              </td>
            </tr>
            <tr>
              <td style="padding:0 0 18px;">
                <a href="{{ .SafeLink }}" style="color:#1d4ed8;text-decoration:underline;font-size:15px;line-height:22px;">Open MacRadar</a>
              </td>
            </tr>
            <tr>
              <td>
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color:#eef0f2;border:1px solid #d1d5db;">
                  <tr>
                    <td style="padding:14px;font-size:13px;line-height:20px;color:#374151;">
                      MacRadar Turkey Teknoloji Hizmetleri Ltd. iletisimi {{ .SupportEmail }} adresinden saglanir.
                      Bu emaildeki kod tek kullanimliktir ve sadece guvenlik dogrulamasi icindir.
                      <br /><br />
                      Is it safe to follow this link?
                      <br />
                      The link provided in this email starts with "{{ .SafeLink }}".
                      If you prefer, copy the following link and paste it in a browser:
                      <br /><br />
                      <a href="{{ .SafeLink }}" style="color:#1d4ed8;text-decoration:underline;">{{ .SafeLink }}</a>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
`))

var passwordResetTemplate = template.Must(template.New("password-reset-email").Parse(`
<!DOCTYPE html>
<html lang="tr">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>MacRadar Password Reset Code</title>
  </head>
  <body style="margin:0;padding:0;font-family:Arial,sans-serif;color:#111827;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
      <tr>
        <td align="center" style="padding:24px 14px;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;">
            <tr>
              <td style="padding:0 0 18px;">
                {{ if .LogoURL }}
                  <img src="{{ .LogoURL }}" alt="MacRadar" width="168" style="display:block;height:auto;border:0;outline:none;text-decoration:none;" />
                {{ else }}
                  <div style="font-size:32px;line-height:34px;font-weight:700;color:#111827;">MacRadar</div>
                  <div style="margin-top:2px;font-size:13px;line-height:18px;color:#4b5563;">MacRadar Security</div>
                {{ end }}
              </td>
            </tr>
            <tr>
              <td style="font-size:22px;line-height:30px;font-weight:700;padding:0 0 14px;">
                Sifre yenileme kodunuz
              </td>
            </tr>
            <tr>
              <td style="font-size:16px;line-height:24px;padding:0 0 14px;">
                Merhaba {{ .FullName }},
              </td>
            </tr>
            <tr>
              <td style="font-size:17px;line-height:26px;padding:0 0 10px;">
                MacRadar Security sifre yenileme isteginizi dogrulamak icin bu tek kullanimlik kodu onaylamanizi bekliyor.
              </td>
            </tr>
            <tr>
              <td style="font-size:36px;line-height:42px;font-weight:700;letter-spacing:8px;padding:0 0 12px;">
                {{ .Code }}
              </td>
            </tr>
            <tr>
              <td style="font-size:15px;line-height:23px;padding:0 0 4px;">
                <strong>When:</strong> {{ .ExpiresText }} tarihine kadar gecerlidir
              </td>
            </tr>
            <tr>
              <td style="font-size:15px;line-height:23px;padding:0 0 4px;">
                <strong>Device:</strong> MacRadar Mobile
              </td>
            </tr>
            <tr>
              <td style="font-size:15px;line-height:23px;padding:0 0 12px;">
                <strong>Near:</strong> Turkiye
              </td>
            </tr>
            <tr>
              <td style="padding:0 0 18px;">
                <a href="{{ .SafeLink }}" style="color:#1d4ed8;text-decoration:underline;font-size:15px;line-height:22px;">Open MacRadar</a>
              </td>
            </tr>
            <tr>
              <td>
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color:#eef0f2;border:1px solid #d1d5db;">
                  <tr>
                    <td style="padding:14px;font-size:13px;line-height:20px;color:#374151;">
                      MacRadar Turkey Teknoloji Hizmetleri Ltd. iletisimi {{ .SupportEmail }} adresinden saglanir.
                      Bu emaildeki kod tek kullanimliktir ve sadece sifre yenileme islemi icindir.
                      <br /><br />
                      Is it safe to follow this link?
                      <br />
                      The link provided in this email starts with "{{ .SafeLink }}".
                      If you prefer, copy the following link and paste it in a browser:
                      <br /><br />
                      <a href="{{ .SafeLink }}" style="color:#1d4ed8;text-decoration:underline;">{{ .SafeLink }}</a>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
`))
