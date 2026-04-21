export type TabKey = 'home' | 'explore' | 'messages' | 'profile' | 'notifications';
export type ExploreViewerPost = {
  authorAvatarUrl?: string;
  authorId?: string;
  authorUsername?: string;
  caption: string;
  createdAt: string;
  id: string;
  location: string;
  mediaType: string;
  mediaUrl: string;
  thumbnailUrl?: string;
  stats?: {
    bookmarksCount?: number;
    commentsCount?: number;
    likesCount?: number;
    sharesCount?: number;
  };
  viewerState?: {
    followRequestStatus?: 'none' | 'pending_incoming' | 'pending_outgoing';
    isBookmarked?: boolean;
    isFollowing?: boolean;
    isLiked?: boolean;
    isStreetFriend?: boolean;
    streetFriendStatus?:
      | 'accepted'
      | 'none'
      | 'pending_incoming'
      | 'pending_outgoing';
  };
};

export type ExploreViewerRequest = {
  fromProfile?: boolean;
  initialIndex: number;
  posts: ExploreViewerPost[];
  sourceTab?: 'liked' | 'saved';
};

export type ExploreSegment = 'Takipte' | 'Sizin \u0130\u00e7in' | 'Ke\u015ffet';

export interface TabItem {
  key: TabKey;
  label: string;
  icon: string;
}

export interface ActionOption {
  id: string;
  label: string;
  description: string;
  icon: string;
}

export interface MapHotspot {
  id: string;
  name: string;
  district: string;
  eta: string;
  top: string;
  left: string;
  accentColor: string;
}

export interface NearbyAction {
  id: string;
  title: string;
  subtitle: string;
  eta: string;
  icon: string;
}

export interface ExploreCard {
  id: string;
  eyebrow: string;
  title: string;
  description: string;
  badge: string;
  location: string;
  participants: string;
}

export interface SearchSection {
  title: string;
  items: string[];
}

export interface MessagePreview {
  id: string;
  name: string;
  message: string;
  time: string;
  status: string;
  accentColor: string;
}

export interface ProfileStat {
  id: string;
  label: string;
  value: string;
  icon: string;
}

export interface VehicleHighlight {
  id: string;
  nickname: string;
  model: string;
  detail: string;
  tag: string;
}
