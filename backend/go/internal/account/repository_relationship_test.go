package account

import "testing"

func TestViewerFollowRequestState(t *testing.T) {
	t.Parallel()

	testCases := []struct {
		isFollowing bool
		name        string
		requestedBy string
		viewerID    string
		want        FollowRequestStatus
	}{
		{
			name:        "following overrides request",
			isFollowing: true,
			requestedBy: "viewer_1",
			viewerID:    "viewer_1",
			want:        FollowRequestStatusNone,
		},
		{
			name:        "outgoing request",
			isFollowing: false,
			requestedBy: "viewer_1",
			viewerID:    "viewer_1",
			want:        FollowRequestStatusPendingOutgoing,
		},
		{
			name:        "incoming request",
			isFollowing: false,
			requestedBy: "target_2",
			viewerID:    "viewer_1",
			want:        FollowRequestStatusPendingIncoming,
		},
		{
			name:        "no request",
			isFollowing: false,
			requestedBy: "",
			viewerID:    "viewer_1",
			want:        FollowRequestStatusNone,
		},
	}

	for _, testCase := range testCases {
		testCase := testCase
		t.Run(testCase.name, func(t *testing.T) {
			t.Parallel()

			got := viewerFollowRequestState(
				testCase.isFollowing,
				testCase.requestedBy,
				testCase.viewerID,
			)

			if got != testCase.want {
				t.Fatalf("viewerFollowRequestState() = %q, want %q", got, testCase.want)
			}
		})
	}
}
