package server

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"macradar/backend/internal/config"
)

type mapboxGeocodingFeature struct {
	Center      []float64 `json:"center"`
	ID          string    `json:"id"`
	PlaceName   string    `json:"place_name"`
	PlaceType   []string  `json:"place_type"`
	Relevance   float64   `json:"relevance"`
	Text        string    `json:"text"`
}

type mapboxGeocodingResponse struct {
	Features []mapboxGeocodingFeature `json:"features"`
	Message  string                   `json:"message"`
}

func searchMapboxPlaces(
	ctx context.Context,
	cfg config.Config,
	query string,
	limit int,
	language string,
	country string,
) ([]explorePlaceSearchItem, error) {
	token := strings.TrimSpace(cfg.MapboxPublicToken)
	q := strings.TrimSpace(query)
	if token == "" || q == "" {
		return nil, nil
	}
	if limit < 1 {
		limit = 1
	}
	if limit > 8 {
		limit = 8
	}

	lang := strings.TrimSpace(language)
	if lang == "" {
		lang = "en"
	}

	base := fmt.Sprintf(
		"https://api.mapbox.com/geocoding/v5/mapbox.places/%s.json",
		url.PathEscape(q),
	)
	u, err := url.Parse(base)
	if err != nil {
		return nil, err
	}

	params := u.Query()
	params.Set("access_token", token)
	params.Set("autocomplete", "true")
	params.Set("language", lang)
	params.Set("limit", strconv.Itoa(limit))
	params.Set("types", "poi,address,postcode,neighborhood,locality,place,district,region,country")
	if c := strings.TrimSpace(strings.ToLower(country)); c != "" {
		params.Set("country", c)
	}
	u.RawQuery = params.Encode()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return nil, err
	}

	client := &http.Client{Timeout: 7 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return nil, err
	}

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("mapbox geocoding: status %d", resp.StatusCode)
	}

	var payload mapboxGeocodingResponse
	if err := json.Unmarshal(body, &payload); err != nil {
		return nil, err
	}
	if strings.TrimSpace(payload.Message) != "" {
		return nil, fmt.Errorf("mapbox geocoding: %s", strings.TrimSpace(payload.Message))
	}

	out := make([]explorePlaceSearchItem, 0, len(payload.Features))
	for _, feature := range payload.Features {
		if len(feature.Center) < 2 {
			continue
		}
		name := strings.TrimSpace(feature.Text)
		full := strings.TrimSpace(feature.PlaceName)
		mid := strings.TrimSpace(feature.ID)
		if name == "" || full == "" || mid == "" {
			continue
		}
		lon := feature.Center[0]
		lat := feature.Center[1]
		placeTypes := make([]string, 0, len(feature.PlaceType))
		for _, pt := range feature.PlaceType {
			t := strings.TrimSpace(strings.ToLower(pt))
			if t != "" {
				placeTypes = append(placeTypes, t)
			}
		}
		if len(placeTypes) == 0 {
			placeTypes = []string{"place"}
		}
		rel := feature.Relevance
		if rel <= 0 {
			rel = 0.5
		}
		out = append(out, explorePlaceSearchItem{
			FullAddress: full,
			Latitude:    lat,
			Longitude:   lon,
			MapboxID:    mid,
			Name:        name,
			PlaceType:   placeTypes,
			Relevance:   rel,
		})
		if len(out) >= limit {
			break
		}
	}

	return out, nil
}
