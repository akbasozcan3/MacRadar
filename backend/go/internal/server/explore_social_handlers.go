package server

import (
	"context"
	"errors"
	"hash/fnv"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"

	"macradar/backend/internal/explore"
)

type explorePlaceSearchItem struct {
	FullAddress string   `json:"fullAddress"`
	Latitude    float64  `json:"latitude"`
	Longitude   float64  `json:"longitude"`
	MapboxID    string   `json:"mapboxId"`
	Name        string   `json:"name"`
	PlaceType   []string `json:"placeType"`
	Relevance   float64  `json:"relevance"`
}

type explorePlaceSearchResponse struct {
	Results []explorePlaceSearchItem `json:"results"`
}

var fallbackExplorePlaces = []explorePlaceSearchItem{
	{FullAddress: "Istanbul, Turkiye", Latitude: 41.0082, Longitude: 28.9784, MapboxID: "fallback.istanbul", Name: "Istanbul", PlaceType: []string{"place"}, Relevance: 0.98},
	{FullAddress: "Besiktas, Istanbul, Turkiye", Latitude: 41.0422, Longitude: 29.0083, MapboxID: "fallback.besiktas", Name: "Besiktas", PlaceType: []string{"district"}, Relevance: 0.94},
	{FullAddress: "Kadikoy, Istanbul, Turkiye", Latitude: 40.9917, Longitude: 29.0277, MapboxID: "fallback.kadikoy", Name: "Kadikoy", PlaceType: []string{"district"}, Relevance: 0.94},
	{FullAddress: "Sisli, Istanbul, Turkiye", Latitude: 41.0605, Longitude: 28.9872, MapboxID: "fallback.sisli", Name: "Sisli", PlaceType: []string{"district"}, Relevance: 0.92},
	{FullAddress: "Ankara, Turkiye", Latitude: 39.9334, Longitude: 32.8597, MapboxID: "fallback.ankara", Name: "Ankara", PlaceType: []string{"place"}, Relevance: 0.88},
	{FullAddress: "Izmir, Turkiye", Latitude: 38.4237, Longitude: 27.1428, MapboxID: "fallback.izmir", Name: "Izmir", PlaceType: []string{"place"}, Relevance: 0.87},
}

func normalizeTrendingTagQuery(value string) string {
	normalized := strings.TrimSpace(strings.ToLower(value))
	normalized = strings.TrimLeft(normalized, "#")
	return strings.Join(strings.Fields(normalized), "")
}

func trendingTagMatchScore(tag string, query string) int {
	if query == "" {
		return 0
	}

	switch {
	case tag == query:
		return 3
	case strings.HasPrefix(tag, query):
		return 2
	case strings.Contains(tag, query):
		return 1
	default:
		return 0
	}
}

func stableUserABBucket(seed string) int {
	trimmed := strings.TrimSpace(seed)
	if trimmed == "" {
		trimmed = "anonymous"
	}
	hasher := fnv.New32a()
	_, _ = hasher.Write([]byte(trimmed))
	return int(hasher.Sum32() % 100)
}

func setPrivateCacheControl(w http.ResponseWriter, maxAgeSeconds int) {
	if maxAgeSeconds <= 0 {
		return
	}

	staleWhileRevalidateSeconds := maxAgeSeconds * 3
	w.Header().Set(
		"Cache-Control",
		"private, max-age="+strconv.Itoa(maxAgeSeconds)+", stale-while-revalidate="+strconv.Itoa(staleWhileRevalidateSeconds),
	)
}

func (s *Server) resolvePopularSearchScoreModel(
	r *http.Request,
	viewerID string,
) explore.PopularSearchScoreModel {
	if requested := strings.TrimSpace(r.URL.Query().Get("scoreModel")); requested != "" {
		if parsed, ok := explore.ParsePopularSearchScoreModel(requested); ok {
			return parsed
		}
	}

	if !s.cfg.SearchPopularABEnabled {
		return explore.PopularSearchScoreModelA
	}

	trafficPercent := s.cfg.SearchPopularBTrafficPercent
	if trafficPercent <= 0 {
		return explore.PopularSearchScoreModelA
	}
	if trafficPercent >= 100 {
		return explore.PopularSearchScoreModelB
	}

	if stableUserABBucket(viewerID) < trafficPercent {
		return explore.PopularSearchScoreModelB
	}
	return explore.PopularSearchScoreModelA
}

