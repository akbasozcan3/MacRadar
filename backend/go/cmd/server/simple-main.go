//go:build simplemock
// +build simplemock

package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"time"

	"github.com/gorilla/websocket"
)

type HealthResponse struct {
	Service    string    `json:"service"`
	Status     string    `json:"status"`
	Version    string    `json:"version"`
	Timestamp  time.Time `json:"timestamp"`
	Port       string    `json:"port"`
	Uptime     string    `json:"uptime"`
}

type User struct {
	ID       string    `json:"id"`
	Username string    `json:"username"`
	Email    string    `json:"email"`
	Created  time.Time `json:"created"`
}

type Post struct {
	ID        string    `json:"id"`
	UserID    string    `json:"userId"`
	Content   string    `json:"content"`
	Created   time.Time `json:"created"`
	Likes     int       `json:"likes"`
	Comments  int       `json:"comments"`
}

var (
	users   = make(map[string]User)
	posts   = make(map[string]Post)
	upgrader = websocket.Upgrader{
		CheckOrigin: func(r *http.Request) bool {
			return true
		},
	}
	clients = make(map[*websocket.Conn]bool)
	startTime = time.Now()
)

func main() {
	// Initialize sample data
	initializeSampleData()

	port := "8092"
	
	// HTTP Routes
	http.HandleFunc("/healthz", healthHandler)
	http.HandleFunc("/api/v1/users", usersHandler)
	http.HandleFunc("/api/v1/posts", postsHandler)
	http.HandleFunc("/api/v1/explore", exploreHandler)
	http.HandleFunc("/ws", wsHandler)
	
	fmt.Printf("Go Backend starting on port %s\n", port)
	fmt.Printf("Health endpoint: http://localhost:%s/healthz\n", port)
	fmt.Printf("WebSocket endpoint: ws://localhost:%s/ws\n", port)
	
	log.Fatal(http.ListenAndServe(":"+port, nil))
}

func initializeSampleData() {
	// Sample users
	users["user1"] = User{
		ID:       "user1",
		Username: "john_doe",
		Email:    "john@example.com",
		Created:  time.Now(),
	}
	
	users["user2"] = User{
		ID:       "user2",
		Username: "jane_smith",
		Email:    "jane@example.com",
		Created:  time.Now(),
	}
	
	// Sample posts
	posts["post1"] = Post{
		ID:        "post1",
		UserID:    "user1",
		Content:   "Hello from Go backend!",
		Created:   time.Now(),
		Likes:     5,
		Comments:  2,
	}
	
	posts["post2"] = Post{
		ID:        "post2",
		UserID:    "user2",
		Content:   "Go service is running perfectly!",
		Created:   time.Now(),
		Likes:     10,
		Comments:  3,
	}
}

func healthHandler(w http.ResponseWriter, r *http.Request) {
	uptime := time.Since(startTime)
	
	response := HealthResponse{
		Service:   "go-backend",
		Status:    "healthy",
		Version:   "1.0.0",
		Timestamp: time.Now(),
		Port:      "8092",
		Uptime:    uptime.String(),
	}
	
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(response)
}

func usersHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	
	switch r.Method {
	case http.MethodGet:
		userList := make([]User, 0, len(users))
		for _, user := range users {
			userList = append(userList, user)
		}
		
		response := map[string]interface{}{
			"success": true,
			"users":   userList,
			"total":   len(userList),
		}
		
		json.NewEncoder(w).Encode(response)
		
	case http.MethodPost:
		var newUser User
		if err := json.NewDecoder(r.Body).Decode(&newUser); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		
		newUser.ID = fmt.Sprintf("user%d", time.Now().Unix())
		newUser.Created = time.Now()
		users[newUser.ID] = newUser
		
		w.WriteHeader(http.StatusCreated)
		response := map[string]interface{}{
			"success": true,
			"user":    newUser,
		}
		json.NewEncoder(w).Encode(response)
		
	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

func postsHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	
	switch r.Method {
	case http.MethodGet:
		postList := make([]Post, 0, len(posts))
		for _, post := range posts {
			postList = append(postList, post)
		}
		
		response := map[string]interface{}{
			"success": true,
			"posts":   postList,
			"total":   len(postList),
		}
		
		json.NewEncoder(w).Encode(response)
		
	case http.MethodPost:
		var newPost Post
		if err := json.NewDecoder(r.Body).Decode(&newPost); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		
		newPost.ID = fmt.Sprintf("post%d", time.Now().Unix())
		newPost.Created = time.Now()
		newPost.Likes = 0
		newPost.Comments = 0
		posts[newPost.ID] = newPost
		
		w.WriteHeader(http.StatusCreated)
		response := map[string]interface{}{
			"success": true,
			"post":    newPost,
		}
		json.NewEncoder(w).Encode(response)
		
	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

func exploreHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	
	response := map[string]interface{}{
		"success": true,
		"explore": map[string]interface{}{
			"trending_posts": len(posts),
			"active_users":  len(users),
			"categories":    []string{"go", "backend", "api", "websockets"},
			"features":      []string{"users", "posts", "real-time", "health-check"},
		},
		"timestamp": time.Now(),
	}
	
	json.NewEncoder(w).Encode(response)
}

func wsHandler(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("WebSocket upgrade error: %v", err)
		return
	}
	defer conn.Close()
	
	clients[conn] = true
	log.Printf("New WebSocket client connected. Total clients: %d", len(clients))
	
	// Send welcome message
	welcome := map[string]interface{}{
		"type":      "welcome",
		"message":   "Connected to Go backend WebSocket",
		"timestamp": time.Now(),
		"server":    "go-backend",
		"port":      "8092",
	}
	
	if err := conn.WriteJSON(welcome); err != nil {
		log.Printf("Error sending welcome message: %v", err)
		return
	}
	
	// Handle messages
	for {
		var message map[string]interface{}
		if err := conn.ReadJSON(&message); err != nil {
			log.Printf("WebSocket read error: %v", err)
			break
		}
		
		// Echo message back
		response := map[string]interface{}{
			"type":      "echo",
			"original":  message,
			"timestamp": time.Now(),
			"server":    "go-backend",
		}
		
		if err := conn.WriteJSON(response); err != nil {
			log.Printf("Error sending echo message: %v", err)
			break
		}
	}
	
	delete(clients, conn)
	log.Printf("WebSocket client disconnected. Total clients: %d", len(clients))
}

// Broadcast message to all connected WebSocket clients
func broadcastToAll(message interface{}) {
	for client := range clients {
		if err := client.WriteJSON(message); err != nil {
			log.Printf("Error broadcasting to client: %v", err)
			client.Close()
			delete(clients, client)
		}
	}
}
