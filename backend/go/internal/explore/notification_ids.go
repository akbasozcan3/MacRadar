package explore

import "strings"

// FollowRequestNotificationID deterministic id for profile_notifications + realtime dedup.
func FollowRequestNotificationID(requesterID, recipientUserID string) string {
	return "follow_req_" + strings.TrimSpace(requesterID) + "_" + strings.TrimSpace(recipientUserID)
}

// StreetFriendRequestNotificationID deterministic id (requester → recipient).
func StreetFriendRequestNotificationID(requesterID, recipientUserID string) string {
	return "street_req_" + strings.TrimSpace(requesterID) + "_" + strings.TrimSpace(recipientUserID)
}
