package main

import (
	"log"
	"os"
	"os/exec"
)

func main() {
	log.Println("Starting simplified Go backend...")
	
	// Change to the server directory
	if err := os.Chdir("cmd/server"); err != nil {
		log.Fatalf("Failed to change directory: %v", err)
	}
	
	// Run the simplified Go server
	cmd := exec.Command("go", "run", "simple-main.go")
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	
	if err := cmd.Run(); err != nil {
		log.Fatalf("Failed to run Go server: %v", err)
	}
}
