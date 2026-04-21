function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function createDemoCommunitySeed() {
  const users = [
    {
      authProvider: 'google',
      avatarUrl:
        'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=400&q=80',
      bio: 'Sehir ici gece rotalari ve temiz build paylasimlari.',
      birthYear: 1996,
      city: 'Istanbul',
      createdAt: '2026-03-18T09:15:00.000Z',
      email: 'demo.selin@macradar.local',
      favoriteCar: 'Audi RS6 Avant',
      fullName: 'Selin Aydin',
      heroTagline: 'Night drive curator and detail-first garage storyteller.',
      id: 'user_demo_selin',
      isVerified: true,
      lastLoginAt: '2026-03-26T10:12:00.000Z',
      passwordHash: '',
      status: 'active',
      username: 'selinroads',
    },
    {
      authProvider: 'google',
      avatarUrl:
        'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=400&q=80',
      bio: 'Turbo sedan build notlari, rota ve pist gunlukleri.',
      birthYear: 1993,
      city: 'Ankara',
      createdAt: '2026-03-17T12:05:00.000Z',
      email: 'demo.emre@macradar.local',
      favoriteCar: 'BMW M3 Touring',
      fullName: 'Emre Karan',
      heroTagline: 'Street-friendly performance builds and weekend loops.',
      id: 'user_demo_emre',
      isVerified: true,
      lastLoginAt: '2026-03-26T09:48:00.000Z',
      passwordHash: '',
      status: 'active',
      username: 'emregarage',
    },
    {
      authProvider: 'facebook',
      avatarUrl:
        'https://images.unsplash.com/photo-1438761681033-6461ffad8d80?auto=format&fit=crop&w=400&q=80',
      bio: 'Retro detaylar, soft color grading ve pazar sabahi cruise.',
      birthYear: 1995,
      city: 'Izmir',
      createdAt: '2026-03-16T08:45:00.000Z',
      email: 'demo.lara@macradar.local',
      favoriteCar: 'Porsche 964',
      fullName: 'Lara Demir',
      heroTagline: 'Retro street culture with clean morning light.',
      id: 'user_demo_lara',
      isVerified: false,
      lastLoginAt: '2026-03-26T08:31:00.000Z',
      passwordHash: '',
      status: 'active',
      username: 'laracruise',
    },
    {
      authProvider: 'google',
      avatarUrl:
        'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?auto=format&fit=crop&w=400&q=80',
      bio: 'Track day checklist, wheel setup ve video ozetleri.',
      birthYear: 1991,
      city: 'Bursa',
      createdAt: '2026-03-15T14:10:00.000Z',
      email: 'demo.mert@macradar.local',
      favoriteCar: 'Toyota GR Yaris',
      fullName: 'Mert Yilmaz',
      heroTagline: 'Track notes, setup changes and sharp corner exits.',
      id: 'user_demo_mert',
      isVerified: true,
      lastLoginAt: '2026-03-26T07:54:00.000Z',
      passwordHash: '',
      status: 'active',
      username: 'mertapex',
    },
  ];

  const privacySettings = users.map(user => ({
    isMapVisible: true,
    isPrivateAccount: false,
    updatedAt: '2026-03-26T10:00:00.000Z',
    userId: user.id,
  }));

  const appSettings = users.map(user => ({
    gender: 'prefer_not_to_say',
    language: 'tr',
    notifyFollowRequests: true,
    notifyMessages: true,
    notifyPostLikes: true,
    onlyFollowedUsersCanMessage: false,
    updatedAt: '2026-03-26T10:00:00.000Z',
    userId: user.id,
  }));

  const follows = [
    {
      followedUserId: 'user_demo_selin',
      followerId: 'user_demo_emre',
      id: 'follow_demo_001',
      requestedAt: '2026-03-20T10:00:00.000Z',
    },
    {
      followedUserId: 'user_demo_selin',
      followerId: 'user_demo_lara',
      id: 'follow_demo_002',
      requestedAt: '2026-03-20T10:04:00.000Z',
    },
    {
      followedUserId: 'user_demo_emre',
      followerId: 'user_demo_mert',
      id: 'follow_demo_003',
      requestedAt: '2026-03-20T10:10:00.000Z',
    },
    {
      followedUserId: 'user_demo_lara',
      followerId: 'user_demo_selin',
      id: 'follow_demo_004',
      requestedAt: '2026-03-20T10:12:00.000Z',
    },
    {
      followedUserId: 'user_demo_mert',
      followerId: 'user_demo_selin',
      id: 'follow_demo_005',
      requestedAt: '2026-03-20T10:16:00.000Z',
    },
  ];

  const streetFriends = [
    {
      createdAt: '2026-03-22T21:10:00.000Z',
      id: 'street_demo_001',
      status: 'accepted',
      userId1: 'user_demo_selin',
      userId2: 'user_demo_mert',
    },
    {
      createdAt: '2026-03-23T20:18:00.000Z',
      id: 'street_demo_002',
      status: 'accepted',
      userId1: 'user_demo_emre',
      userId2: 'user_demo_lara',
    },
  ];

  const demoPosts = [
    {
      authorId: 'user_demo_selin',
      caption: 'Sahil hattinda kisa bir loop. #nightdrive #cars #istanbul',
      createdAt: '2026-03-25T20:10:00.000Z',
      id: 'demo_post_001',
      isLive: true,
      location: 'Bebek Sahil',
      mediaType: 'photo',
      mediaUrl:
        'https://images.unsplash.com/photo-1503376780353-7e6692767b70?auto=format&fit=crop&w=900&q=80',
      segment: 'kesfet',
      stats: {
        bookmarksCount: 18,
        commentsCount: 9,
        likesCount: 124,
        sharesCount: 7,
      },
      userId: 'user_demo_selin',
      username: 'selinroads',
      visibility: 'public',
    },
    {
      authorId: 'user_demo_emre',
      caption: 'Turbo spool sesi ve temiz çıkış. #turbo #video #trackday',
      createdAt: '2026-03-25T18:25:00.000Z',
      id: 'demo_post_002',
      isLive: true,
      location: 'Intercity Paddock',
      mediaType: 'video',
      mediaUrl:
        'https://storage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4',
      segment: 'sizin-icin',
      stats: {
        bookmarksCount: 31,
        commentsCount: 14,
        likesCount: 202,
        sharesCount: 28,
      },
      userId: 'user_demo_emre',
      username: 'emregarage',
      visibility: 'public',
    },
    {
      authorId: 'user_demo_lara',
      caption: 'Sabah isigi ve soft tonlar. #retro #stance #izmir',
      createdAt: '2026-03-24T08:12:00.000Z',
      id: 'demo_post_003',
      isLive: true,
      location: 'Alsancak',
      mediaType: 'photo',
      mediaUrl:
        'https://images.unsplash.com/photo-1492144534655-ae79c964c9d7?auto=format&fit=crop&w=900&q=80',
      segment: 'kesfet',
      stats: {
        bookmarksCount: 22,
        commentsCount: 6,
        likesCount: 148,
        sharesCount: 11,
      },
      userId: 'user_demo_lara',
      username: 'laracruise',
      visibility: 'public',
    },
    {
      authorId: 'user_demo_mert',
      caption: 'Kisa apex videosu. #apex #hotlap #video',
      createdAt: '2026-03-24T15:40:00.000Z',
      id: 'demo_post_004',
      isLive: true,
      location: 'Bursa Oto',
      mediaType: 'video',
      mediaUrl:
        'https://storage.googleapis.com/gtv-videos-bucket/sample/ForBiggerEscapes.mp4',
      segment: 'takipte',
      stats: {
        bookmarksCount: 12,
        commentsCount: 5,
        likesCount: 93,
        sharesCount: 9,
      },
      userId: 'user_demo_mert',
      username: 'mertapex',
      visibility: 'public',
    },
    {
      authorId: 'user_demo_selin',
      caption: 'Detailing sonrasi ilk çıkış. #detailing #cars #gloss',
      createdAt: '2026-03-23T19:30:00.000Z',
      id: 'demo_post_005',
      isLive: true,
      location: 'Maslak',
      mediaType: 'photo',
      mediaUrl:
        'https://images.unsplash.com/photo-1489824904134-891ab64532f1?auto=format&fit=crop&w=900&q=80',
      segment: 'sizin-icin',
      stats: {
        bookmarksCount: 19,
        commentsCount: 8,
        likesCount: 132,
        sharesCount: 10,
      },
      userId: 'user_demo_selin',
      username: 'selinroads',
      visibility: 'public',
    },
    {
      authorId: 'user_demo_emre',
      caption: 'Garaj notu: yeni wheel setup. #garage #wheels #build',
      createdAt: '2026-03-22T17:02:00.000Z',
      id: 'demo_post_006',
      isLive: true,
      location: 'Ankara West Garage',
      mediaType: 'photo',
      mediaUrl:
        'https://images.unsplash.com/photo-1494905998402-395d579af36f?auto=format&fit=crop&w=900&q=80',
      segment: 'takipte',
      stats: {
        bookmarksCount: 17,
        commentsCount: 7,
        likesCount: 109,
        sharesCount: 6,
      },
      userId: 'user_demo_emre',
      username: 'emregarage',
      visibility: 'public',
    },
  ];

  return {
    appSettings: clone(appSettings),
    follows: clone(follows),
    postReports: [],
    userReports: [],
    posts: clone(demoPosts),
    privacySettings: clone(privacySettings),
    profilePosts: clone(demoPosts),
    streetFriends: clone(streetFriends),
    users: clone(users),
  };
}

module.exports = {
  createDemoCommunitySeed,
};
