package server

import (
	"cmp"
	"maps"
	"net/http"
	"slices"
	"strings"
	"sync"
	"time"
)

type searchPaddingEngine struct {
	mu            sync.Mutex
	searchHistory map[string][]searchHistoryItem
	trending      map[string]int
	totalSearches int
	avgResponseMS float64
}

type searchHistoryItem struct {
	Query     string    `json:"query"`
	Timestamp time.Time `json:"timestamp"`
}

type searchUserProfile struct {
	CategoryPreference map[string]int
	SearchCount        int
	LastSearch         *searchHistoryItem
}

type searchRequest struct {
	Query    string                 `json:"query"`
	UserID   string                 `json:"userId"`
	Strategy string                 `json:"strategy"`
	Limit    int                    `json:"limit"`
	Offset   int                    `json:"offset"`
	Filters  map[string]interface{} `json:"filters"`
}

type searchResultItem struct {
	ID             string   `json:"id"`
	Content        string   `json:"content"`
	Category       string   `json:"category"`
	AuthorID       string   `json:"authorId"`
	ContentType    string   `json:"contentType"`
	RelevanceScore float64  `json:"relevanceScore"`
	Likes          int      `json:"likes"`
	Comments       int      `json:"comments"`
	Shares         int      `json:"shares"`
	Saves          int      `json:"saves"`
	CreatedAt      string   `json:"createdAt"`
	Hashtags       []string `json:"hashtags"`
}

type scoredSearchResult struct {
	Item  searchResultItem
	Score float64
}

func newSearchPaddingEngine() *searchPaddingEngine {
	return &searchPaddingEngine{
		searchHistory: make(map[string][]searchHistoryItem),
		trending:      make(map[string]int),
	}
}

func (s *Server) handleProfessionalSearch(w http.ResponseWriter, r *http.Request) {
	var input searchRequest
	if err := s.decodeJSON(r, &input); err != nil {
		s.respondDecodeError(w, err, "invalid_search_payload")
		return
	}

	query := strings.TrimSpace(input.Query)
	if query == "" {
		s.respondError(w, http.StatusBadRequest, "query_required", "Arama metni zorunludur.")
		return
	}

	if input.Limit <= 0 || input.Limit > 100 {
		input.Limit = 20
	}
	if input.Offset < 0 {
		input.Offset = 0
	}
	if strings.TrimSpace(input.UserID) == "" {
		input.UserID = "anonymous"
	}
	if strings.TrimSpace(input.Strategy) == "" {
		input.Strategy = "smart"
	}

	startedAt := time.Now()
	baseResults := mockSearchResults(query)
	results := s.searchPadding.applyStrategy(input.Strategy, baseResults, input.Limit, input.Offset)
	responseMS := time.Since(startedAt).Milliseconds()

	s.searchPadding.recordSearch(input.UserID, query, responseMS, results)
	metrics := buildPaddingMetrics(baseResults, results)

	s.respondJSON(w, http.StatusOK, map[string]any{
		"paddingApplied": true,
		"query":          query,
		"responseTime":   responseMS,
		"results":        results,
		"returned":       len(results),
		"strategy":       strings.ToLower(input.Strategy),
		"timestamp":      time.Now().UTC(),
		"totalFound":     len(baseResults),
		"metrics":        metrics,
	})
}

func (s *Server) handleSearchStrategies(w http.ResponseWriter, _ *http.Request) {
	s.respondJSON(w, http.StatusOK, map[string]any{
		"strategies": []map[string]string{
			{"key": "smart", "name": "Smart Padding", "description": "Intelligent ranking based on relevance and engagement"},
			{"key": "balanced", "name": "Balanced Padding", "description": "Even category distribution"},
			{"key": "quality", "name": "Quality Padding", "description": "Prioritizes quality and engagement"},
			{"key": "diversity", "name": "Diversity Padding", "description": "Avoids repetitive categories/authors"},
		},
	})
}

func (s *Server) handleSearchAnalytics(w http.ResponseWriter, _ *http.Request) {
	s.respondJSON(w, http.StatusOK, s.searchPadding.analyticsSnapshot())
}

func (s *Server) handleSearchUserAnalytics(w http.ResponseWriter, r *http.Request) {
	userID := strings.TrimSpace(r.PathValue("userID"))
	if userID == "" {
		s.respondError(w, http.StatusBadRequest, "invalid_user_id", "Kullanici kimligi gecersiz.")
		return
	}
	s.respondJSON(w, http.StatusOK, s.searchPadding.userSnapshot(userID))
}

