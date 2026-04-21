package main

import (
	"context"
	"fmt"
	"os"
	"strings"

	"github.com/jackc/pgx/v5"
)

func main() {
	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		dbURL = "postgres://macradar:macradar@localhost:5432/macradar?sslmode=disable"
	}

	ctx := context.Background()
	conn, err := pgx.Connect(ctx, dbURL)
	if err != nil {
		fmt.Printf("Unable to connect to database: %v\n", err)
		os.Exit(1)
	}
	defer conn.Close(ctx)

	fmt.Println("Connected to database. Truncating test users, posts, comments...")

	tables := []string{
		"users",
		"posts",
		"comments",
		"follows",
		"post_engagements",
		"street_friendships",
		"follow_requests",
		"messages",
		"conversations",
	}

	for _, table := range tables {
		query := fmt.Sprintf("TRUNCATE TABLE %s CASCADE;", table)
		_, err = conn.Exec(ctx, query)
		if err != nil {
			if strings.Contains(err.Error(), "does not exist") {
				continue
			}
			fmt.Printf("Failed to truncate %s: %v\n", table, err)
		} else {
			fmt.Printf("Truncated %s\n", table)
		}
	}

	fmt.Println("Database successfully cleared of test data!")
}
