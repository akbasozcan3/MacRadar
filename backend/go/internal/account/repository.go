package account

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Repository struct {
	db *pgxpool.Pool
}

type userRecord struct {
	AuthProvider    string
	AvatarURL       string
	Bio             string
	City            string
	CreatedAt       time.Time
	Email           string
	FavoriteCar     string
	FullName        string
	HeroTagline     string
	ID              string
	IsEmailVerified bool
	IsVerified      bool
	LastLoginAt     *time.Time
	PasswordHash    string
	Status          UserStatus
	Username        string
}

type verificationTokenRecord struct {
	AttemptCount    int
	Email           string
	ExpiresAt       time.Time
	FullName        string
	ID              string
	IsEmailVerified bool
	Status          UserStatus
	TokenHash       string
	UsedAt          *time.Time
	UserID          string
}

type passwordResetCodeRecord struct {
	AttemptCount    int
	CodeHash        string
	Email           string
	ExpiresAt       time.Time
	FullName        string
	ID              string
	IsEmailVerified bool
	Status          UserStatus
	UsedAt          *time.Time
	UserID          string
}

func NewRepository(db *pgxpool.Pool) *Repository {
	return &Repository{db: db}
}

func (r *Repository) BeginTx(ctx context.Context) (pgx.Tx, error) {
	return r.db.BeginTx(ctx, pgx.TxOptions{})
}

func (r *Repository) LockEmailTx(ctx context.Context, tx pgx.Tx, email string) error {
	if _, err := tx.Exec(ctx, `select pg_advisory_xact_lock($1)`, emailLockKey(email)); err != nil {
		return fmt.Errorf("lock email: %w", err)
	}

	return nil
}

func (r *Repository) FindUserByEmail(ctx context.Context, email string) (userRecord, bool, error) {
	return r.findUserByEmail(ctx, r.db, email, false)
}

func (r *Repository) FindUserByLoginIdentifier(ctx context.Context, identifier string) (userRecord, bool, error) {
	normalized := strings.ToLower(strings.TrimSpace(identifier))
	if normalized == "" {
		return userRecord{}, false, nil
	}
	if strings.Contains(normalized, "@") {
		return r.FindUserByEmail(ctx, normalized)
	}

	var record userRecord
	if err := r.db.QueryRow(ctx, `
		select
			id,
			username,
			full_name,
			coalesce(email, ''),
			coalesce(password_hash, ''),
			avatar_url,
			bio,
			city,
			favorite_car,
			hero_tagline,
			auth_provider,
			is_verified,
			coalesce(is_email_verified, false),
			coalesce(status, 'active'),
			created_at,
			last_login_at
		from users
		where lower(username) = $1
	`, normalized).Scan(
		&record.ID,
		&record.Username,
		&record.FullName,
		&record.Email,
		&record.PasswordHash,
		&record.AvatarURL,
		&record.Bio,
		&record.City,
		&record.FavoriteCar,
		&record.HeroTagline,
		&record.AuthProvider,
		&record.IsVerified,
		&record.IsEmailVerified,
		&record.Status,
		&record.CreatedAt,
		&record.LastLoginAt,
	); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return userRecord{}, false, nil
		}
		return userRecord{}, false, fmt.Errorf("query user by username: %w", err)
	}

	return record, true, nil
}

func (r *Repository) FindUserByID(ctx context.Context, userID string) (userRecord, bool, error) {
	var record userRecord
	if err := r.db.QueryRow(ctx, `
		select
			id,
			username,
			full_name,
			coalesce(email, ''),
			coalesce(password_hash, ''),
			avatar_url,
			bio,
			city,
			favorite_car,
			hero_tagline,
			auth_provider,
			is_verified,
			coalesce(is_email_verified, false),
			coalesce(status, 'active'),
			created_at,
			last_login_at
		from users
		where id = $1
	`, strings.TrimSpace(userID)).Scan(
		&record.ID,
		&record.Username,
		&record.FullName,
		&record.Email,
		&record.PasswordHash,
		&record.AvatarURL,
		&record.Bio,
		&record.City,
		&record.FavoriteCar,
		&record.HeroTagline,
		&record.AuthProvider,
		&record.IsVerified,
		&record.IsEmailVerified,
		&record.Status,
		&record.CreatedAt,
		&record.LastLoginAt,
	); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return userRecord{}, false, nil
		}
		return userRecord{}, false, fmt.Errorf("query user by id: %w", err)
	}

	return record, true, nil
}

func (r *Repository) FindUserByEmailTx(ctx context.Context, tx pgx.Tx, email string, forUpdate bool) (userRecord, bool, error) {
	return r.findUserByEmail(ctx, tx, email, forUpdate)
}

func (r *Repository) findUserByEmail(ctx context.Context, queryer interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}, email string, forUpdate bool) (userRecord, bool, error) {
	query := `
		select
			id,
			username,
			full_name,
			coalesce(email, ''),
			coalesce(password_hash, ''),
			avatar_url,
			bio,
			city,
			favorite_car,
			hero_tagline,
			auth_provider,
			is_verified,
			coalesce(is_email_verified, false),
			coalesce(status, 'active'),
			created_at,
			last_login_at
		from users
		where lower(email) = $1
	`
	if forUpdate {
		query += ` for update`
	}

	var record userRecord
	if err := queryer.QueryRow(ctx, query, strings.ToLower(strings.TrimSpace(email))).Scan(
		&record.ID,
		&record.Username,
		&record.FullName,
		&record.Email,
		&record.PasswordHash,
		&record.AvatarURL,
		&record.Bio,
		&record.City,
		&record.FavoriteCar,
		&record.HeroTagline,
		&record.AuthProvider,
		&record.IsVerified,
		&record.IsEmailVerified,
		&record.Status,
		&record.CreatedAt,
		&record.LastLoginAt,
	); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return userRecord{}, false, nil
		}
		return userRecord{}, false, fmt.Errorf("query user by email: %w", err)
	}

	return record, true, nil
}

func (r *Repository) InsertLocalUserTx(ctx context.Context, tx pgx.Tx, input RegisterInput, passwordHash string, username string) (userRecord, error) {
	record := userRecord{
		AuthProvider:    "local",
		AvatarURL:       "",
		Bio:             "",
		City:            input.City,
		Email:           input.Email,
		FavoriteCar:     input.FavoriteCar,
		FullName:        input.FullName,
		HeroTagline:     defaultHeroTagline(input.FullName),
		ID:              newID("user"),
		IsEmailVerified: false,
		IsVerified:      false,
		PasswordHash:    passwordHash,
		Status:          UserStatusPendingVerification,
		Username:        username,
	}

	if _, err := tx.Exec(ctx, `
		insert into users (
			id,
			username,
			full_name,
			email,
			password_hash,
			avatar_url,
			bio,
			city,
			favorite_car,
			hero_tagline,
			auth_provider,
			is_verified,
			is_email_verified,
			is_private_account,
			status,
			created_at,
			updated_at
		)
		values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'local', false, false, false, $11, now(), now())
	`, record.ID, record.Username, record.FullName, record.Email, record.PasswordHash, record.AvatarURL,
		record.Bio, record.City, record.FavoriteCar, record.HeroTagline, record.Status); err != nil {
		if isUniqueViolation(err) {
			if uniqueViolationConstraintName(err) == "idx_users_username" || strings.Contains(uniqueViolationConstraintName(err), "username") {
				return userRecord{}, usernameTakenError()
			}
			return userRecord{}, emailInUseError()
		}
		return userRecord{}, fmt.Errorf("insert local user: %w", err)
	}

	record.CreatedAt = time.Now().UTC()
	return record, nil
}

func (r *Repository) UpdatePendingLocalUserTx(ctx context.Context, tx pgx.Tx, userID string, input RegisterInput, passwordHash string, username string) error {
	if _, err := tx.Exec(ctx, `
		update users
		set
			username = $2,
			full_name = $3,
			password_hash = $4,
			avatar_url = $5,
			bio = $6,
			city = $7,
			favorite_car = $8,
			hero_tagline = $9,
			auth_provider = 'local',
			is_verified = false,
			is_email_verified = false,
			is_private_account = false,
			status = $10,
			updated_at = now()
		where id = $1
	`, userID, username, input.FullName, passwordHash, "", "",
		input.City, input.FavoriteCar, defaultHeroTagline(input.FullName), UserStatusPendingVerification); err != nil {
		if isUniqueViolation(err) {
			return usernameTakenError()
		}
		return fmt.Errorf("update pending local user: %w", err)
	}

	return nil
}

func (r *Repository) InsertVerificationTokenTx(ctx context.Context, tx pgx.Tx, userID string, tokenHash string, expiresAt time.Time) error {
	if _, err := tx.Exec(ctx, `
		insert into email_verification_tokens (
			id,
			user_id,
			token_hash,
			expires_at,
			created_at
		)
		values ($1, $2, $3, $4, now())
	`, newID("verify"), userID, tokenHash, expiresAt.UTC()); err != nil {
		return fmt.Errorf("insert verification token: %w", err)
	}

	return nil
}

func (r *Repository) InvalidateUnusedVerificationTokensTx(ctx context.Context, tx pgx.Tx, userID string) error {
	if _, err := tx.Exec(ctx, `
		update email_verification_tokens
		set used_at = now()
		where user_id = $1 and used_at is null
	`, userID); err != nil {
		return fmt.Errorf("invalidate verification tokens: %w", err)
	}

	return nil
}