func (s *Server) handleExploreUserSearch(w http.ResponseWriter, r *http.Request) {
	viewerID, err := s.viewerID(r, "")
	if err != nil {
		s.respondError(w, http.StatusUnauthorized, "unauthorized", err.Error())
		return
	}

	limit := 20
	if rawLimit := strings.TrimSpace(r.URL.Query().Get("limit")); rawLimit != "" {
		parsedLimit, parseErr := strconv.Atoi(rawLimit)
		if parseErr != nil {
			s.respondError(w, http.StatusBadRequest, "invalid_search_limit", "Arama limiti sayisal olmali.")
			return
		}
		limit = parsedLimit
	}

	query := strings.TrimSpace(r.URL.Query().Get("q"))
	cursor := strings.TrimSpace(r.URL.Query().Get("cursor"))

	ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
	defer cancel()

	response, err := s.repo.SearchUsers(ctx, explore.SearchUsersQuery{
		Cursor:   cursor,
		Limit:    limit,
		Query:    query,
		ViewerID: viewerID,
	})
	if err != nil {
		switch {
		case errors.Is(err, explore.ErrInvalidSearchCursor):
			s.respondError(w, http.StatusBadRequest, "invalid_search_cursor", "Arama sayfasi gecersiz.")
		default:
			s.respondInternalError(w, "search_users_failed", err)
		}
		return
	}

	setPrivateCacheControl(w, 30)
	s.respondJSON(w, http.StatusOK, response)
}

func (s *Server) handleExplorePlacesSearch(w http.ResponseWriter, r *http.Request) {
	limit := 6
	if rawLimit := strings.TrimSpace(r.URL.Query().Get("limit")); rawLimit != "" {
		parsedLimit, parseErr := strconv.Atoi(rawLimit)
		if parseErr != nil {
			s.respondError(w, http.StatusBadRequest, "invalid_search_limit", "Arama limiti sayisal olmali.")
			return
		}
		limit = parsedLimit
	}
	if limit < 1 {
		limit = 1
	}
	if limit > 8 {
		limit = 8
	}

	rawQuery := strings.TrimSpace(r.URL.Query().Get("q"))
	language := strings.TrimSpace(r.URL.Query().Get("language"))
	country := strings.TrimSpace(r.URL.Query().Get("country"))

	ctx, cancel := context.WithTimeout(r.Context(), 8*time.Second)
	defer cancel()

	results := make([]explorePlaceSearchItem, 0, limit)
	if mapboxResults, err := searchMapboxPlaces(ctx, s.cfg, rawQuery, limit, language, country); err == nil && len(mapboxResults) > 0 {
		results = append(results, mapboxResults...)
	}

	normalized := strings.ToLower(rawQuery)
	if len(results) < limit {
		for _, item := range fallbackExplorePlaces {
			if len(results) >= limit {
				break
			}
			if normalized == "" ||
				strings.Contains(strings.ToLower(item.Name), normalized) ||
				strings.Contains(strings.ToLower(item.FullAddress), normalized) {
				results = append(results, item)
			}
		}
	}

	setPrivateCacheControl(w, 60)
	s.respondJSON(w, http.StatusOK, explorePlaceSearchResponse{Results: results})
}

func (s *Server) handleExploreRecentUsers(w http.ResponseWriter, r *http.Request) {
	viewerID, err := s.viewerID(r, "")
	if err != nil {
		s.respondError(w, http.StatusUnauthorized, "unauthorized", err.Error())
		return
	}

	limit := 8
	if rawLimit := strings.TrimSpace(r.URL.Query().Get("limit")); rawLimit != "" {
		parsedLimit, parseErr := strconv.Atoi(rawLimit)
		if parseErr != nil {
			s.respondError(w, http.StatusBadRequest, "invalid_search_limit", "Arama limiti sayisal olmali.")
			return
		}
		limit = parsedLimit
	}

	ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
	defer cancel()

	response, err := s.repo.ListRecentSearchedUsers(ctx, viewerID, limit)
	if err != nil {
		switch {
		case errors.Is(err, explore.ErrInvalidRecentSearchAction):
			s.respondError(w, http.StatusBadRequest, "invalid_recent_search_action", "Son aramalar listesi alinamadi.")
		default:
			s.respondInternalError(w, "recent_search_users_failed", err)
		}
		return
	}

	setPrivateCacheControl(w, 60)
	s.respondJSON(w, http.StatusOK, response)
}