func (e *searchPaddingEngine) recordSearch(userID, query string, responseMS int64, results []searchResultItem) {
	e.mu.Lock()
	defer e.mu.Unlock()

	e.totalSearches++
	total := (e.avgResponseMS * float64(e.totalSearches-1)) + float64(responseMS)
	e.avgResponseMS = total / float64(e.totalSearches)

	e.searchHistory[userID] = append(e.searchHistory[userID], searchHistoryItem{
		Query:     query,
		Timestamp: time.Now().UTC(),
	})
	if len(e.searchHistory[userID]) > 100 {
		e.searchHistory[userID] = e.searchHistory[userID][len(e.searchHistory[userID])-100:]
	}
	e.trending[strings.ToLower(query)]++
}

func (e *searchPaddingEngine) analyticsSnapshot() map[string]any {
	e.mu.Lock()
	defer e.mu.Unlock()

	trending := maps.Clone(e.trending)
	topTrending := make([]map[string]any, 0, min(10, len(trending)))
	keys := make([]string, 0, len(trending))
	for key := range trending {
		keys = append(keys, key)
	}
	slices.SortFunc(keys, func(a, b string) int {
		return cmp.Compare(trending[b], trending[a])
	})
	for _, key := range keys[:min(10, len(keys))] {
		topTrending = append(topTrending, map[string]any{
			"query": key,
			"count": trending[key],
		})
	}

	return map[string]any{
		"avgResponseTime":  e.avgResponseMS,
		"availableStrategies": []string{"smart", "balanced", "quality", "diversity"},
		"timestamp":          time.Now().UTC(),
		"totalSearches":      e.totalSearches,
		"trendingQueries":    topTrending,
	}
}

func (e *searchPaddingEngine) userSnapshot(userID string) map[string]any {
	e.mu.Lock()
	defer e.mu.Unlock()

	history := e.searchHistory[userID]
	profile := searchUserProfile{
		CategoryPreference: map[string]int{},
		SearchCount:        len(history),
	}
	if len(history) > 0 {
		last := history[len(history)-1]
		profile.LastSearch = &last
	}

	return map[string]any{
		"userId":             userID,
		"searchCount":        profile.SearchCount,
		"lastSearch":         profile.LastSearch,
		"profileStrength":    min(100, profile.SearchCount),
		"preferredCategories": []map[string]any{},
		"timestamp":          time.Now().UTC(),
	}
}

func (e *searchPaddingEngine) applyStrategy(strategy string, results []searchResultItem, limit, offset int) []searchResultItem {
	switch strings.ToLower(strings.TrimSpace(strategy)) {
	case "balanced":
		return applyBalancedStrategy(results, limit, offset)
	case "quality":
		return applyQualityStrategy(results, limit, offset)
	case "diversity":
		return applyDiversityStrategy(results, limit, offset)
	default:
		return applySmartStrategy(results, limit, offset)
	}
}

func applySmartStrategy(results []searchResultItem, limit, offset int) []searchResultItem {
	scored := make([]scoredSearchResult, 0, len(results))
	for _, item := range results {
		score := item.RelevanceScore*30 + float64(item.Comments*2+item.Shares*3+item.Likes+item.Saves*2)
		scored = append(scored, scoredSearchResult{Item: item, Score: score})
	}
	slices.SortFunc(scored, func(a, b scoredSearchResult) int {
		if a.Score == b.Score {
			return cmp.Compare(a.Item.ID, b.Item.ID)
		}
		if a.Score > b.Score {
			return -1
		}
		return 1
	})
	ordered := make([]searchResultItem, 0, len(scored))
	for _, item := range scored {
		ordered = append(ordered, item.Item)
	}
	return paginateSearchResults(ordered, limit, offset)
}

func applyBalancedStrategy(results []searchResultItem, limit, offset int) []searchResultItem {
	buckets := make(map[string][]searchResultItem)
	keys := make([]string, 0)
	for _, item := range results {
		key := item.Category
		if _, ok := buckets[key]; !ok {
			keys = append(keys, key)
		}
		buckets[key] = append(buckets[key], item)
	}

	slices.Sort(keys)
	merged := make([]searchResultItem, 0, len(results))
	for {
		added := false
		for _, key := range keys {
			if len(buckets[key]) == 0 {
				continue
			}
			merged = append(merged, buckets[key][0])
			buckets[key] = buckets[key][1:]
			added = true
		}
		if !added {
			break
		}
	}
	return paginateSearchResults(merged, limit, offset)
}