func (r *Repository) VerificationSendWindowStateTx(ctx context.Context, tx pgx.Tx, userID string, since time.Time) (int, *time.Time, *time.Time, error) {
	var (
		count  int
		oldest *time.Time
		latest *time.Time
	)

	if err := tx.QueryRow(ctx, `
		select
			count(*),
			min(created_at),
			max(created_at)
		from email_verification_tokens
		where user_id = $1 and created_at >= $2
	`, userID, since.UTC()).Scan(&count, &oldest, &latest); err != nil {
		return 0, nil, nil, fmt.Errorf("query verification window state: %w", err)
	}

	return count, oldest, latest, nil
}

func (r *Repository) LatestVerificationTokenTx(ctx context.Context, tx pgx.Tx, userID string) (*time.Time, *time.Time, error) {
	var createdAt *time.Time
	var expiresAt *time.Time
	if err := tx.QueryRow(ctx, `
		select created_at, expires_at
		from email_verification_tokens
		where user_id = $1
		order by created_at desc
		limit 1
	`, userID).Scan(&createdAt, &expiresAt); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil, nil
		}
		return nil, nil, fmt.Errorf("query latest verification token: %w", err)
	}

	return createdAt, expiresAt, nil
}

func (r *Repository) FindVerificationTokenByHashTx(ctx context.Context, tx pgx.Tx, tokenHash string) (verificationTokenRecord, bool, error) {
	var record verificationTokenRecord
	if err := tx.QueryRow(ctx, `
		select
			t.id,
			t.user_id,
			t.token_hash,
			t.expires_at,
			t.used_at,
			t.attempt_count,
			coalesce(u.email, ''),
			u.full_name,
			coalesce(u.is_email_verified, false),
			coalesce(u.status, 'active')
		from email_verification_tokens t
		join users u on u.id = t.user_id
		where t.token_hash = $1
	`, tokenHash).Scan(
		&record.ID,
		&record.UserID,
		&record.TokenHash,
		&record.ExpiresAt,
		&record.UsedAt,
		&record.AttemptCount,
		&record.Email,
		&record.FullName,
		&record.IsEmailVerified,
		&record.Status,
	); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return verificationTokenRecord{}, false, nil
		}
		return verificationTokenRecord{}, false, fmt.Errorf("query verification token: %w", err)
	}

	return record, true, nil
}

func (r *Repository) FindActiveVerificationTokenTx(ctx context.Context, tx pgx.Tx, userID string) (verificationTokenRecord, bool, error) {
	var record verificationTokenRecord
	if err := tx.QueryRow(ctx, `
		select
			t.id,
			t.user_id,
			t.token_hash,
			t.expires_at,
			t.used_at,
			t.attempt_count,
			coalesce(u.email, ''),
			u.full_name,
			coalesce(u.is_email_verified, false),
			coalesce(u.status, 'active')
		from email_verification_tokens t
		join users u on u.id = t.user_id
		where t.user_id = $1 and t.used_at is null
		order by t.created_at desc
		limit 1
	`, userID).Scan(
		&record.ID,
		&record.UserID,
		&record.TokenHash,
		&record.ExpiresAt,
		&record.UsedAt,
		&record.AttemptCount,
		&record.Email,
		&record.FullName,
		&record.IsEmailVerified,
		&record.Status,
	); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return verificationTokenRecord{}, false, nil
		}
		return verificationTokenRecord{}, false, fmt.Errorf("query active verification token: %w", err)
	}

	return record, true, nil
}

func (r *Repository) MarkVerificationTokenUsedTx(ctx context.Context, tx pgx.Tx, tokenID string, usedAt time.Time) error {
	if _, err := tx.Exec(ctx, `
		update email_verification_tokens
		set used_at = $2
		where id = $1
	`, tokenID, usedAt.UTC()); err != nil {
		return fmt.Errorf("mark verification token used: %w", err)
	}

	return nil
}

func (r *Repository) IncrementVerificationAttemptTx(ctx context.Context, tx pgx.Tx, tokenID string, attemptedAt time.Time) error {
	if _, err := tx.Exec(ctx, `
		update email_verification_tokens
		set
			attempt_count = attempt_count + 1,
			last_attempt_at = $2
		where id = $1
	`, tokenID, attemptedAt.UTC()); err != nil {
		return fmt.Errorf("increment verification attempts: %w", err)
	}

	return nil
}

func (r *Repository) MarkUserEmailVerifiedTx(ctx context.Context, tx pgx.Tx, userID string) error {
	if _, err := tx.Exec(ctx, `
		update users
		set
			is_email_verified = true,
			is_verified = true,
			status = $2,
			updated_at = now()
		where id = $1
	`, userID, UserStatusActive); err != nil {
		return fmt.Errorf("mark user email verified: %w", err)
	}

	return nil
}

func (r *Repository) DeleteVerificationToken(ctx context.Context, tokenHash string) error {
	if tokenHash == "" {
		return nil
	}

	if _, err := r.db.Exec(ctx, `
		delete from email_verification_tokens
		where token_hash = $1
	`, tokenHash); err != nil {
		return fmt.Errorf("delete verification token: %w", err)
	}

	return nil
}

func (r *Repository) InsertPasswordResetCodeTx(ctx context.Context, tx pgx.Tx, userID string, codeHash string, expiresAt time.Time) error {
	if _, err := tx.Exec(ctx, `
		insert into password_reset_codes (
			id,
			user_id,
			code_hash,
			expires_at,
			created_at
		)
		values ($1, $2, $3, $4, now())
	`, newID("reset_code"), userID, codeHash, expiresAt.UTC()); err != nil {
		return fmt.Errorf("insert password reset code: %w", err)
	}

	return nil
}

func (r *Repository) InvalidateUnusedPasswordResetCodesTx(ctx context.Context, tx pgx.Tx, userID string) error {
	if _, err := tx.Exec(ctx, `
		update password_reset_codes
		set used_at = now()
		where user_id = $1 and used_at is null
	`, userID); err != nil {
		return fmt.Errorf("invalidate password reset codes: %w", err)
	}

	return nil
}

func (r *Repository) PasswordResetSendWindowStateTx(ctx context.Context, tx pgx.Tx, userID string, since time.Time) (int, *time.Time, *time.Time, error) {
	var (
		count  int
		oldest *time.Time
		latest *time.Time
	)

	if err := tx.QueryRow(ctx, `
		select
			count(*),
			min(created_at),
			max(created_at)
		from password_reset_codes
		where user_id = $1 and created_at >= $2
	`, userID, since.UTC()).Scan(&count, &oldest, &latest); err != nil {
		return 0, nil, nil, fmt.Errorf("query password reset window state: %w", err)
	}

	return count, oldest, latest, nil
}

func (r *Repository) FindActivePasswordResetCodeTx(ctx context.Context, tx pgx.Tx, userID string) (passwordResetCodeRecord, bool, error) {
	var record passwordResetCodeRecord
	if err := tx.QueryRow(ctx, `
		select
			c.id,
			c.user_id,
			c.code_hash,
			c.expires_at,
			c.used_at,
			c.attempt_count,
			coalesce(u.email, ''),
			u.full_name,
			coalesce(u.is_email_verified, false),
			coalesce(u.status, 'active')
		from password_reset_codes c
		join users u on u.id = c.user_id
		where c.user_id = $1 and c.used_at is null
		order by c.created_at desc
		limit 1
	`, userID).Scan(
		&record.ID,
		&record.UserID,
		&record.CodeHash,
		&record.ExpiresAt,
		&record.UsedAt,
		&record.AttemptCount,
		&record.Email,
		&record.FullName,
		&record.IsEmailVerified,
		&record.Status,
	); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return passwordResetCodeRecord{}, false, nil
		}
		return passwordResetCodeRecord{}, false, fmt.Errorf("query password reset code: %w", err)
	}

	return record, true, nil
}

func (r *Repository) MarkPasswordResetCodeUsedTx(ctx context.Context, tx pgx.Tx, codeID string, usedAt time.Time) error {
	if _, err := tx.Exec(ctx, `
		update password_reset_codes
		set used_at = $2
		where id = $1
	`, codeID, usedAt.UTC()); err != nil {
		return fmt.Errorf("mark password reset code used: %w", err)
	}

	return nil
}

func (r *Repository) IncrementPasswordResetCodeAttemptTx(ctx context.Context, tx pgx.Tx, codeID string, attemptedAt time.Time) error {
	if _, err := tx.Exec(ctx, `
		update password_reset_codes
		set
			attempt_count = attempt_count + 1,
			last_attempt_at = $2
		where id = $1
	`, codeID, attemptedAt.UTC()); err != nil {
		return fmt.Errorf("increment password reset attempts: %w", err)
	}

	return nil
}

func (r *Repository) DeletePasswordResetCode(ctx context.Context, userID string, codeHash string) error {
	if userID == "" || codeHash == "" {
		return nil
	}

	if _, err := r.db.Exec(ctx, `
		delete from password_reset_codes
		where user_id = $1 and code_hash = $2
	`, userID, codeHash); err != nil {
		return fmt.Errorf("delete password reset code: %w", err)
	}

	return nil
}

