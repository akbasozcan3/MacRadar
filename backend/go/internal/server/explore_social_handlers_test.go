package server

import (
	"net/http/httptest"
	"testing"

	"macradar/backend/internal/config"
	"macradar/backend/internal/explore"
)

func TestStableUserABBucketDeterministic(t *testing.T) {
	t.Parallel()

	first := stableUserABBucket("viewer_42")
	second := stableUserABBucket("viewer_42")

	if first != second {
		t.Fatalf("stableUserABBucket should be deterministic, got %d and %d", first, second)
	}
	if first < 0 || first > 99 {
		t.Fatalf("stableUserABBucket should return value in [0,99], got %d", first)
	}
}

func TestResolvePopularSearchScoreModelQueryParamOverride(t *testing.T) {
	t.Parallel()

	server := &Server{
		cfg: config.Config{
			SearchPopularABEnabled:       true,
			SearchPopularBTrafficPercent: 0,
		},
	}
	request := httptest.NewRequest("GET", "/api/v1/explore/search/popular-terms?scoreModel=b", nil)

	model := server.resolvePopularSearchScoreModel(request, "viewer_1")
	if model != explore.PopularSearchScoreModelB {
		t.Fatalf("score model = %q, want %q", model, explore.PopularSearchScoreModelB)
	}
}

func TestResolvePopularSearchScoreModelABDisabled(t *testing.T) {
	t.Parallel()

	server := &Server{
		cfg: config.Config{
			SearchPopularABEnabled:       false,
			SearchPopularBTrafficPercent: 100,
		},
	}
	request := httptest.NewRequest("GET", "/api/v1/explore/search/popular-terms", nil)

	model := server.resolvePopularSearchScoreModel(request, "viewer_1")
	if model != explore.PopularSearchScoreModelA {
		t.Fatalf("score model = %q, want %q", model, explore.PopularSearchScoreModelA)
	}
}

func TestResolvePopularSearchScoreModelTrafficBounds(t *testing.T) {
	t.Parallel()

	request := httptest.NewRequest("GET", "/api/v1/explore/search/popular-terms", nil)

	serverAtZero := &Server{
		cfg: config.Config{
			SearchPopularABEnabled:       true,
			SearchPopularBTrafficPercent: 0,
		},
	}
	if model := serverAtZero.resolvePopularSearchScoreModel(request, "viewer_2"); model != explore.PopularSearchScoreModelA {
		t.Fatalf("score model at 0%% traffic = %q, want %q", model, explore.PopularSearchScoreModelA)
	}

	serverAtHundred := &Server{
		cfg: config.Config{
			SearchPopularABEnabled:       true,
			SearchPopularBTrafficPercent: 100,
		},
	}
	if model := serverAtHundred.resolvePopularSearchScoreModel(request, "viewer_2"); model != explore.PopularSearchScoreModelB {
		t.Fatalf("score model at 100%% traffic = %q, want %q", model, explore.PopularSearchScoreModelB)
	}
}

func TestResolvePopularSearchScoreModelUsesStableBucketThreshold(t *testing.T) {
	t.Parallel()

	const viewerID = "viewer_threshold_case"
	bucket := stableUserABBucket(viewerID)
	request := httptest.NewRequest("GET", "/api/v1/explore/search/popular-terms", nil)

	serverControl := &Server{
		cfg: config.Config{
			SearchPopularABEnabled:       true,
			SearchPopularBTrafficPercent: bucket,
		},
	}
	if model := serverControl.resolvePopularSearchScoreModel(request, viewerID); model != explore.PopularSearchScoreModelA {
		t.Fatalf("score model at threshold=%d for bucket=%d = %q, want %q", bucket, bucket, model, explore.PopularSearchScoreModelA)
	}

	serverTreatment := &Server{
		cfg: config.Config{
			SearchPopularABEnabled:       true,
			SearchPopularBTrafficPercent: bucket + 1,
		},
	}
	if model := serverTreatment.resolvePopularSearchScoreModel(request, viewerID); model != explore.PopularSearchScoreModelB {
		t.Fatalf("score model at threshold=%d for bucket=%d = %q, want %q", bucket+1, bucket, model, explore.PopularSearchScoreModelB)
	}
}
