package explore

import (
	"testing"
	"time"
)

func TestTimelineCursorRoundTrip(t *testing.T) {
	t.Parallel()

	source := timelineCursorState{
		CreatedAt: time.Date(2026, 3, 13, 10, 11, 12, 0, time.UTC),
		ID:        "cursor_1",
	}

	encoded, err := encodeTimelineCursor(source)
	if err != nil {
		t.Fatalf("encodeTimelineCursor() error = %v", err)
	}

	decoded, err := decodeTimelineCursor(encoded)
	if err != nil {
		t.Fatalf("decodeTimelineCursor() error = %v", err)
	}
	if decoded == nil {
		t.Fatal("decodeTimelineCursor() returned nil cursor")
	}
	if decoded.ID != source.ID || !decoded.CreatedAt.Equal(source.CreatedAt) {
		t.Fatalf("decoded cursor = %+v, want %+v", *decoded, source)
	}
}

func TestDecodeTimelineCursorRejectsInvalidPayload(t *testing.T) {
	t.Parallel()

	if _, err := decodeTimelineCursor("%%%invalid%%%"); err == nil {
		t.Fatal("expected invalid cursor error for malformed base64")
	}
}

func TestNormalizeConversationLimitBounds(t *testing.T) {
	t.Parallel()

	if got := normalizeConversationLimit(0); got != defaultConversationLimit {
		t.Fatalf("normalizeConversationLimit(0) = %d, want %d", got, defaultConversationLimit)
	}
	if got := normalizeConversationLimit(maxConversationLimit + 999); got != maxConversationLimit {
		t.Fatalf("normalizeConversationLimit(max+999) = %d, want %d", got, maxConversationLimit)
	}
}

func TestNormalizeConversationSearchTurkishCharacters(t *testing.T) {
	t.Parallel()

	got := normalizeConversationSearch("  @\u00c7a\u011fr\u0131 \u015e\u00d6F\u00d6R  ")
	want := "cagri sofor"
	if got != want {
		t.Fatalf("normalizeConversationSearch() = %q, want %q", got, want)
	}
}