func (r *Repository) UniqueUsernameTx(ctx context.Context, tx pgx.Tx, base string) (string, error) {
	candidate := sanitizeUsername(base)
	if candidate == "" {
		candidate = "macdriver"
	}
	if len(candidate) > maxUsernameLength {
		candidate = candidate[:maxUsernameLength]
	}

	for attempt := 0; attempt < 20; attempt++ {
		suffix := ""
		if attempt > 0 {
			suffix = strconv.Itoa(attempt + 1)
		}

		baseCandidate := candidate
		if len(baseCandidate)+len(suffix) > maxUsernameLength {
			baseCandidate = baseCandidate[:maxUsernameLength-len(suffix)]
		}
		nextCandidate := baseCandidate + suffix

		var exists bool
		if err := tx.QueryRow(ctx, `
			select exists(
				select 1
				from users
				where lower(username) = lower($1)
			)
	`, nextCandidate).Scan(&exists); err != nil {
			return "", fmt.Errorf("check username exists: %w", err)
		}

		if !exists {
			return nextCandidate, nil
		}
	}

	suffix := strconv.FormatInt(time.Now().Unix()%100000, 10)
	baseCandidate := candidate
	if len(baseCandidate)+len(suffix) > maxUsernameLength {
		baseCandidate = baseCandidate[:maxUsernameLength-len(suffix)]
	}

	return baseCandidate + suffix, nil
}

func (r *Repository) UsernameTakenTx(ctx context.Context, tx pgx.Tx, username string, excludedUserID string) (bool, error) {
	normalized := strings.ToLower(strings.TrimSpace(username))
	if normalized == "" {
		return false, nil
	}

	query := `
		select exists(
			select 1
			from users
			where lower(username) = $1
		)
	`
	args := []any{normalized}
	if strings.TrimSpace(excludedUserID) != "" {
		query = `
			select exists(
				select 1
				from users
				where lower(username) = $1 and id <> $2
			)
		`
		args = append(args, strings.TrimSpace(excludedUserID))
	}

	var exists bool
	if err := tx.QueryRow(ctx, query, args...).Scan(&exists); err != nil {
		return false, fmt.Errorf("check username availability: %w", err)
	}
	return exists, nil
}

func (r *Repository) UsernameTaken(ctx context.Context, username string) (bool, error) {
	normalized := strings.ToLower(strings.TrimSpace(username))
	if normalized == "" {
		return false, nil
	}

	var exists bool
	if err := r.db.QueryRow(ctx, `
		select exists(
			select 1
			from users
			where lower(username) = $1
		)
	`, normalized).Scan(&exists); err != nil {
		return false, fmt.Errorf("check username availability: %w", err)
	}
	return exists, nil
}

func (r *Repository) UpsertSocialUserTx(ctx context.Context, tx pgx.Tx, existing *userRecord, input SocialLoginInput) (userRecord, error) {
	if existing == nil {
		username, err := r.UniqueUsernameTx(ctx, tx, input.Username)
		if err != nil {
			return userRecord{}, err
		}

		record := userRecord{
			AuthProvider:    input.Provider,
			AvatarURL:       input.AvatarURL,
			Bio:             "",
			City:            input.City,
			Email:           input.Email,
			FavoriteCar:     defaultFavoriteCar(input.Provider),
			FullName:        input.FullName,
			HeroTagline:     defaultHeroTagline(input.FullName),
			ID:              newID("user"),
			IsEmailVerified: true,
			IsVerified:      true,
			Status:          UserStatusActive,
			Username:        username,
		}

		if _, err := tx.Exec(ctx, `
			insert into users (
				id,
				username,
				full_name,
				email,
				avatar_url,
				bio,
				city,
				favorite_car,
				hero_tagline,
				auth_provider,
				is_verified,
				is_email_verified,
				is_private_account,
				status,
				created_at,
				updated_at
			)
			values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, true, true, false, $11, now(), now())
		`, record.ID, record.Username, record.FullName, record.Email, record.AvatarURL, record.Bio,
			record.City, record.FavoriteCar, record.HeroTagline, record.AuthProvider, record.Status); err != nil {
			if isUniqueViolation(err) {
				return userRecord{}, emailInUseError()
			}
			return userRecord{}, fmt.Errorf("insert social user: %w", err)
		}

		return record, nil
	}

	if _, err := tx.Exec(ctx, `
		update users
		set
			full_name = coalesce(nullif($2, ''), full_name),
			avatar_url = coalesce(nullif($3, ''), avatar_url),
			city = coalesce(nullif($4, ''), city),
			auth_provider = $5,
			is_email_verified = true,
			status = $6,
			updated_at = now()
		where id = $1
	`, existing.ID, input.FullName, input.AvatarURL, input.City, input.Provider, UserStatusActive); err != nil {
		return userRecord{}, fmt.Errorf("update social user: %w", err)
	}

	existing.AuthProvider = input.Provider
	existing.AvatarURL = input.AvatarURL
	existing.City = input.City
	existing.FullName = input.FullName
	existing.IsEmailVerified = true
	existing.Status = UserStatusActive

	return *existing, nil
}

func (r *Repository) InsertSessionTx(ctx context.Context, tx pgx.Tx, sessionID string, userID string, provider string, tokenHash string, expiresAt time.Time) error {
	if _, err := tx.Exec(ctx, `
		insert into auth_sessions (id, user_id, provider, token_hash, expires_at, last_used_at)
		values ($1, $2, $3, $4, $5, now())
	`, sessionID, userID, provider, tokenHash, expiresAt.UTC()); err != nil {
		return fmt.Errorf("insert session: %w", err)
	}

	if _, err := tx.Exec(ctx, `
		update users
		set last_login_at = now(), updated_at = now()
		where id = $1
	`, userID); err != nil {
		return fmt.Errorf("touch user login: %w", err)
	}

	return nil
}

func (r *Repository) FindSessionIdentity(ctx context.Context, identity SessionIdentity, tokenHash string) (SessionIdentity, error) {
	var result SessionIdentity
	if err := r.db.QueryRow(ctx, `
		select s.user_id, s.provider, s.expires_at, s.id
		from auth_sessions s
		join users u on u.id = s.user_id
		where
			s.id = $1
			and s.user_id = $2
			and s.token_hash = $3
			and s.expires_at > now()
			and coalesce(u.status, 'active') = 'active'
	`, identity.SessionID, identity.UserID, tokenHash).Scan(&result.UserID, &result.Provider, &result.ExpiresAt, &result.SessionID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return SessionIdentity{}, unauthorizedError()
		}
		return SessionIdentity{}, fmt.Errorf("query session identity: %w", err)
	}

	return result, nil
}

func (r *Repository) TouchSession(ctx context.Context, sessionID string) error {
	cutoff := time.Now().UTC().Add(-sessionTouchInterval)
	if _, err := r.db.Exec(ctx, `
		update auth_sessions
		set last_used_at = now()
		where id = $1 and last_used_at < $2
	`, sessionID, cutoff); err != nil {
		return fmt.Errorf("touch session: %w", err)
	}

	return nil
}

func (r *Repository) DeleteSession(ctx context.Context, sessionID string, tokenHash string) error {
	if sessionID == "" && tokenHash == "" {
		return nil
	}

	if _, err := r.db.Exec(ctx, `
		delete from auth_sessions
		where ($1 <> '' and id = $1) or ($2 <> '' and token_hash = $2)
	`, sessionID, tokenHash); err != nil {
		return fmt.Errorf("delete session: %w", err)
	}

	return nil
}

func (r *Repository) DeleteSessionsByUserTx(ctx context.Context, tx pgx.Tx, userID string, exceptSessionID string) error {
	if _, err := tx.Exec(ctx, `
		delete from auth_sessions
		where user_id = $1 and ($2 = '' or id <> $2)
	`, userID, strings.TrimSpace(exceptSessionID)); err != nil {
		return fmt.Errorf("delete user sessions: %w", err)
	}

	return nil
}

func (r *Repository) DeleteLoginAttemptsByEmailTx(ctx context.Context, tx pgx.Tx, email string) error {
	normalizedEmail := strings.ToLower(strings.TrimSpace(email))
	if normalizedEmail == "" {
		return nil
	}

	if _, err := tx.Exec(ctx, `
		delete from auth_login_attempts
		where lower(email) = $1
	`, normalizedEmail); err != nil {
		return fmt.Errorf("delete login attempts by email: %w", err)
	}

	return nil
}

func (r *Repository) DeleteUserByIDTx(ctx context.Context, tx pgx.Tx, userID string) error {
	userID = strings.TrimSpace(userID)
	if userID == "" {
		return fmt.Errorf("delete user: user id is required")
	}

	command, err := tx.Exec(ctx, `
		delete from users
		where id = $1
	`, userID)
	if err != nil {
		return fmt.Errorf("delete user: %w", err)
	}
	if command.RowsAffected() == 0 {
		return profileNotFoundError()
	}

	return nil
}

func (r *Repository) RecordLoginAttempt(ctx context.Context, email string, ipAddress string, successful bool) error {
	if _, err := r.db.Exec(ctx, `
		insert into auth_login_attempts (id, email, ip_address, successful, created_at)
		values ($1, $2, $3, $4, now())
	`, newID("login_attempt"), strings.ToLower(strings.TrimSpace(email)), strings.TrimSpace(ipAddress), successful); err != nil {
		return fmt.Errorf("record login attempt: %w", err)
	}

	return nil
}

