package explore

import "testing"

func TestNormalizeSegment(t *testing.T) {
	t.Parallel()

	testCases := map[string]Segment{
		"kesfet":     SegmentExplore,
		"takipte":    SegmentFollowing,
		"SIZIN ICIN": SegmentForYou,
		"unknown":    SegmentExplore,
	}

	for input, expected := range testCases {
		input := input
		expected := expected

		t.Run(input, func(t *testing.T) {
			t.Parallel()

			if actual := NormalizeSegment(input); actual != expected {
				t.Fatalf("NormalizeSegment(%q) = %q, want %q", input, actual, expected)
			}
		})
	}
}

func TestNormalizeReactionKind(t *testing.T) {
	t.Parallel()

	testCases := map[string]ReactionKind{
		"like":     ReactionLike,
		"bookmark": ReactionBookmark,
		"share":    ReactionShare,
		"other":    ReactionLike,
	}

	for input, expected := range testCases {
		input := input
		expected := expected

		t.Run(input, func(t *testing.T) {
			t.Parallel()

			if actual := NormalizeReactionKind(input); actual != expected {
				t.Fatalf("NormalizeReactionKind(%q) = %q, want %q", input, actual, expected)
			}
		})
	}
}

func TestParseReactionKind(t *testing.T) {
	t.Parallel()

	testCases := []struct {
		input    string
		ok       bool
		expected ReactionKind
	}{
		{input: "like", ok: true, expected: ReactionLike},
		{input: "bookmark", ok: true, expected: ReactionBookmark},
		{input: "share", ok: true, expected: ReactionShare},
		{input: " SHARE ", ok: true, expected: ReactionShare},
		{input: "other", ok: false, expected: ""},
	}

	for _, testCase := range testCases {
		testCase := testCase
		t.Run(testCase.input, func(t *testing.T) {
			t.Parallel()

			actual, ok := ParseReactionKind(testCase.input)
			if ok != testCase.ok {
				t.Fatalf("ParseReactionKind(%q) ok = %t, want %t", testCase.input, ok, testCase.ok)
			}
			if actual != testCase.expected {
				t.Fatalf("ParseReactionKind(%q) kind = %q, want %q", testCase.input, actual, testCase.expected)
			}
		})
	}
}

func TestNormalizePostVisibility(t *testing.T) {
	t.Parallel()

	testCases := map[string]PostVisibility{
		"public":    PostVisibilityPublic,
		"PRIVATE":   PostVisibilityPrivate,
		" friends ": PostVisibilityFriends,
		"other":     PostVisibilityPublic,
	}

	for input, expected := range testCases {
		input := input
		expected := expected

		t.Run(input, func(t *testing.T) {
			t.Parallel()

			if actual := NormalizePostVisibility(input); actual != expected {
				t.Fatalf("NormalizePostVisibility(%q) = %q, want %q", input, actual, expected)
			}
		})
	}
}

func TestParsePostVisibility(t *testing.T) {
	t.Parallel()

	testCases := []struct {
		input    string
		ok       bool
		expected PostVisibility
	}{
		{input: "public", ok: true, expected: PostVisibilityPublic},
		{input: "friends", ok: true, expected: PostVisibilityFriends},
		{input: "private", ok: true, expected: PostVisibilityPrivate},
		{input: " PRIVATE ", ok: true, expected: PostVisibilityPrivate},
		{input: "other", ok: false, expected: ""},
	}

	for _, testCase := range testCases {
		testCase := testCase
		t.Run(testCase.input, func(t *testing.T) {
			t.Parallel()

			actual, ok := ParsePostVisibility(testCase.input)
			if ok != testCase.ok {
				t.Fatalf("ParsePostVisibility(%q) ok = %t, want %t", testCase.input, ok, testCase.ok)
			}
			if actual != testCase.expected {
				t.Fatalf("ParsePostVisibility(%q) visibility = %q, want %q", testCase.input, actual, testCase.expected)
			}
		})
	}
}

