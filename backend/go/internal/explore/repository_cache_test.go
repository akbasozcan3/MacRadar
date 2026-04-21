package explore

import (
	"testing"
	"time"
)

func TestPlaylistCacheRoundTripKeepsImmutableCopy(t *testing.T) {
	t.Parallel()

	repo := NewRepository(nil)
	now := time.Now().UTC()

	source := &Playlist{
		ID:    "playlist_1",
		Title: "Initial",
	}
	repo.storePlaylistCache(SegmentExplore, source, now.Add(time.Minute))

	source.Title = "Mutated Source"

	cached, ok := repo.readPlaylistCache(SegmentExplore, now)
	if !ok {
		t.Fatal("expected playlist cache hit")
	}
	if cached == nil {
		t.Fatal("expected cached playlist, got nil")
	}
	if cached.Title != "Initial" {
		t.Fatalf("cached title = %q, want %q", cached.Title, "Initial")
	}

	cached.Title = "Mutated Read"
	cachedAgain, ok := repo.readPlaylistCache(SegmentExplore, now)
	if !ok || cachedAgain == nil {
		t.Fatal("expected second playlist cache hit")
	}
	if cachedAgain.Title != "Initial" {
		t.Fatalf("cached title after read mutation = %q, want %q", cachedAgain.Title, "Initial")
	}
}

func TestPlaylistCacheExpiryAndNilCaching(t *testing.T) {
	t.Parallel()

	repo := NewRepository(nil)
	now := time.Now().UTC()

	repo.storePlaylistCache(SegmentFollowing, &Playlist{ID: "expired"}, now.Add(-time.Second))
	if _, ok := repo.readPlaylistCache(SegmentFollowing, now); ok {
		t.Fatal("expected expired cache miss")
	}

	repo.storePlaylistCache(SegmentFollowing, nil, now.Add(time.Minute))
	playlist, ok := repo.readPlaylistCache(SegmentFollowing, now)
	if !ok {
		t.Fatal("expected cached nil playlist hit")
	}
	if playlist != nil {
		t.Fatalf("expected nil playlist, got %+v", playlist)
	}
}