func (r *Repository) FailedLoginAttemptState(ctx context.Context, email string, ipAddress string, since time.Time) (int, *time.Time, error) {
	var count int
	var oldest *time.Time
	if err := r.db.QueryRow(ctx, `
		select
			count(*),
			min(created_at)
		from auth_login_attempts
		where
			successful = false
			and created_at >= $3
			and (
				lower(email) = $1
				or ($2 <> '' and ip_address = $2)
			)
	`, strings.ToLower(strings.TrimSpace(email)), strings.TrimSpace(ipAddress), since.UTC()).Scan(&count, &oldest); err != nil {
		return 0, nil, fmt.Errorf("query login attempts: %w", err)
	}

	return count, oldest, nil
}

func (r *Repository) ProfileByID(ctx context.Context, userID string) (Profile, error) {
	var profile Profile
	if err := r.db.QueryRow(ctx, `
		select
			u.id,
			u.username,
			u.full_name,
			coalesce(u.email, ''),
			coalesce(u.password_hash, '') <> '',
			u.avatar_url,
			'' as bio,
			case when coalesce(u.birth_year, 0) = 2000 then 0 else coalesce(u.birth_year, 0) end,
			u.city,
			u.favorite_car,
			u.hero_tagline,
			coalesce(u.phone, ''),
			coalesce(u.phone_dial_code, '90'),
			u.auth_provider,
			u.is_verified,
			coalesce(u.is_email_verified, false),
			coalesce(u.status, 'active'),
			u.created_at,
			coalesce(u.last_login_at, u.created_at),
			coalesce(u.is_private_account, false),
			coalesce(u.is_map_visible, true),
			(select count(*) from follows f where f.followed_user_id = u.id) as followers_count,
			(select count(*) from follows f where f.follower_id = u.id) as following_count,
			(select count(*) from posts p where p.user_id = u.id and p.is_live = true) as routes_count,
			(
				select count(*)
				from street_friendships sf
				where sf.status = 'accepted' and (sf.user_a_id = u.id or sf.user_b_id = u.id)
			) as street_friends_count
		from users u
		where u.id = $1
	`, userID).Scan(
		&profile.ID,
		&profile.Username,
		&profile.FullName,
		&profile.Email,
		&profile.HasPassword,
		&profile.AvatarURL,
		&profile.Bio,
		&profile.BirthYear,
		&profile.City,
		&profile.FavoriteCar,
		&profile.HeroTagline,
		&profile.Phone,
		&profile.PhoneDialCode,
		&profile.AuthProvider,
		&profile.IsVerified,
		&profile.IsEmailVerified,
		&profile.Status,
		&profile.CreatedAt,
		&profile.LastLoginAt,
		&profile.Privacy.IsPrivateAccount,
		&profile.Privacy.IsMapVisible,
		&profile.Stats.FollowersCount,
		&profile.Stats.FollowingCount,
		&profile.Stats.RoutesCount,
		&profile.Stats.StreetFriendsCount,
	); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Profile{}, unauthorizedError()
		}
		return Profile{}, fmt.Errorf("query profile: %w", err)
	}

	return profile, nil
}

func (r *Repository) PublicProfileByID(
	ctx context.Context,
	viewerID string,
	targetUserID string,
) (PublicProfile, error) {
	var (
		followRequestedBy string
		profile           PublicProfile
	)

	if err := r.db.QueryRow(ctx, `
		select
			u.id,
			u.username,
			coalesce(u.full_name, ''),
			u.avatar_url,
			'' as bio,
			case when coalesce(u.birth_year, 0) = 2000 then 0 else coalesce(u.birth_year, 0) end,
			u.is_verified,
			coalesce(u.is_private_account, false),
			(select count(*) from follows f where f.followed_user_id = u.id) as followers_count,
			(select count(*) from follows f where f.follower_id = u.id) as following_count,
			(select count(*) from posts p where p.user_id = u.id and p.is_live = true) as routes_count,
			(
				select count(*)
				from street_friendships sf
				where sf.status = 'accepted' and (sf.user_a_id = u.id or sf.user_b_id = u.id)
			) as street_friends_count,
			exists(
				select 1
				from follows f
				where f.follower_id = $1 and f.followed_user_id = u.id
			) as is_following,
			exists(
				select 1
				from follows f
				where f.follower_id = u.id and f.followed_user_id = $1
			) as follows_you,
			coalesce((
				select fr.requester_id
				from follow_requests fr
				where
					(fr.requester_id = $1 and fr.target_user_id = u.id)
					or (fr.requester_id = u.id and fr.target_user_id = $1)
				order by case when fr.requester_id = $1 then 0 else 1 end
				limit 1
			), '') as follow_requested_by,
			exists(
				select 1
				from blocked_users b
				where b.blocker_id = $1 and b.blocked_user_id = u.id
			) as is_blocked_by_viewer,
			exists(
				select 1
				from blocked_users b
				where b.blocker_id = u.id and b.blocked_user_id = $1
			) as is_blocked_by_target
		from users u
		where u.id = $2
	`, viewerID, targetUserID).Scan(
		&profile.ID,
		&profile.Username,
		&profile.FullName,
		&profile.AvatarURL,
		&profile.Bio,
		&profile.BirthYear,
		&profile.IsVerified,
		&profile.IsPrivateAccount,
		&profile.Stats.FollowersCount,
		&profile.Stats.FollowingCount,
		&profile.Stats.RoutesCount,
		&profile.Stats.StreetFriendsCount,
		&profile.ViewerState.IsFollowing,
		&profile.ViewerState.FollowsYou,
		&followRequestedBy,
		&profile.ViewerState.IsBlockedByViewer,
		&profile.ViewerState.IsBlockedByTarget,
	); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return PublicProfile{}, profileNotFoundError()
		}
		return PublicProfile{}, fmt.Errorf("query public profile: %w", err)
	}

	profile.ViewerState.FollowRequestStatus = viewerFollowRequestState(
		profile.ViewerState.IsFollowing,
		followRequestedBy,
		viewerID,
	)
	// Instagram-style: if they blocked you, the profile is unavailable.
	if profile.ViewerState.IsBlockedByTarget {
		return PublicProfile{}, profileNotFoundError()
	}
	// You blocked them: return a restricted shell so the client can unblock in-context.
	if profile.ViewerState.IsBlockedByViewer {
		profile = sanitizePublicProfileBlockedByViewer(profile)
	}

	return profile, nil
}

func sanitizePublicProfileBlockedByViewer(profile PublicProfile) PublicProfile {
	profile.Bio = ""
	profile.FullName = ""
	profile.IsPrivateAccount = true
	profile.Stats = ProfileStats{}
	profile.ViewerState.IsFollowing = false
	profile.ViewerState.FollowsYou = false
	profile.ViewerState.FollowRequestStatus = FollowRequestStatusNone
	profile.ViewerState.IsBlockedByTarget = false
	profile.ViewerState.IsBlockedByViewer = true
	return profile
}

func (r *Repository) ReportUser(
	ctx context.Context,
	viewerID string,
	reportedUserID string,
	reason string,
) (UserReportResponse, error) {
	viewerID = strings.TrimSpace(viewerID)
	reportedUserID = strings.TrimSpace(reportedUserID)
	if viewerID == "" || reportedUserID == "" {
		return UserReportResponse{}, validationError(errors.New("user id is invalid"))
	}
	if viewerID == reportedUserID {
		return UserReportResponse{}, validationError(errors.New("cannot report yourself"))
	}

	_, exists, err := r.FindUserByID(ctx, reportedUserID)
	if err != nil {
		return UserReportResponse{}, err
	}
	if !exists {
		return UserReportResponse{}, profileNotFoundError()
	}

	normalizedReason := strings.TrimSpace(reason)
	if normalizedReason == "" {
		normalizedReason = "other"
	}
	if len(normalizedReason) > 120 {
		normalizedReason = normalizedReason[:120]
	}

	reportedAt := time.Now().UTC()
	if err := r.db.QueryRow(ctx, `
		insert into user_reports (
			viewer_id,
			reported_user_id,
			reason,
			created_at,
			updated_at
		)
		values ($1, $2, $3, $4, $4)
		on conflict (viewer_id, reported_user_id)
		do update set
			reason = excluded.reason,
			updated_at = excluded.updated_at
		returning updated_at
	`, viewerID, reportedUserID, normalizedReason, reportedAt).Scan(&reportedAt); err != nil {
		return UserReportResponse{}, fmt.Errorf("upsert user report: %w", err)
	}

	return UserReportResponse{
		Reason:           normalizedReason,
		ReportedAt:       reportedAt,
		ReportedUserID:   reportedUserID,
	}, nil
}

func (r *Repository) PrivacySettingsByUserID(ctx context.Context, userID string) (PrivacySettings, error) {
	var settings PrivacySettings
	if err := r.db.QueryRow(ctx, `
		select
			coalesce(is_private_account, false),
			coalesce(is_map_visible, true)
		from users
		where id = $1
	`, userID).Scan(
		&settings.IsPrivateAccount,
		&settings.IsMapVisible,
	); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return PrivacySettings{}, unauthorizedError()
		}
		return PrivacySettings{}, fmt.Errorf("query privacy settings: %w", err)
	}

	return settings, nil
}

