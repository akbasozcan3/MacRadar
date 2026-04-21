package migrate

import (
	"context"
	"fmt"
	"io/fs"
	"log/slog"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
)

func Run(ctx context.Context, db *pgxpool.Pool, logger *slog.Logger, configuredDir string) error {
	dir, err := resolveDir(configuredDir)
	if err != nil {
		return err
	}

	if _, err := db.Exec(ctx, `
		create table if not exists schema_migrations (
			filename text primary key,
			applied_at timestamptz not null default now()
		)
	`); err != nil {
		return fmt.Errorf("ensure schema_migrations table: %w", err)
	}

	entries, err := os.ReadDir(dir)
	if err != nil {
		return fmt.Errorf("read migrations dir: %w", err)
	}

	files := make([]fs.DirEntry, 0, len(entries))
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(strings.ToLower(entry.Name()), ".sql") {
			continue
		}

		files = append(files, entry)
	}

	sort.Slice(files, func(i, j int) bool {
		return files[i].Name() < files[j].Name()
	})

	for _, file := range files {
		var alreadyApplied bool
		if err := db.QueryRow(ctx, `
			select exists(select 1 from schema_migrations where filename = $1)
		`, file.Name()).Scan(&alreadyApplied); err != nil {
			return fmt.Errorf("check migration %s: %w", file.Name(), err)
		}

		if alreadyApplied {
			continue
		}

		payload, err := os.ReadFile(filepath.Join(dir, file.Name()))
		if err != nil {
			return fmt.Errorf("read migration %s: %w", file.Name(), err)
		}

		tx, err := db.Begin(ctx)
		if err != nil {
			return fmt.Errorf("begin migration %s: %w", file.Name(), err)
		}

		if _, err := tx.Exec(ctx, string(payload)); err != nil {
			_ = tx.Rollback(ctx)
			return fmt.Errorf("execute migration %s: %w", file.Name(), err)
		}

		if _, err := tx.Exec(ctx, `
			insert into schema_migrations (filename)
			values ($1)
		`, file.Name()); err != nil {
			_ = tx.Rollback(ctx)
			return fmt.Errorf("record migration %s: %w", file.Name(), err)
		}

		if err := tx.Commit(ctx); err != nil {
			return fmt.Errorf("commit migration %s: %w", file.Name(), err)
		}

		logger.Info("migration applied", slog.String("filename", file.Name()))
	}

	return nil
}

func resolveDir(configuredDir string) (string, error) {
	candidates := []string{
		strings.TrimSpace(configuredDir),
		filepath.Join("..", "migrations"),
		filepath.Join("backend", "migrations"),
		"migrations",
	}

	for _, candidate := range candidates {
		if candidate == "" {
			continue
		}

		info, err := os.Stat(candidate)
		if err == nil && info.IsDir() {
			return candidate, nil
		}
	}

	return "", fmt.Errorf("could not find migrations directory; checked %s", strings.Join(candidates, ", "))
}