func applyQualityStrategy(results []searchResultItem, limit, offset int) []searchResultItem {
	cloned := append([]searchResultItem(nil), results...)
	slices.SortFunc(cloned, func(a, b searchResultItem) int {
		scoreA := float64(a.Likes + a.Comments*2 + a.Shares*3 + a.Saves*2)
		scoreB := float64(b.Likes + b.Comments*2 + b.Shares*3 + b.Saves*2)
		if scoreA == scoreB {
			return cmp.Compare(a.ID, b.ID)
		}
		if scoreA > scoreB {
			return -1
		}
		return 1
	})
	return paginateSearchResults(cloned, limit, offset)
}

func applyDiversityStrategy(results []searchResultItem, limit, offset int) []searchResultItem {
	categorySeen := make(map[string]bool)
	authorSeen := make(map[string]bool)
	diverse := make([]searchResultItem, 0, len(results))
	fallback := make([]searchResultItem, 0, len(results))

	for _, item := range results {
		if !categorySeen[item.Category] || !authorSeen[item.AuthorID] {
			diverse = append(diverse, item)
			categorySeen[item.Category] = true
			authorSeen[item.AuthorID] = true
			continue
		}
		fallback = append(fallback, item)
	}

	merged := append(diverse, fallback...)
	return paginateSearchResults(merged, limit, offset)
}

func paginateSearchResults(results []searchResultItem, limit, offset int) []searchResultItem {
	if offset >= len(results) {
		return []searchResultItem{}
	}
	end := min(len(results), offset+limit)
	return results[offset:end]
}

func buildPaddingMetrics(original, padded []searchResultItem) map[string]any {
	if len(original) == 0 {
		return map[string]any{
			"originalCount": 0,
			"paddedCount":   len(padded),
			"paddingRatio":  1,
		}
	}
	return map[string]any{
		"originalCount": len(original),
		"paddedCount":   len(padded),
		"paddingRatio":  float64(len(padded)) / float64(len(original)),
	}
}

func mockSearchResults(query string) []searchResultItem {
	query = strings.ToLower(strings.TrimSpace(query))
	now := time.Now().UTC()
	all := []searchResultItem{
		{
			ID: "result1", Content: "Amazing sunset photography from the mountains", Category: "nature", AuthorID: "user1",
			ContentType: "image", RelevanceScore: 0.9, Likes: 150, Comments: 23, Shares: 45, Saves: 12,
			CreatedAt: now.Add(-2 * time.Hour).Format(time.RFC3339), Hashtags: []string{"sunset", "mountains", "photography"},
		},
		{
			ID: "result2", Content: "Professional web development tips and tricks", Category: "tech", AuthorID: "user2",
			ContentType: "article", RelevanceScore: 0.85, Likes: 89, Comments: 15, Shares: 67, Saves: 10,
			CreatedAt: now.Add(-5 * time.Hour).Format(time.RFC3339), Hashtags: []string{"webdev", "programming", "tips"},
		},
		{
			ID: "result3", Content: "Delicious homemade pasta recipe tutorial", Category: "food", AuthorID: "user3",
			ContentType: "video", RelevanceScore: 0.8, Likes: 234, Comments: 56, Shares: 89, Saves: 52,
			CreatedAt: now.Add(-1 * time.Hour).Format(time.RFC3339), Hashtags: []string{"pasta", "recipe", "cooking"},
		},
		{
			ID: "result4", Content: "Urban driving camera setup for daily commute", Category: "auto", AuthorID: "user4",
			ContentType: "video", RelevanceScore: 0.77, Likes: 120, Comments: 32, Shares: 21, Saves: 17,
			CreatedAt: now.Add(-3 * time.Hour).Format(time.RFC3339), Hashtags: []string{"dashcam", "commute", "car"},
		},
	}

	if query == "" {
		return all
	}
	filtered := make([]searchResultItem, 0, len(all))
	for _, item := range all {
		content := strings.ToLower(item.Content)
		match := strings.Contains(content, query)
		if !match {
			for _, tag := range item.Hashtags {
				if strings.Contains(strings.ToLower(tag), query) {
					match = true
					break
				}
			}
		}
		if match {
			filtered = append(filtered, item)
		}
	}
	return filtered
}