func (r *Repository) UpdatePrivacySettings(
	ctx context.Context,
	userID string,
	input UpdatePrivacySettingsInput,
) (PrivacySettings, error) {
	tx, err := r.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return PrivacySettings{}, fmt.Errorf("begin update privacy settings tx: %w", err)
	}
	defer tx.Rollback(ctx)

	var settings PrivacySettings
	if err := tx.QueryRow(ctx, `
		update users
		set
			is_private_account = coalesce($2, is_private_account),
			is_map_visible = coalesce($3, is_map_visible),
			updated_at = now()
		where id = $1
		returning
			coalesce(is_private_account, false),
			coalesce(is_map_visible, true)
	`, userID, input.IsPrivateAccount, input.IsMapVisible).Scan(
		&settings.IsPrivateAccount,
		&settings.IsMapVisible,
	); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return PrivacySettings{}, unauthorizedError()
		}
		return PrivacySettings{}, fmt.Errorf("update privacy settings: %w", err)
	}

	shouldPromotePendingRequests := input.IsPrivateAccount != nil && !*input.IsPrivateAccount
	if shouldPromotePendingRequests {
		if _, err := tx.Exec(ctx, `
			insert into follows (follower_id, followed_user_id)
			select fr.requester_id, fr.target_user_id
			from follow_requests fr
			where fr.target_user_id = $1
			on conflict do nothing
		`, userID); err != nil {
			return PrivacySettings{}, fmt.Errorf("promote follow requests to follows: %w", err)
		}

		if _, err := tx.Exec(ctx, `
			delete from follow_requests
			where target_user_id = $1
		`, userID); err != nil {
			return PrivacySettings{}, fmt.Errorf("clear follow requests after opening account: %w", err)
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return PrivacySettings{}, fmt.Errorf("commit update privacy settings tx: %w", err)
	}

	return settings, nil
}

func (r *Repository) MapPreferencesByUserID(ctx context.Context, userID string) (MapPreferences, error) {
	var preferences MapPreferences
	if err := r.db.QueryRow(ctx, `
		select
			coalesce(p.map_filter_mode, 'street_friends'),
			coalesce(p.map_theme_mode, 'dark'),
			coalesce(p.show_local_layer, true),
			coalesce(p.show_remote_layer, true),
			coalesce(p.tracking_enabled, true),
			coalesce(p.updated_at, now())
		from users u
		left join user_map_preferences p on p.user_id = u.id
		where u.id = $1
	`, userID).Scan(
		&preferences.MapFilterMode,
		&preferences.MapThemeMode,
		&preferences.ShowLocalLayer,
		&preferences.ShowRemoteLayer,
		&preferences.TrackingEnabled,
		&preferences.UpdatedAt,
	); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return MapPreferences{}, unauthorizedError()
		}
		return MapPreferences{}, fmt.Errorf("query map preferences: %w", err)
	}

	preferences.MapFilterMode = NormalizeMapFilterMode(preferences.MapFilterMode)
	preferences.MapThemeMode = NormalizeMapThemeMode(preferences.MapThemeMode)

	return preferences, nil
}

func (r *Repository) UpdateMapPreferences(
	ctx context.Context,
	userID string,
	input UpdateMapPreferencesInput,
) (MapPreferences, error) {
	// Partial JSON updates send SQL NULL for omitted fields. Plain INSERT ... VALUES
	// would write NULL into NOT NULL columns; merge with existing row (or defaults) first.
	if _, err := r.db.Exec(ctx, `
		insert into user_map_preferences (
			user_id,
			map_filter_mode,
			map_theme_mode,
			show_local_layer,
			show_remote_layer,
			tracking_enabled,
			created_at,
			updated_at
		)
		select
			$1,
			coalesce($2::text, p.map_filter_mode, 'street_friends'),
			coalesce($3::text, p.map_theme_mode, 'dark'),
			coalesce($4, p.show_local_layer, true),
			coalesce($5, p.show_remote_layer, true),
			coalesce($6, p.tracking_enabled, true),
			now(),
			now()
		from (select $1::text as uid) as keys
		left join user_map_preferences p on p.user_id = keys.uid
		on conflict (user_id) do update
		set
			map_filter_mode = excluded.map_filter_mode,
			map_theme_mode = excluded.map_theme_mode,
			show_local_layer = excluded.show_local_layer,
			show_remote_layer = excluded.show_remote_layer,
			tracking_enabled = excluded.tracking_enabled,
			updated_at = now()
	`, userID, input.MapFilterMode, input.MapThemeMode, input.ShowLocalLayer, input.ShowRemoteLayer, input.TrackingEnabled); err != nil {
		return MapPreferences{}, fmt.Errorf("update map preferences: %w", err)
	}

	return r.MapPreferencesByUserID(ctx, userID)
}

func (r *Repository) ProfileAppSettingsByUserID(
	ctx context.Context,
	userID string,
) (ProfileAppSettings, error) {
	var settings ProfileAppSettings
	if err := r.db.QueryRow(ctx, `
		select
			coalesce(p.notify_follow_requests, true),
			coalesce(p.notify_messages, true),
			coalesce(p.notify_post_likes, true),
			coalesce(p.only_followed_users_can_message, false),
			coalesce(p.language, 'tr'),
			coalesce(p.gender, 'prefer_not_to_say'),
			coalesce(p.updated_at, now())
		from users u
		left join user_profile_app_settings p on p.user_id = u.id
		where u.id = $1
	`, userID).Scan(
		&settings.NotifyFollowRequests,
		&settings.NotifyMessages,
		&settings.NotifyPostLikes,
		&settings.OnlyFollowedUsersCanMessage,
		&settings.Language,
		&settings.Gender,
		&settings.UpdatedAt,
	); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ProfileAppSettings{}, unauthorizedError()
		}
		return ProfileAppSettings{}, fmt.Errorf("query profile app settings: %w", err)
	}

	settings.Language = NormalizeAppLanguage(settings.Language)
	settings.Gender = NormalizeProfileGender(settings.Gender)
	return settings, nil
}

func (r *Repository) UpdateProfileAppSettings(
	ctx context.Context,
	userID string,
	input UpdateProfileAppSettingsInput,
) (ProfileAppSettings, error) {
	if _, err := r.db.Exec(ctx, `
		insert into user_profile_app_settings (
			user_id,
			notify_follow_requests,
			notify_messages,
			notify_post_likes,
			only_followed_users_can_message,
			language,
			gender,
			created_at,
			updated_at
		)
		values (
			$1,
			coalesce($2::boolean, true),
			coalesce($3::boolean, true),
			coalesce($4::boolean, true),
			coalesce($5::boolean, false),
			coalesce($6::text, 'tr'),
			coalesce($7::text, 'prefer_not_to_say'),
			now(),
			now()
		)
		on conflict (user_id) do update
		set
			notify_follow_requests = coalesce($2::boolean, user_profile_app_settings.notify_follow_requests, true),
			notify_messages = coalesce($3::boolean, user_profile_app_settings.notify_messages, true),
			notify_post_likes = coalesce($4::boolean, user_profile_app_settings.notify_post_likes, true),
			only_followed_users_can_message = coalesce($5::boolean, user_profile_app_settings.only_followed_users_can_message, false),
			language = coalesce($6::text, user_profile_app_settings.language, 'tr'),
			gender = coalesce($7::text, user_profile_app_settings.gender, 'prefer_not_to_say'),
			updated_at = now()
	`,
		userID,
		input.NotifyFollowRequests,
		input.NotifyMessages,
		input.NotifyPostLikes,
		input.OnlyFollowedUsersCanMessage,
		input.Language,
		input.Gender,
	); err != nil {
		return ProfileAppSettings{}, fmt.Errorf("update profile app settings: %w", err)
	}

	return r.ProfileAppSettingsByUserID(ctx, userID)
}