func (s *Server) handleRecordExploreRecentUser(w http.ResponseWriter, r *http.Request) {
	var input explore.RecentSearchUserInput
	if err := s.decodeJSON(r, &input); err != nil {
		s.respondDecodeError(w, err, "invalid_recent_search_payload")
		return
	}

	viewerID, err := s.viewerID(r, "")
	if err != nil {
		s.respondError(w, http.StatusUnauthorized, "unauthorized", err.Error())
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
	defer cancel()

	if err := s.repo.SaveRecentSearchedUser(ctx, viewerID, input.UserID); err != nil {
		switch {
		case errors.Is(err, explore.ErrInvalidRecentSearchAction):
			s.respondError(w, http.StatusBadRequest, "invalid_recent_search_action", "Son arama gecmisi guncellenemedi.")
		default:
			s.respondInternalError(w, "save_recent_search_user_failed", err)
		}
		return
	}

	s.respondJSON(w, http.StatusOK, explore.RecentSearchMutationResponse{
		Saved:  true,
		UserID: strings.TrimSpace(input.UserID),
	})
}

func (s *Server) handleRemoveExploreRecentUser(w http.ResponseWriter, r *http.Request) {
	userID := strings.TrimSpace(r.PathValue("userID"))
	if userID == "" {
		s.respondError(w, http.StatusBadRequest, "invalid_user_id", "user id is required")
		return
	}

	viewerID, err := s.viewerID(r, "")
	if err != nil {
		s.respondError(w, http.StatusUnauthorized, "unauthorized", err.Error())
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
	defer cancel()

	removed, err := s.repo.RemoveRecentSearchedUser(ctx, viewerID, userID)
	if err != nil {
		switch {
		case errors.Is(err, explore.ErrInvalidRecentSearchAction):
			s.respondError(w, http.StatusBadRequest, "invalid_recent_search_action", "Son arama silinemedi.")
		default:
			s.respondInternalError(w, "remove_recent_search_user_failed", err)
		}
		return
	}

	s.respondJSON(w, http.StatusOK, explore.RecentSearchMutationResponse{
		Removed: removed,
		UserID:  userID,
	})
}

func (s *Server) handleClearExploreRecentUsers(w http.ResponseWriter, r *http.Request) {
	viewerID, err := s.viewerID(r, "")
	if err != nil {
		s.respondError(w, http.StatusUnauthorized, "unauthorized", err.Error())
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
	defer cancel()

	deletedCount, err := s.repo.ClearRecentSearchedUsers(ctx, viewerID)
	if err != nil {
		switch {
		case errors.Is(err, explore.ErrInvalidRecentSearchAction):
			s.respondError(w, http.StatusBadRequest, "invalid_recent_search_action", "Son aramalar temizlenemedi.")
		default:
			s.respondInternalError(w, "clear_recent_search_users_failed", err)
		}
		return
	}

	s.respondJSON(w, http.StatusOK, explore.RecentSearchMutationResponse{
		Cleared:      true,
		DeletedCount: deletedCount,
	})
}

func (s *Server) handleExploreRecentSearchTerms(w http.ResponseWriter, r *http.Request) {
	viewerID, err := s.viewerID(r, "")
	if err != nil {
		s.respondError(w, http.StatusUnauthorized, "unauthorized", err.Error())
		return
	}

	rawKind := strings.TrimSpace(r.URL.Query().Get("kind"))
	kind, ok := explore.ParseRecentSearchTermKind(rawKind)
	if !ok {
		s.respondError(w, http.StatusBadRequest, "invalid_recent_search_kind", "Arama turu gecersiz.")
		return
	}

	limit := 8
	if rawLimit := strings.TrimSpace(r.URL.Query().Get("limit")); rawLimit != "" {
		parsedLimit, parseErr := strconv.Atoi(rawLimit)
		if parseErr != nil {
			s.respondError(w, http.StatusBadRequest, "invalid_search_limit", "Arama limiti sayisal olmali.")
			return
		}
		limit = parsedLimit
	}

	ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
	defer cancel()

	response, err := s.repo.ListRecentSearchTerms(ctx, viewerID, kind, limit)
	if err != nil {
		switch {
		case errors.Is(err, explore.ErrInvalidRecentSearchAction):
			s.respondError(w, http.StatusBadRequest, "invalid_recent_search_action", "Son aramalar listesi alinamadi.")
		default:
			s.respondInternalError(w, "recent_search_terms_failed", err)
		}
		return
	}

	setPrivateCacheControl(w, 60)
	s.respondJSON(w, http.StatusOK, response)
}

func (s *Server) handleRecordExploreRecentSearchTerm(w http.ResponseWriter, r *http.Request) {
	var input explore.RecentSearchTermInput
	if err := s.decodeJSON(r, &input); err != nil {
		s.respondDecodeError(w, err, "invalid_recent_search_term_payload")
		return
	}

	viewerID, err := s.viewerID(r, "")
	if err != nil {
		s.respondError(w, http.StatusUnauthorized, "unauthorized", err.Error())
		return
	}

	kind, ok := explore.ParseRecentSearchTermKind(string(input.Kind))
	if !ok {
		s.respondError(w, http.StatusBadRequest, "invalid_recent_search_kind", "Arama turu gecersiz.")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
	defer cancel()

	item, err := s.repo.SaveRecentSearchTerm(ctx, viewerID, kind, input.Query)
	if err != nil {
		switch {
		case errors.Is(err, explore.ErrInvalidRecentSearchAction):
			s.respondError(w, http.StatusBadRequest, "invalid_recent_search_action", "Son arama gecmisi guncellenemedi.")
		default:
			s.respondInternalError(w, "save_recent_search_term_failed", err)
		}
		return
	}

	s.respondJSON(w, http.StatusOK, explore.RecentSearchMutationResponse{
		Kind:  string(item.Kind),
		Query: item.Query,
		Saved: true,
	})
}

func (s *Server) handleRemoveExploreRecentSearchTerm(w http.ResponseWriter, r *http.Request) {
	viewerID, err := s.viewerID(r, "")
	if err != nil {
		s.respondError(w, http.StatusUnauthorized, "unauthorized", err.Error())
		return
	}

	rawKind := strings.TrimSpace(r.URL.Query().Get("kind"))
	kind, ok := explore.ParseRecentSearchTermKind(rawKind)
	if !ok {
		s.respondError(w, http.StatusBadRequest, "invalid_recent_search_kind", "Arama turu gecersiz.")
		return
	}

	rawQuery := strings.TrimSpace(r.URL.Query().Get("q"))
	if rawQuery == "" {
		s.respondError(w, http.StatusBadRequest, "invalid_recent_search_query", "Arama ifadesi bos olamaz.")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
	defer cancel()

	removed, item, err := s.repo.RemoveRecentSearchTerm(ctx, viewerID, kind, rawQuery)
	if err != nil {
		switch {
		case errors.Is(err, explore.ErrInvalidRecentSearchAction):
			s.respondError(w, http.StatusBadRequest, "invalid_recent_search_action", "Son arama silinemedi.")
		default:
			s.respondInternalError(w, "remove_recent_search_term_failed", err)
		}
		return
	}

	s.respondJSON(w, http.StatusOK, explore.RecentSearchMutationResponse{
		Kind:    string(item.Kind),
		Query:   item.Query,
		Removed: removed,
	})
}

func (s *Server) handleClearExploreRecentSearchTerms(w http.ResponseWriter, r *http.Request) {
	viewerID, err := s.viewerID(r, "")
	if err != nil {
		s.respondError(w, http.StatusUnauthorized, "unauthorized", err.Error())
		return
	}

	rawKind := strings.TrimSpace(r.URL.Query().Get("kind"))
	kind, ok := explore.ParseRecentSearchTermKind(rawKind)
	if !ok {
		s.respondError(w, http.StatusBadRequest, "invalid_recent_search_kind", "Arama turu gecersiz.")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
	defer cancel()

	deletedCount, err := s.repo.ClearRecentSearchTerms(ctx, viewerID, kind)
	if err != nil {
		switch {
		case errors.Is(err, explore.ErrInvalidRecentSearchAction):
			s.respondError(w, http.StatusBadRequest, "invalid_recent_search_action", "Son aramalar temizlenemedi.")
		default:
			s.respondInternalError(w, "clear_recent_search_terms_failed", err)
		}
		return
	}

	s.respondJSON(w, http.StatusOK, explore.RecentSearchMutationResponse{
		Cleared:      true,
		DeletedCount: deletedCount,
		Kind:         string(kind),
	})
}

func (s *Server) handleExplorePopularSearchTerms(w http.ResponseWriter, r *http.Request) {
	viewerID, err := s.viewerID(r, "")
	if err != nil {
		s.respondError(w, http.StatusUnauthorized, "unauthorized", err.Error())
		return
	}

	rawKind := strings.TrimSpace(r.URL.Query().Get("kind"))
	kind, ok := explore.ParseRecentSearchTermKind(rawKind)
	if !ok {
		s.respondError(w, http.StatusBadRequest, "invalid_recent_search_kind", "Arama turu gecersiz.")
		return
	}

	limit := 8
	if rawLimit := strings.TrimSpace(r.URL.Query().Get("limit")); rawLimit != "" {
		parsedLimit, parseErr := strconv.Atoi(rawLimit)
		if parseErr != nil {
			s.respondError(w, http.StatusBadRequest, "invalid_search_limit", "Arama limiti sayisal olmali.")
			return
		}
		limit = parsedLimit
	}
	query := strings.TrimSpace(r.URL.Query().Get("q"))

	ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
	defer cancel()

	scoreModel := s.resolvePopularSearchScoreModel(r, viewerID)
	response, err := s.repo.SearchPopularSearchTerms(
		ctx,
		kind,
		query,
		limit,
		scoreModel,
	)
	if err != nil {
		switch {
		case errors.Is(err, explore.ErrInvalidRecentSearchAction):
			s.respondError(w, http.StatusBadRequest, "invalid_recent_search_action", "Populer arama onerileri alinamadi.")
		default:
			s.respondInternalError(w, "popular_search_terms_failed", err)
		}
		return
	}

	setPrivateCacheControl(w, 45)
	s.respondJSON(w, http.StatusOK, response)
}

func (s *Server) handleExplorePostSearch(w http.ResponseWriter, r *http.Request) {
	viewerID, err := s.viewerID(r, "")
	if err != nil {
		s.respondError(w, http.StatusUnauthorized, "unauthorized", err.Error())
		return
	}

	limit := 20
	if rawLimit := strings.TrimSpace(r.URL.Query().Get("limit")); rawLimit != "" {
		parsedLimit, parseErr := strconv.Atoi(rawLimit)
		if parseErr != nil {
			s.respondError(w, http.StatusBadRequest, "invalid_search_limit", "Arama limiti sayisal olmali.")
			return
		}
		limit = parsedLimit
	}

	query := strings.TrimSpace(r.URL.Query().Get("q"))
	cursor := strings.TrimSpace(r.URL.Query().Get("cursor"))
	filter, ok := explore.ParseSearchPostFilter(r.URL.Query().Get("mediaType"))
	if !ok {
		s.respondError(w, http.StatusBadRequest, "invalid_search_filter", "Arama filtresi gecersiz.")
		return
	}
	sortMode, ok := explore.ParseSearchPostSort(r.URL.Query().Get("sort"))
	if !ok {
		s.respondError(w, http.StatusBadRequest, "invalid_search_sort", "Arama siralamasi gecersiz.")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
	defer cancel()

	response, err := s.repo.SearchPosts(ctx, explore.SearchPostsQuery{
		Cursor:   cursor,
		Filter:   filter,
		Limit:    limit,
		Query:    query,
		Sort:     sortMode,
		ViewerID: viewerID,
	})
	if err != nil {
		switch {
		case errors.Is(err, explore.ErrInvalidSearchCursor):
			s.respondError(w, http.StatusBadRequest, "invalid_search_cursor", "Arama sayfasi gecersiz.")
		default:
			s.respondInternalError(w, "search_posts_failed", err)
		}
		return
	}

	setPrivateCacheControl(w, 30)
	s.respondJSON(w, http.StatusOK, response)
}

func (s *Server) handleExploreTrendingTags(w http.ResponseWriter, r *http.Request) {
	viewerID, err := s.viewerID(r, "")
	if err != nil {
		s.respondError(w, http.StatusUnauthorized, "unauthorized", err.Error())
		return
	}

	limit := 12
	if rawLimit := strings.TrimSpace(r.URL.Query().Get("limit")); rawLimit != "" {
		parsedLimit, parseErr := strconv.Atoi(rawLimit)
		if parseErr != nil {
			s.respondError(w, http.StatusBadRequest, "invalid_search_limit", "Arama limiti sayisal olmali.")
			return
		}
		limit = parsedLimit
	}
	if limit <= 0 {
		limit = 12
	}
	if limit > 40 {
		limit = 40
	}
	query := normalizeTrendingTagQuery(r.URL.Query().Get("q"))
	fetchLimit := limit
	if query != "" && fetchLimit < 40 {
		fetchLimit = 40
	}

	ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
	defer cancel()

	response, err := s.repo.SearchTrendingTags(ctx, viewerID, fetchLimit)
	if err != nil {
		s.respondInternalError(w, "search_trending_tags_failed", err)
		return
	}
	if query != "" {
		filtered := make([]explore.SearchTrendingTag, 0, len(response.Tags))
		for _, tag := range response.Tags {
			if strings.Contains(tag.Tag, query) {
				filtered = append(filtered, tag)
			}
		}
		sort.SliceStable(filtered, func(i int, j int) bool {
			left := filtered[i]
			right := filtered[j]
			leftScore := trendingTagMatchScore(left.Tag, query)
			rightScore := trendingTagMatchScore(right.Tag, query)
			if leftScore != rightScore {
				return leftScore > rightScore
			}
			if left.RecentCount != right.RecentCount {
				return left.RecentCount > right.RecentCount
			}
			if left.Score != right.Score {
				return left.Score > right.Score
			}
			if !left.LastUsedAt.Equal(right.LastUsedAt) {
				return left.LastUsedAt.After(right.LastUsedAt)
			}
			return left.Tag < right.Tag
		})
		if len(filtered) > limit {
			filtered = filtered[:limit]
		}
		response.Tags = filtered
	} else if len(response.Tags) > limit {
		response.Tags = response.Tags[:limit]
	}

	setPrivateCacheControl(w, 45)
	s.respondJSON(w, http.StatusOK, response)
}

func (s *Server) handleExploreTagDetail(w http.ResponseWriter, r *http.Request) {
	viewerID, err := s.viewerID(r, "")
	if err != nil {
		s.respondError(w, http.StatusUnauthorized, "unauthorized", err.Error())
		return
	}

	limit := 18
	if rawLimit := strings.TrimSpace(r.URL.Query().Get("limit")); rawLimit != "" {
		parsedLimit, parseErr := strconv.Atoi(rawLimit)
		if parseErr != nil {
			s.respondError(w, http.StatusBadRequest, "invalid_search_limit", "Arama limiti sayisal olmali.")
			return
		}
		limit = parsedLimit
	}

	rawTag := strings.TrimSpace(r.PathValue("tag"))
	cursor := strings.TrimSpace(r.URL.Query().Get("cursor"))

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	overview, err := s.repo.DescribeTag(ctx, viewerID, rawTag, 8)
	if err != nil {
		switch {
		case errors.Is(err, explore.ErrInvalidTagDetail):
			s.respondError(w, http.StatusBadRequest, "invalid_tag", "Etiket gecersiz.")
		default:
			s.respondInternalError(w, "tag_detail_failed", err)
		}
		return
	}

	tagQuery := "#" + overview.Tag.Tag
	topPostsResponse, err := s.repo.SearchPosts(ctx, explore.SearchPostsQuery{
		Filter:   explore.SearchPostFilterAll,
		Limit:    9,
		Query:    tagQuery,
		Sort:     explore.SearchPostSortPopular,
		ViewerID: viewerID,
	})
	if err != nil {
		switch {
		case errors.Is(err, explore.ErrInvalidSearchCursor):
			s.respondError(w, http.StatusBadRequest, "invalid_search_cursor", "Arama sayfasi gecersiz.")
		default:
			s.respondInternalError(w, "tag_top_posts_failed", err)
		}
		return
	}

	recentPostsResponse, err := s.repo.SearchPosts(ctx, explore.SearchPostsQuery{
		Cursor:   cursor,
		Filter:   explore.SearchPostFilterAll,
		Limit:    limit,
		Query:    tagQuery,
		Sort:     explore.SearchPostSortRecent,
		ViewerID: viewerID,
	})
	if err != nil {
		switch {
		case errors.Is(err, explore.ErrInvalidSearchCursor):
			s.respondError(w, http.StatusBadRequest, "invalid_search_cursor", "Arama sayfasi gecersiz.")
		default:
			s.respondInternalError(w, "tag_recent_posts_failed", err)
		}
		return
	}

	s.respondJSON(w, http.StatusOK, explore.TagDetailResponse{
		GeneratedAt:      time.Now().UTC(),
		RecentHasMore:    recentPostsResponse.HasMore,
		RecentNextCursor: recentPostsResponse.NextCursor,
		RecentPosts:      recentPostsResponse.Posts,
		RelatedTags:      overview.RelatedTags,
		Tag:              overview.Tag,
		TopPosts:         topPostsResponse.Posts,
	})
}

func (s *Server) handleFollowers(w http.ResponseWriter, r *http.Request) {
	viewerID, err := s.viewerID(r, "")
	if err != nil {
		s.respondError(w, http.StatusUnauthorized, "unauthorized", err.Error())
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
	defer cancel()

	response, err := s.repo.ListFollowers(ctx, viewerID)
	if err != nil {
		switch {
		case errors.Is(err, explore.ErrInvalidFollowAction):
			s.respondError(w, http.StatusBadRequest, "invalid_follow_action", "Takipci listesi alinimadi.")
		default:
			s.respondInternalError(w, "followers_query_failed", err)
		}
		return
	}

	setPrivateCacheControl(w, 45)
	s.respondJSON(w, http.StatusOK, response)
}

func (s *Server) handleFollowing(w http.ResponseWriter, r *http.Request) {
	viewerID, err := s.viewerID(r, "")
	if err != nil {
		s.respondError(w, http.StatusUnauthorized, "unauthorized", err.Error())
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
	defer cancel()

	response, err := s.repo.ListFollowing(ctx, viewerID)
	if err != nil {
		switch {
		case errors.Is(err, explore.ErrInvalidFollowAction):
			s.respondError(w, http.StatusBadRequest, "invalid_follow_action", "Takip listesi alinimadi.")
		default:
			s.respondInternalError(w, "following_query_failed", err)
		}
		return
	}

	setPrivateCacheControl(w, 45)
	s.respondJSON(w, http.StatusOK, response)
}

func (s *Server) handleStreetFriends(w http.ResponseWriter, r *http.Request) {
	viewerID, err := s.viewerID(r, "")
	if err != nil {
		s.respondError(w, http.StatusUnauthorized, "unauthorized", err.Error())
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
	defer cancel()

	cacheKey := s.cacheKey("street-friends", viewerID)
	var cached explore.StreetFriendListResponse
	if s.cacheGetJSON(ctx, cacheKey, &cached) {
		s.respondJSON(w, http.StatusOK, cached)
		return
	}

	response, err := s.repo.ListStreetFriends(ctx, viewerID)
	if err != nil {
		s.respondInternalError(w, "street_friends_query_failed", err)
		return
	}

	// Relationship lists are mostly stable. Keep them cached longer to avoid repeated DB hits.
	s.cacheSetJSON(ctx, cacheKey, 10*time.Minute, response)
	setPrivateCacheControl(w, 30)
	s.respondJSON(w, http.StatusOK, response)
}

func (s *Server) handleStreetFriendStatus(w http.ResponseWriter, r *http.Request) {
	friendID := strings.TrimSpace(r.PathValue("friendID"))
	if friendID == "" {
		s.respondError(w, http.StatusBadRequest, "invalid_friend_id", "friend id is required")
		return
	}

	viewerID, err := s.viewerID(r, "")
	if err != nil {
		s.respondError(w, http.StatusUnauthorized, "unauthorized", err.Error())
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
	defer cancel()

	response, err := s.repo.StreetFriendStatus(ctx, viewerID, friendID)
	if err != nil {
		switch {
		case errors.Is(err, explore.ErrInvalidStreetFriendAction):
			s.respondError(w, http.StatusBadRequest, "invalid_street_friend_action", "Yakındakiler durumu alinamadi.")
		default:
			s.respondInternalError(w, "street_friend_status_query_failed", err)
		}
		return
	}

	s.respondJSON(w, http.StatusOK, response)
}

func (s *Server) handleStreetFriendRequests(w http.ResponseWriter, r *http.Request) {
	viewerID, err := s.viewerID(r, "")
	if err != nil {
		s.respondError(w, http.StatusUnauthorized, "unauthorized", err.Error())
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
	defer cancel()

	response, err := s.repo.ListStreetFriendRequests(ctx, viewerID)
	if err != nil {
		s.respondInternalError(w, "street_friend_requests_query_failed", err)
		return
	}

	setPrivateCacheControl(w, 5)
	s.respondJSON(w, http.StatusOK, response)
}

func (s *Server) handleToggleFollow(w http.ResponseWriter, r *http.Request) {
	creatorID := strings.TrimSpace(r.PathValue("creatorID"))
	if creatorID == "" {
		s.respondError(w, http.StatusBadRequest, "invalid_creator_id", "creator id is required")
		return
	}

	var input explore.FollowInput
	if err := s.decodeJSON(r, &input); err != nil {
		s.respondDecodeError(w, err, "invalid_follow_payload")
		return
	}

	viewerID, err := s.viewerID(r, input.ViewerID)
	if err != nil {
		s.respondError(w, http.StatusUnauthorized, "unauthorized", err.Error())
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
	defer cancel()

	response, err := s.repo.ToggleFollow(ctx, viewerID, creatorID)
	if err != nil {
		switch {
		case errors.Is(err, explore.ErrCreatorNotFound):
			s.respondError(w, http.StatusNotFound, "creator_not_found", "Takip edilecek kullanici bulunamadi.")
		case errors.Is(err, explore.ErrBlockedRelationship):
			s.respondError(w, http.StatusForbidden, "blocked_relationship", "Bu kullanici ile etkilesim engellendi.")
		case errors.Is(err, explore.ErrInvalidFollowAction):
			s.respondError(w, http.StatusBadRequest, "invalid_follow_action", "Takip islemi gecersiz.")
		default:
			s.respondInternalError(w, "follow_toggle_failed", err)
		}
		return
	}

	// Anlık bildirim gönder (Redis Pub/Sub)
	if response.FollowRequestStatus == explore.FollowRequestStatusPendingOutgoing {
		notifID := explore.FollowRequestNotificationID(viewerID, creatorID)
		s.messageHub.BroadcastToUser(creatorID, map[string]any{
			"type": "notification.created",
			"notification": map[string]any{
				"actorId":    viewerID,
				"body":       "Sana yeni takip istegi gonderildi.",
				"channel":    "follow_requests",
				"createdAt":  time.Now().UTC().Format(time.RFC3339Nano),
				"fromUserId": viewerID,
				"id":         notifID,
				"isRead":     false,
				"metadata": map[string]any{
					"requesterId": viewerID,
					"targetId":    creatorID,
				},
				"title":  "Yeni takip istegi",
				"type":   "follow.request.created",
				"userId": creatorID,
			},
		})
		s.broadcastRequestRealtimeEvent(
			creatorID,
			"request.created",
			"follow",
			viewerID,
			creatorID,
			1,
			"created",
		)
	}

	s.cacheInvalidatePrefixes(
		ctx,
		s.cacheKey("following", viewerID),
		s.cacheKey("followers", creatorID),
		s.cacheKey("follow-requests", viewerID),
		s.cacheKey("follow-requests", creatorID),
	)

	s.respondJSON(w, http.StatusOK, response)
}

func (s *Server) handleUpsertStreetFriend(w http.ResponseWriter, r *http.Request) {
	creatorID := strings.TrimSpace(r.PathValue("creatorID"))
	if creatorID == "" {
		s.respondError(w, http.StatusBadRequest, "invalid_creator_id", "creator id is required")
		return
	}

	var input explore.FollowInput
	if err := s.decodeJSON(r, &input); err != nil {
		s.respondDecodeError(w, err, "invalid_street_friend_payload")
		return
	}

	viewerID, err := s.viewerID(r, input.ViewerID)
	if err != nil {
		s.respondError(w, http.StatusUnauthorized, "unauthorized", err.Error())
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
	defer cancel()

	response, err := s.repo.UpsertStreetFriend(ctx, viewerID, creatorID)
	if err != nil {
		switch {
		case errors.Is(err, explore.ErrCreatorNotFound):
			s.respondError(w, http.StatusNotFound, "creator_not_found", "Yakındakiler eklenecek kullanici bulunamadi.")
		case errors.Is(err, explore.ErrBlockedRelationship):
			s.respondError(w, http.StatusForbidden, "blocked_relationship", "Bu kullanici ile Yakındakiler baglantisi engellendi.")
		case errors.Is(err, explore.ErrInvalidStreetFriendAction):
			s.respondError(w, http.StatusBadRequest, "invalid_street_friend_action", "Yakındakiler islemi gecersiz.")
		default:
			s.respondInternalError(w, "street_friend_update_failed", err)
		}
		return
	}

	// Anlık bildirim gönder (Redis Pub/Sub)
	if response.StreetFriendStatus == explore.StreetFriendStatusPendingOutgoing {
		notifID := explore.StreetFriendRequestNotificationID(viewerID, creatorID)
		s.messageHub.BroadcastToUser(creatorID, map[string]any{
			"type": "notification.created",
			"notification": map[string]any{
				"actorId":    viewerID,
				"body":       "Sana yeni Yakındakiler istegi gonderildi.",
				"channel":    "follow_requests",
				"createdAt":  time.Now().UTC().Format(time.RFC3339Nano),
				"fromUserId": viewerID,
				"id":         notifID,
				"isRead":     false,
				"metadata": map[string]any{
					"requesterId": viewerID,
					"targetId":    creatorID,
				},
				"title":  "Yeni Yakındakiler istegi",
				"type":   "street_friend.request.created",
				"userId": creatorID,
			},
		})
		s.broadcastRequestRealtimeEvent(
			creatorID,
			"request.created",
			"street",
			viewerID,
			creatorID,
			1,
			"created",
		)
	}

	s.cacheInvalidatePrefixes(
		ctx,
		s.cacheKey("street-friends", viewerID),
		s.cacheKey("street-friend-requests", viewerID),
		s.cacheKey("street-friend-requests", creatorID),
	)

	s.respondJSON(w, http.StatusOK, response)
}

func (s *Server) handleRemoveFollower(w http.ResponseWriter, r *http.Request) {
	followerID := strings.TrimSpace(r.PathValue("followerID"))
	if followerID == "" {
		s.respondError(w, http.StatusBadRequest, "invalid_follower_id", "follower id is required")
		return
	}

	viewerID, err := s.viewerID(r, "")
	if err != nil {
		s.respondError(w, http.StatusUnauthorized, "unauthorized", err.Error())
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
	defer cancel()

	response, err := s.repo.RemoveFollower(ctx, viewerID, followerID)
	if err != nil {
		switch {
		case errors.Is(err, explore.ErrInvalidFollowAction):
			s.respondError(w, http.StatusBadRequest, "invalid_follow_action", "Takipci kaldirma islemi gecersiz.")
		default:
			s.respondInternalError(w, "remove_follower_failed", err)
		}
		return
	}

	s.respondJSON(w, http.StatusOK, response)
}

func (s *Server) handleRemoveStreetFriend(w http.ResponseWriter, r *http.Request) {
	friendID := strings.TrimSpace(r.PathValue("friendID"))
	if friendID == "" {
		s.respondError(w, http.StatusBadRequest, "invalid_friend_id", "friend id is required")
		return
	}

	viewerID, err := s.viewerID(r, "")
	if err != nil {
		s.respondError(w, http.StatusUnauthorized, "unauthorized", err.Error())
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
	defer cancel()

	statusBefore, statusErr := s.repo.StreetFriendStatus(ctx, viewerID, friendID)
	if statusErr != nil && !errors.Is(statusErr, explore.ErrInvalidStreetFriendAction) {
		s.respondInternalError(w, "street_friend_status_failed", statusErr)
		return
	}

	response, err := s.repo.RemoveStreetFriend(ctx, viewerID, friendID)
	if err != nil {
		switch {
		case errors.Is(err, explore.ErrInvalidStreetFriendAction):
			s.respondError(w, http.StatusBadRequest, "invalid_street_friend_action", "Yakındakiler arkadas kaldirma islemi gecersiz.")
		default:
			s.respondInternalError(w, "remove_street_friend_failed", err)
		}
		return
	}

	s.cacheInvalidatePrefixes(
		ctx,
		s.cacheKey("street-friends", viewerID),
		s.cacheKey("street-friend-requests", viewerID),
	)

	switch statusBefore.StreetFriendStatus {
	case explore.StreetFriendStatusPendingIncoming:
		s.broadcastRequestRealtimeEvent(
			viewerID,
			"request.cancelled",
			"street",
			friendID,
			viewerID,
			-1,
			"rejected",
		)
	case explore.StreetFriendStatusPendingOutgoing:
		s.broadcastRequestRealtimeEvent(
			friendID,
			"request.cancelled",
			"street",
			viewerID,
			friendID,
			-1,
			"removed",
		)
	}

	s.respondJSON(w, http.StatusOK, response)
}