func TestNormalizeSearchPostFilter(t *testing.T) {
	t.Parallel()

	testCases := map[string]SearchPostFilter{
		"":      SearchPostFilterAll,
		"all":   SearchPostFilterAll,
		"photo": SearchPostFilterPhoto,
		"VIDEO": SearchPostFilterVideo,
		"other": SearchPostFilterAll,
	}

	for input, expected := range testCases {
		input := input
		expected := expected

		t.Run(input, func(t *testing.T) {
			t.Parallel()

			if actual := NormalizeSearchPostFilter(input); actual != expected {
				t.Fatalf("NormalizeSearchPostFilter(%q) = %q, want %q", input, actual, expected)
			}
		})
	}
}

func TestParseSearchPostFilter(t *testing.T) {
	t.Parallel()

	testCases := []struct {
		input    string
		ok       bool
		expected SearchPostFilter
	}{
		{input: "", ok: true, expected: SearchPostFilterAll},
		{input: "all", ok: true, expected: SearchPostFilterAll},
		{input: "photo", ok: true, expected: SearchPostFilterPhoto},
		{input: " video ", ok: true, expected: SearchPostFilterVideo},
		{input: "gif", ok: false, expected: ""},
	}

	for _, testCase := range testCases {
		testCase := testCase
		t.Run(testCase.input, func(t *testing.T) {
			t.Parallel()

			actual, ok := ParseSearchPostFilter(testCase.input)
			if ok != testCase.ok {
				t.Fatalf("ParseSearchPostFilter(%q) ok = %t, want %t", testCase.input, ok, testCase.ok)
			}
			if actual != testCase.expected {
				t.Fatalf("ParseSearchPostFilter(%q) filter = %q, want %q", testCase.input, actual, testCase.expected)
			}
		})
	}
}

func TestNormalizeSearchPostSort(t *testing.T) {
	t.Parallel()

	testCases := map[string]SearchPostSort{
		"":         SearchPostSortRelevant,
		"recent":   SearchPostSortRecent,
		"POPULAR":  SearchPostSortPopular,
		"relevant": SearchPostSortRelevant,
		"other":    SearchPostSortRelevant,
	}

	for input, expected := range testCases {
		input := input
		expected := expected

		t.Run(input, func(t *testing.T) {
			t.Parallel()

			if actual := NormalizeSearchPostSort(input); actual != expected {
				t.Fatalf("NormalizeSearchPostSort(%q) = %q, want %q", input, actual, expected)
			}
		})
	}
}

func TestParseSearchPostSort(t *testing.T) {
	t.Parallel()

	testCases := []struct {
		input    string
		ok       bool
		expected SearchPostSort
	}{
		{input: "", ok: true, expected: SearchPostSortRelevant},
		{input: "relevant", ok: true, expected: SearchPostSortRelevant},
		{input: "recent", ok: true, expected: SearchPostSortRecent},
		{input: " popular ", ok: true, expected: SearchPostSortPopular},
		{input: "oldest", ok: false, expected: ""},
	}

	for _, testCase := range testCases {
		testCase := testCase
		t.Run(testCase.input, func(t *testing.T) {
			t.Parallel()

			actual, ok := ParseSearchPostSort(testCase.input)
			if ok != testCase.ok {
				t.Fatalf("ParseSearchPostSort(%q) ok = %t, want %t", testCase.input, ok, testCase.ok)
			}
			if actual != testCase.expected {
				t.Fatalf("ParseSearchPostSort(%q) sort = %q, want %q", testCase.input, actual, testCase.expected)
			}
		})
	}
}

func TestNormalizeExploreSearchText(t *testing.T) {
	t.Parallel()

	testCases := []struct {
		input        string
		trimPrefixes string
		expected     string
	}{
		{input: "  @Çağrı  ŞÖFÖR ", trimPrefixes: "@", expected: "cagri sofor"},
		{input: " #İstanbul  Köprü ", trimPrefixes: "#@", expected: "istanbul kopru"},
		{input: "normal text", trimPrefixes: "", expected: "normal text"},
	}

	for _, testCase := range testCases {
		testCase := testCase
		t.Run(testCase.input, func(t *testing.T) {
			t.Parallel()

			if actual := normalizeExploreSearchText(testCase.input, testCase.trimPrefixes); actual != testCase.expected {
				t.Fatalf(
					"normalizeExploreSearchText(%q, %q) = %q, want %q",
					testCase.input,
					testCase.trimPrefixes,
					actual,
					testCase.expected,
				)
			}
		})
	}
}