func (r *Repository) ProfileRequestSummaryByUserID(
	ctx context.Context,
	userID string,
) (ProfileRequestSummary, error) {
	var summary ProfileRequestSummary
	// Check if profile_notifications table exists
	var tableExists bool
	_ = r.db.QueryRow(ctx, "SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'profile_notifications')").Scan(&tableExists)

	query := `
		select
			coalesce((
				select count(*)::bigint
				from follow_requests fr
				join users u2 on u2.id = fr.target_user_id
				where
					fr.target_user_id = u.id
					and coalesce(u2.is_private_account, false) = true
					and not exists (
						select 1
						from blocked_users b
						where
							(b.blocker_id = u.id and b.blocked_user_id = fr.requester_id)
							or (b.blocker_id = fr.requester_id and b.blocked_user_id = u.id)
					)
			), 0::bigint),
			coalesce((
				select count(*)::bigint
				from street_friendships sf
				where
					sf.status = 'pending'
					and (sf.user_a_id = u.id or sf.user_b_id = u.id)
					and coalesce(sf.requested_by, '') <> ''
					and sf.requested_by <> u.id
					and not exists (
						select 1
						from blocked_users b
						where
							(
								b.blocker_id = u.id
								and b.blocked_user_id = case
									when sf.user_a_id = u.id then sf.user_b_id
									else sf.user_a_id
								end
							)
							or (
								b.blocker_id = case
									when sf.user_a_id = u.id then sf.user_b_id
									else sf.user_a_id
								end
								and b.blocked_user_id = u.id
							)
					)
			), 0::bigint),
			coalesce((
				select count(*)::bigint
				from direct_conversations dc
				join direct_messages dm on dm.conversation_id = dc.id
				left join direct_conversation_reads dcr
					on dcr.conversation_id = dc.id
					and dcr.user_id = u.id
				where
					(dc.user_a_id = u.id or dc.user_b_id = u.id)
					and dm.sender_id <> u.id
					and dm.created_at > coalesce(dcr.last_read_at, 'epoch'::timestamptz)
			), 0::bigint),
`
	if tableExists {
		query += `
			coalesce((
				select count(*)::bigint
				from profile_notifications
				where recipient_id = u.id and is_read = false
			), 0::bigint),
`
	} else {
		query += `0::bigint, `
	}

	query += `
			now()
		from users u
		where u.id = $1
`

	if err := r.db.QueryRow(ctx, query, userID).Scan(
		&summary.FollowRequestsCount,
		&summary.StreetRequestsCount,
		&summary.MessagesUnreadCount,
		&summary.NotificationsUnreadCount,
		&summary.UpdatedAt,
	); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ProfileRequestSummary{}, unauthorizedError()
		}
		return ProfileRequestSummary{}, fmt.Errorf("query profile request summary: %w", err)
	}

	// Request summary total remains follow + street + notification counts for professional UX.
	summary.TotalCount = summary.FollowRequestsCount + summary.StreetRequestsCount + summary.NotificationsUnreadCount
	return summary, nil
}

func normalizeProfileNotificationCategory(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "messages", "requests", "social":
		return strings.ToLower(strings.TrimSpace(value))
	default:
		return "all"
	}
}

func profileNotificationCategoryPredicate(alias string, category string) string {
	prefix := strings.TrimSpace(alias)
	if prefix != "" {
		prefix += "."
	}

	switch normalizeProfileNotificationCategory(category) {
	case "messages":
		return fmt.Sprintf(" and (%schannel = 'messages' or %stype = 'message')", prefix, prefix)
	case "requests":
		return fmt.Sprintf(
			" and (%schannel = 'follow_requests' or %stype in ('follow_request', 'follow.request.created', 'street_friend_request', 'street_friend.request.created'))",
			prefix,
			prefix,
		)
	case "social":
		return fmt.Sprintf(
			" and coalesce(%schannel, '') <> 'messages' and coalesce(%stype, '') <> 'message' and coalesce(%schannel, '') <> 'follow_requests' and coalesce(%stype, '') not in ('follow_request', 'follow.request.created', 'street_friend_request', 'street_friend.request.created')",
			prefix,
			prefix,
			prefix,
			prefix,
		)
	default:
		return ""
	}
}

func profileNotificationMetadataString(metadata map[string]any, key string) string {
	if metadata == nil {
		return ""
	}
	value, ok := metadata[key]
	if !ok || value == nil {
		return ""
	}
	switch typed := value.(type) {
	case string:
		return strings.TrimSpace(typed)
	case fmt.Stringer:
		return strings.TrimSpace(typed.String())
	default:
		return strings.TrimSpace(fmt.Sprint(typed))
	}
}

func hydrateProfileNotificationDerivedFields(item *ProfileNotificationItem) {
	if item == nil {
		return
	}
	if item.ActorID != nil && strings.TrimSpace(*item.ActorID) != "" {
		item.FromUserID = strings.TrimSpace(*item.ActorID)
	}
	item.ConversationID = profileNotificationMetadataString(item.Metadata, "conversationId")
	item.MessageID = profileNotificationMetadataString(item.Metadata, "messageId")
	item.PostID = profileNotificationMetadataString(item.Metadata, "postId")
}

func (r *Repository) ListProfileNotifications(
	ctx context.Context,
	userID string,
	category string,
	cursor string,
	limit int,
	offset int,
) (ProfileNotificationsResponse, error) {
	if limit <= 0 {
		limit = 30
	}
	if limit > 60 {
		limit = 60
	}
	category = normalizeProfileNotificationCategory(category)
	cursor = strings.TrimSpace(cursor)
	if cursor != "" {
		offset = 0
	}
	pageLimit := limit + 1

	whereSQL := "where n.recipient_id = $1"
	whereSQL += profileNotificationCategoryPredicate("n", category)
	whereSQL += `
		and (
			$2::text = ''
			or n.created_at < coalesce((
				select cursor_n.created_at
				from profile_notifications cursor_n
				where cursor_n.id = $2 and cursor_n.recipient_id = $1
			), now())
			or (
				n.created_at = coalesce((
					select cursor_n.created_at
					from profile_notifications cursor_n
					where cursor_n.id = $2 and cursor_n.recipient_id = $1
				), now())
				and n.id < $2
			)
		)
	`

	rows, err := r.db.Query(ctx, fmt.Sprintf(`
		select
			n.id,
			n.recipient_id,
			n.actor_id,
			u.username as actor_username,
			u.avatar_url as actor_avatar_url,
			u.full_name as actor_full_name,
			coalesce(n.title, ''),
			coalesce(n.body, ''),
			coalesce(n.type, ''),
			coalesce(n.channel, 'activity'),
			coalesce(n.metadata, '{}'::jsonb),
			n.is_read,
			n.created_at,
			coalesce(n.updated_at, n.created_at)
		from profile_notifications n
		left join users u on u.id = n.actor_id
		%s
		order by n.created_at desc, n.id desc
		limit $3 offset $4
	`, whereSQL), userID, cursor, pageLimit, offset)
	if err != nil {
		return ProfileNotificationsResponse{}, fmt.Errorf("query profile notifications: %w", err)
	}
	defer rows.Close()

	notifications := make([]ProfileNotificationItem, 0, pageLimit)
	for rows.Next() {
		var item ProfileNotificationItem
		var updatedAt time.Time
		if err := rows.Scan(
			&item.ID,
			&item.RecipientID,
			&item.ActorID,
			&item.ActorUsername,
			&item.ActorAvatarURL,
			&item.ActorFullName,
			&item.Title,
			&item.Body,
			&item.Type,
			&item.Channel,
			&item.Metadata,
			&item.IsRead,
			&item.CreatedAt,
			&updatedAt,
		); err != nil {
			return ProfileNotificationsResponse{}, fmt.Errorf("scan notification row: %w", err)
		}
		normalizedUpdatedAt := updatedAt.UTC()
		item.UpdatedAt = &normalizedUpdatedAt
		hydrateProfileNotificationDerivedFields(&item)
		notifications = append(notifications, item)
	}

	hasMore := len(notifications) > limit
	if hasMore {
		notifications = notifications[:limit]
	}
	nextCursor := ""
	if hasMore && len(notifications) > 0 {
		nextCursor = notifications[len(notifications)-1].ID
	}

	var total, unread int
	countWhereSQL := "where n.recipient_id = $1"
	countWhereSQL += profileNotificationCategoryPredicate("n", category)
	if err := r.db.QueryRow(ctx, fmt.Sprintf(`
		select
			count(*),
			count(*) filter (where is_read = false)
		from profile_notifications n
		%s
	`, countWhereSQL), userID).Scan(&total, &unread); err != nil {
		return ProfileNotificationsResponse{}, fmt.Errorf("query notification counts: %w", err)
	}

	return ProfileNotificationsResponse{
		Category:      category,
		Cursor:        cursor,
		Notifications: notifications,
		HasMore:       hasMore,
		NextCursor:    nextCursor,
		Total:         total,
		TotalCount:    total,
		UnreadCount:   unread,
		UpdatedAt:     time.Now().UTC(),
	}, nil
}

func (r *Repository) MarkNotificationsRead(
	ctx context.Context,
	userID string,
	input MarkNotificationsReadInput,
	now time.Time,
) (MarkNotificationsReadResponse, error) {
	updatedCount := int64(0)
	category := normalizeProfileNotificationCategory(input.Category)
	categorySQL := profileNotificationCategoryPredicate("n", category)
	if input.All {
		tag, err := r.db.Exec(ctx, fmt.Sprintf(`
			update profile_notifications n
			set is_read = true, updated_at = $2
			where n.recipient_id = $1 and n.is_read = false
			%s
		`, categorySQL), userID, now.UTC())
		if err != nil {
			return MarkNotificationsReadResponse{}, fmt.Errorf("mark all notifications read: %w", err)
		}
		updatedCount = tag.RowsAffected()
	} else if len(input.IDs) > 0 {
		tag, err := r.db.Exec(ctx, fmt.Sprintf(`
			update profile_notifications n
			set is_read = true, updated_at = $3
			where n.recipient_id = $1 and n.id = any($2) and n.is_read = false
			%s
		`, categorySQL), userID, input.IDs, now.UTC())
		if err != nil {
			return MarkNotificationsReadResponse{}, fmt.Errorf("mark specific notifications read: %w", err)
		}
		updatedCount = tag.RowsAffected()
	}

	var unreadCount int
	if err := r.db.QueryRow(ctx, `
		select count(*)
		from profile_notifications
		where recipient_id = $1 and is_read = false
	`, userID).Scan(&unreadCount); err != nil {
		return MarkNotificationsReadResponse{}, fmt.Errorf("query unread notifications count: %w", err)
	}

	return MarkNotificationsReadResponse{
		ReadAt:       now.UTC(),
		UnreadCount:  unreadCount,
		UpdatedCount: int(updatedCount),
		UserID:       userID,
	}, nil
}

func (r *Repository) ListFollowRequests(
	ctx context.Context,
	userID string,
) (FollowRequestListResponse, error) {
	rows, err := r.db.Query(ctx, `
		select
			u.id,
			u.username,
			coalesce(u.full_name, ''),
			u.avatar_url,
			u.is_verified,
			fr.created_at
		from follow_requests fr
		join users u on u.id = fr.requester_id
		where
			fr.target_user_id = $1
			and exists (
				select 1
				from users owner
				where
					owner.id = fr.target_user_id
					and coalesce(owner.is_private_account, false) = true
			)
			and not exists (
				select 1
				from blocked_users b
				where
					(b.blocker_id = $1 and b.blocked_user_id = fr.requester_id)
					or (b.blocker_id = fr.requester_id and b.blocked_user_id = $1)
			)
		order by fr.created_at desc
	`, userID)
	if err != nil {
		return FollowRequestListResponse{}, fmt.Errorf("query follow requests: %w", err)
	}
	defer rows.Close()

	requests := make([]FollowRequestItem, 0, 12)
	for rows.Next() {
		var item FollowRequestItem
		if err := rows.Scan(
			&item.ID,
			&item.Username,
			&item.FullName,
			&item.AvatarURL,
			&item.IsVerified,
			&item.RequestedAt,
		); err != nil {
			return FollowRequestListResponse{}, fmt.Errorf("scan follow request row: %w", err)
		}

		requests = append(requests, item)
	}

	if rows.Err() != nil {
		return FollowRequestListResponse{}, fmt.Errorf("iterate follow requests: %w", rows.Err())
	}

	return FollowRequestListResponse{
		Requests: requests,
	}, nil
}

func (r *Repository) ResolveFollowRequest(
	ctx context.Context,
	userID string,
	requesterID string,
	accept bool,
) (FollowRequestDecisionResponse, error) {
	tx, err := r.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return FollowRequestDecisionResponse{}, fmt.Errorf("begin resolve follow request tx: %w", err)
	}
	defer tx.Rollback(ctx)

	var exists bool
	if err := tx.QueryRow(ctx, `
		select exists(
			select 1
			from follow_requests
			where requester_id = $1 and target_user_id = $2
		)
	`, requesterID, userID).Scan(&exists); err != nil {
		return FollowRequestDecisionResponse{}, fmt.Errorf("check follow request exists: %w", err)
	}
	if !exists {
		return FollowRequestDecisionResponse{}, followRequestNotFoundError()
	}

	if accept {
		if _, err := tx.Exec(ctx, `
			insert into follows (follower_id, followed_user_id)
			values ($1, $2)
			on conflict do nothing
		`, requesterID, userID); err != nil {
			return FollowRequestDecisionResponse{}, fmt.Errorf("insert follow from request: %w", err)
		}
	}

	if _, err := tx.Exec(ctx, `
		delete from follow_requests
		where requester_id = $1 and target_user_id = $2
	`, requesterID, userID); err != nil {
		return FollowRequestDecisionResponse{}, fmt.Errorf("delete follow request: %w", err)
	}

	notifFollowID := "follow_req_" + strings.TrimSpace(requesterID) + "_" + strings.TrimSpace(userID)
	if _, err := tx.Exec(ctx, `
		delete from profile_notifications
		where id = $1
	`, notifFollowID); err != nil {
		return FollowRequestDecisionResponse{}, fmt.Errorf("delete follow request notification: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return FollowRequestDecisionResponse{}, fmt.Errorf("commit resolve follow request tx: %w", err)
	}

	return FollowRequestDecisionResponse{
		Accepted:    accept,
		RequesterID: requesterID,
	}, nil
}

func (r *Repository) ListBlockedUsers(
	ctx context.Context,
	userID string,
) (BlockedUserListResponse, error) {
	rows, err := r.db.Query(ctx, `
		select
			u.id,
			u.username,
			coalesce(u.full_name, ''),
			u.avatar_url,
			u.is_verified,
			b.created_at
		from blocked_users b
		join users u on u.id = b.blocked_user_id
		where b.blocker_id = $1
		order by b.created_at desc
	`, userID)
	if err != nil {
		return BlockedUserListResponse{}, fmt.Errorf("query blocked users: %w", err)
	}
	defer rows.Close()

	users := make([]BlockedUserItem, 0, 12)
	for rows.Next() {
		var item BlockedUserItem
		if err := rows.Scan(
			&item.ID,
			&item.Username,
			&item.FullName,
			&item.AvatarURL,
			&item.IsVerified,
			&item.BlockedAt,
		); err != nil {
			return BlockedUserListResponse{}, fmt.Errorf("scan blocked user row: %w", err)
		}
		users = append(users, item)
	}

	if rows.Err() != nil {
		return BlockedUserListResponse{}, fmt.Errorf("iterate blocked users: %w", rows.Err())
	}

	return BlockedUserListResponse{
		Users: users,
	}, nil
}

func (r *Repository) BlockUser(
	ctx context.Context,
	userID string,
	blockedUserID string,
) (BlockedUserOperationResponse, error) {
	tx, err := r.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return BlockedUserOperationResponse{}, fmt.Errorf("begin block user tx: %w", err)
	}
	defer tx.Rollback(ctx)

	var exists bool
	if err := tx.QueryRow(ctx, `
		select exists(select 1 from users where id = $1)
	`, blockedUserID).Scan(&exists); err != nil {
		return BlockedUserOperationResponse{}, fmt.Errorf("check blocked user exists: %w", err)
	}
	if !exists {
		return BlockedUserOperationResponse{}, blockedUserNotFoundError()
	}

	if _, err := tx.Exec(ctx, `
		insert into blocked_users (blocker_id, blocked_user_id, created_at)
		values ($1, $2, now())
		on conflict do nothing
	`, userID, blockedUserID); err != nil {
		return BlockedUserOperationResponse{}, fmt.Errorf("insert blocked user: %w", err)
	}

	if _, err := tx.Exec(ctx, `
		delete from follows
		where
			(follower_id = $1 and followed_user_id = $2)
			or (follower_id = $2 and followed_user_id = $1)
	`, userID, blockedUserID); err != nil {
		return BlockedUserOperationResponse{}, fmt.Errorf("delete follows for blocked user: %w", err)
	}

	if _, err := tx.Exec(ctx, `
		delete from follow_requests
		where
			(requester_id = $1 and target_user_id = $2)
			or (requester_id = $2 and target_user_id = $1)
	`, userID, blockedUserID); err != nil {
		return BlockedUserOperationResponse{}, fmt.Errorf("delete follow requests for blocked user: %w", err)
	}

	userA, userB := orderedUserPair(userID, blockedUserID)
	if _, err := tx.Exec(ctx, `
		delete from street_friendships
		where user_a_id = $1 and user_b_id = $2
	`, userA, userB); err != nil {
		return BlockedUserOperationResponse{}, fmt.Errorf("delete street friendship for blocked user: %w", err)
	}

	// Fully reset direct messaging relationship for both users on block.
	if _, err := tx.Exec(ctx, `
		with target_conversations as (
			select id
			from direct_conversations
			where
				(user_a_id = $1 and user_b_id = $2)
				or (user_a_id = $2 and user_b_id = $1)
		)
		delete from direct_conversation_reads dcr
		using target_conversations tc
		where dcr.conversation_id = tc.id
	`, userID, blockedUserID); err != nil {
		return BlockedUserOperationResponse{}, fmt.Errorf("delete conversation reads for blocked user: %w", err)
	}

	if _, err := tx.Exec(ctx, `
		with target_conversations as (
			select id
			from direct_conversations
			where
				(user_a_id = $1 and user_b_id = $2)
				or (user_a_id = $2 and user_b_id = $1)
		)
		delete from direct_messages dm
		using target_conversations tc
		where dm.conversation_id = tc.id
	`, userID, blockedUserID); err != nil {
		return BlockedUserOperationResponse{}, fmt.Errorf("delete direct messages for blocked user: %w", err)
	}

	if _, err := tx.Exec(ctx, `
		delete from direct_conversations
		where
			(user_a_id = $1 and user_b_id = $2)
			or (user_a_id = $2 and user_b_id = $1)
	`, userID, blockedUserID); err != nil {
		return BlockedUserOperationResponse{}, fmt.Errorf("delete direct conversations for blocked user: %w", err)
	}

	// Remove any bilateral notifications so block starts from a clean state.
	var notificationsTableExists bool
	if err := tx.QueryRow(ctx, `
		select to_regclass('public.profile_notifications') is not null
	`).Scan(&notificationsTableExists); err != nil {
		return BlockedUserOperationResponse{}, fmt.Errorf("check profile notifications table for blocked user: %w", err)
	}
	if notificationsTableExists {
		if _, err := tx.Exec(ctx, `
			delete from profile_notifications
			where
				(recipient_id = $1 and actor_id = $2)
				or (recipient_id = $2 and actor_id = $1)
		`, userID, blockedUserID); err != nil {
			return BlockedUserOperationResponse{}, fmt.Errorf("delete bilateral notifications for blocked user: %w", err)
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return BlockedUserOperationResponse{}, fmt.Errorf("commit block user tx: %w", err)
	}

	return BlockedUserOperationResponse{
		Blocked:       true,
		BlockedUserID: blockedUserID,
	}, nil
}

func (r *Repository) UnblockUser(
	ctx context.Context,
	userID string,
	blockedUserID string,
) (BlockedUserOperationResponse, error) {
	tx, err := r.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return BlockedUserOperationResponse{}, fmt.Errorf("begin unblock user tx: %w", err)
	}
	defer tx.Rollback(ctx)

	if _, err := tx.Exec(ctx, `
		delete from blocked_users
		where blocker_id = $1 and blocked_user_id = $2
	`, userID, blockedUserID); err != nil {
		return BlockedUserOperationResponse{}, fmt.Errorf("delete blocked user: %w", err)
	}

	// Reset message request state between users after unblock so both sides start clean.
	if _, err := tx.Exec(ctx, `
		update direct_conversation_reads dcr
		set
			request_accepted_at = null,
			request_rejected_at = null,
			deleted_at = null,
			updated_at = now()
		from direct_conversations dc
		where
			dcr.conversation_id = dc.id
			and dcr.user_id in ($1, $2)
			and (
				(dc.user_a_id = $1 and dc.user_b_id = $2)
				or (dc.user_a_id = $2 and dc.user_b_id = $1)
			)
	`, userID, blockedUserID); err != nil {
		return BlockedUserOperationResponse{}, fmt.Errorf("reset message request state for unblock: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return BlockedUserOperationResponse{}, fmt.Errorf("commit unblock user tx: %w", err)
	}

	return BlockedUserOperationResponse{
		Blocked:       false,
		BlockedUserID: blockedUserID,
	}, nil
}

func (r *Repository) UpdateProfile(ctx context.Context, userID string, input UpdateProfileInput) (Profile, error) {
	tag, err := r.db.Exec(ctx, `
		update users
		set
			username = coalesce($11, username),
			full_name = coalesce($2, full_name),
			email = coalesce($12, email),
			avatar_url = coalesce($3, avatar_url),
			bio = '',
			city = coalesce($5, city),
			favorite_car = coalesce($6, favorite_car),
			hero_tagline = coalesce($7, hero_tagline),
			birth_year = coalesce($8, birth_year),
			phone = coalesce($9, phone),
			phone_dial_code = coalesce($10, phone_dial_code),
			updated_at = now()
		where id = $1
	`, userID, input.FullName, input.AvatarURL, input.Bio, input.City, input.FavoriteCar, input.HeroTagline, input.BirthYear, input.Phone, input.PhoneDialCode, input.Username, input.Email)
	if err != nil {
		if isUniqueViolation(err) {
			constraint := uniqueViolationConstraintName(err)
			if constraint == "idx_users_username" || strings.Contains(constraint, "username") {
				return Profile{}, usernameTakenError()
			}
			if constraint == "idx_users_email_unique" || strings.Contains(constraint, "email") {
				return Profile{}, emailInUseError()
			}
			return Profile{}, emailInUseError()
		}
		return Profile{}, fmt.Errorf("update profile: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return Profile{}, unauthorizedError()
	}

	return r.ProfileByID(ctx, userID)
}

func (r *Repository) ClearBioByUserID(ctx context.Context, userID string) error {
	if _, err := r.db.Exec(ctx, `
		update users
		set
			bio = '',
			updated_at = now()
		where
			id = $1
			and coalesce(bio, '') <> ''
	`, strings.TrimSpace(userID)); err != nil {
		return fmt.Errorf("clear profile bio: %w", err)
	}

	return nil
}

func (r *Repository) UpdatePasswordTx(ctx context.Context, tx pgx.Tx, userID string, passwordHash string) error {
	if _, err := tx.Exec(ctx, `
		update users
		set
			password_hash = $2,
			updated_at = now()
		where id = $1
	`, userID, passwordHash); err != nil {
		return fmt.Errorf("update password: %w", err)
	}

	return nil
}

func (r *Repository) Overview(ctx context.Context) (Overview, error) {
	var overview Overview
	if err := r.db.QueryRow(ctx, `
		select
			(select count(*) from users where coalesce(status, 'active') = 'active') as members_count,
			(select count(*) from posts) as routes_count,
			(select count(*) from posts where is_live = true) as active_posts_count
	`).Scan(&overview.MembersCount, &overview.RoutesCount, &overview.ActivePostsCount); err != nil {
		return Overview{}, fmt.Errorf("query overview: %w", err)
	}

	return overview, nil
}

func (r *Repository) ResetDevelopmentAuthData(ctx context.Context) (DevelopmentResetResult, error) {
	tx, err := r.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return DevelopmentResetResult{}, fmt.Errorf("begin reset auth tx: %w", err)
	}
	defer tx.Rollback(ctx)

	var result DevelopmentResetResult

	if result.DeletedUsers, err = countRows(ctx, tx, "users"); err != nil {
		return DevelopmentResetResult{}, fmt.Errorf("count users: %w", err)
	}
	if result.ClearedPosts, err = countRows(ctx, tx, "posts"); err != nil {
		return DevelopmentResetResult{}, fmt.Errorf("count posts: %w", err)
	}
	if result.ClearedComments, err = countRows(ctx, tx, "comments"); err != nil {
		return DevelopmentResetResult{}, fmt.Errorf("count comments: %w", err)
	}
	if result.ClearedFollows, err = countRows(ctx, tx, "follows"); err != nil {
		return DevelopmentResetResult{}, fmt.Errorf("count follows: %w", err)
	}
	if result.ClearedFollowRequests, err = countRows(ctx, tx, "follow_requests"); err != nil {
		return DevelopmentResetResult{}, fmt.Errorf("count follow requests: %w", err)
	}
	if result.ClearedBlockedUsers, err = countRows(ctx, tx, "blocked_users"); err != nil {
		return DevelopmentResetResult{}, fmt.Errorf("count blocked users: %w", err)
	}
	if result.ClearedStreetFriendships, err = countRows(ctx, tx, "street_friendships"); err != nil {
		return DevelopmentResetResult{}, fmt.Errorf("count street friendships: %w", err)
	}
	if result.ClearedPostEngagements, err = countRows(ctx, tx, "post_engagements"); err != nil {
		return DevelopmentResetResult{}, fmt.Errorf("count post engagements: %w", err)
	}
	if result.ClearedSessions, err = countRows(ctx, tx, "auth_sessions"); err != nil {
		return DevelopmentResetResult{}, fmt.Errorf("count sessions: %w", err)
	}
	if result.ClearedPasswordResets, err = countRows(ctx, tx, "password_reset_codes"); err != nil {
		return DevelopmentResetResult{}, fmt.Errorf("count password reset codes: %w", err)
	}
	if result.ClearedVerificationTokens, err = countRows(ctx, tx, "email_verification_tokens"); err != nil {
		return DevelopmentResetResult{}, fmt.Errorf("count verification tokens: %w", err)
	}
	if result.ClearedLoginAttempts, err = countRows(ctx, tx, "auth_login_attempts"); err != nil {
		return DevelopmentResetResult{}, fmt.Errorf("count login attempts: %w", err)
	}

	if _, err = execRowsAffected(ctx, tx, `delete from auth_login_attempts`); err != nil {
		return DevelopmentResetResult{}, fmt.Errorf("clear login attempts: %w", err)
	}
	if _, err = execRowsAffected(ctx, tx, `delete from users`); err != nil {
		return DevelopmentResetResult{}, fmt.Errorf("delete development users: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return DevelopmentResetResult{}, fmt.Errorf("commit reset auth tx: %w", err)
	}

	return result, nil
}

func orderedUserPair(left string, right string) (string, string) {
	if left <= right {
		return left, right
	}

	return right, left
}

func viewerFollowRequestState(
	isFollowing bool,
	requestedBy string,
	viewerID string,
) FollowRequestStatus {
	if isFollowing {
		return FollowRequestStatusNone
	}

	switch strings.TrimSpace(requestedBy) {
	case viewerID:
		return FollowRequestStatusPendingOutgoing
	case "":
		return FollowRequestStatusNone
	default:
		return FollowRequestStatusPendingIncoming
	}
}

func emailLockKey(email string) int64 {
	var hash uint64 = 1469598103934665603
	for _, char := range strings.ToLower(strings.TrimSpace(email)) {
		hash ^= uint64(char)
		hash *= 1099511628211
	}

	return int64(hash)
}

func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}

func uniqueViolationConstraintName(err error) string {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		return pgErr.ConstraintName
	}
	return ""
}

func execRowsAffected(ctx context.Context, tx pgx.Tx, query string, args ...any) (int64, error) {
	commandTag, err := tx.Exec(ctx, query, args...)
	if err != nil {
		return 0, err
	}

	return commandTag.RowsAffected(), nil
}

func countRows(ctx context.Context, tx pgx.Tx, table string) (int64, error) {
	var count int64
	query := fmt.Sprintf("select count(*) from %s", table)
	if err := tx.QueryRow(ctx, query).Scan(&count); err != nil {
		return 0, err
	}

	return count, nil
}
