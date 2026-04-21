insert into users (id, username, avatar_url, is_verified) values
  ('user_viewer_local', 'macradar.local', 'https://images.unsplash.com/photo-1544723795-3fb6469f5b39?auto=format&fit=crop&w=200&q=80', true),
  ('user_gokhan', 'GokhanDrive', 'https://images.unsplash.com/photo-1599566150163-29194dcaad36?auto=format&fit=crop&w=200&q=80', true),
  ('user_deniz', 'DenizRoute', 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=200&q=80', true),
  ('user_kerem', 'KeremFit', 'https://images.unsplash.com/photo-1527980965255-d3b416303d12?auto=format&fit=crop&w=200&q=80', false),
  ('user_mina', 'MinaRoad', 'https://images.unsplash.com/photo-1438761681033-6461ffad8d80?auto=format&fit=crop&w=200&q=80', true),
  ('user_onur', 'OnurNight', 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=200&q=80', false)
on conflict (id) do nothing;

insert into spotify_playlists (
  id,
  spotify_playlist_id,
  title,
  subtitle,
  cover_image_url,
  open_url,
  embed_url,
  theme,
  accent_color
) values (
  'playlist_discovery',
  '71bTdg4GvnVU0ME85qOtm5',
  'Road Radar: Discovery Mix',
  'Spotify playlist served by the Go backend',
  'https://images.unsplash.com/photo-1511379938547-c1f69419868d?auto=format&fit=crop&w=500&q=80',
  'https://open.spotify.com/playlist/71bTdg4GvnVU0ME85qOtm5',
  'https://open.spotify.com/embed/playlist/71bTdg4GvnVU0ME85qOtm5?utm_source=generator&theme=0',
  0,
  '#1DB954'
) on conflict (id) do update set
  title = excluded.title,
  subtitle = excluded.subtitle,
  cover_image_url = excluded.cover_image_url,
  open_url = excluded.open_url,
  embed_url = excluded.embed_url,
  accent_color = excluded.accent_color;

insert into segment_playlists (segment, playlist_id) values
  ('kesfet', 'playlist_discovery'),
  ('takipte', 'playlist_discovery'),
  ('sizin-icin', 'playlist_discovery')
on conflict (segment) do update set playlist_id = excluded.playlist_id;

insert into posts (
  id,
  user_id,
  segment,
  media_type,
  media_url,
  caption,
  location_name,
  track_title,
  track_preview_url,
  likes_count,
  comments_count,
  bookmarks_count,
  shares_count,
  is_live,
  sort_order,
  created_at
) values
  (
    'post_1',
    'user_gokhan',
    'kesfet',
    'photo',
    'https://images.unsplash.com/photo-1510525009512-ad7fc13eefab?auto=format&fit=crop&w=1200&q=80',
    'Italia Alps route. Long drive, cold air, clean road.',
    'Trentino Dolomites',
    'Blinding Lights - The Weeknd',
    'https://p.scdn.co/mp3-preview/b6fd4bdfe63ceb7b5f137d4ee714652285dbfdf9?cid=v1',
    5200,
    142,
    800,
    423,
    true,
    10,
    now() - interval '2 hours'
  ),
  (
    'post_2',
    'user_deniz',
    'takipte',
    'photo',
    'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=1200&q=80',
    'Sunrise run on the shoreline. Summer calendar is live.',
    'Kas shoreline',
    'Levitating - Dua Lipa',
    'https://p.scdn.co/mp3-preview/a91cb2ed883ba56f5ef5b8719c23eb11b66feec2?cid=v1',
    120000,
    4500,
    2100,
    500,
    true,
    20,
    now() - interval '4 hours'
  ),
  (
    'post_3',
    'user_kerem',
    'sizin-icin',
    'photo',
    'https://images.unsplash.com/photo-1517836357463-d25dfeac3438?auto=format&fit=crop&w=1200&q=80',
    'Short pit stop after midnight. The crew is still pushing.',
    'Maslak tunnel line',
    'Stronger - Kanye West',
    'https://p.scdn.co/mp3-preview/c87ed6c69bf90c377ec2ea69c1c53e0d882ae684?cid=v1',
    90000,
    1200,
    8000,
    120,
    true,
    30,
    now() - interval '1 hour'
  ),
  (
    'post_4',
    'user_mina',
    'kesfet',
    'photo',
    'https://images.unsplash.com/photo-1494526585095-c41746248156?auto=format&fit=crop&w=1200&q=80',
    'Blue hour lineup. The backend now controls ranking and availability.',
    'Kadikoy coast line',
    'Midnight City - M83',
    null,
    15300,
    380,
    1020,
    95,
    true,
    40,
    now() - interval '3 hours'
  ),
  (
    'post_5',
    'user_onur',
    'takipte',
    'photo',
    'https://images.unsplash.com/photo-1511919884226-fd3cad34687c?auto=format&fit=crop&w=1200&q=80',
    'Tunnel sound check. Engagement counters stream over WebSocket.',
    'Bomonti tunnel',
    'Nightcall - Kavinsky',
    null,
    8700,
    210,
    620,
    48,
    true,
    50,
    now() - interval '90 minutes'
  ),
  (
    'post_6',
    'user_gokhan',
    'sizin-icin',
    'photo',
    'https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=1200&q=80',
    'Editor pick mountain route. PostgreSQL data decides what stays visible.',
    'Bolu mountain pass',
    'After Hours - The Weeknd',
    null,
    44200,
    980,
    4100,
    205,
    true,
    60,
    now() - interval '30 minutes'
  )
on conflict (id) do update set
  caption = excluded.caption,
  location_name = excluded.location_name,
  likes_count = excluded.likes_count,
  comments_count = excluded.comments_count,
  bookmarks_count = excluded.bookmarks_count,
  shares_count = excluded.shares_count,
  sort_order = excluded.sort_order,
  created_at = excluded.created_at;

insert into comments (id, post_id, user_id, body, like_count, created_at) values
  ('comment_1', 'post_1', 'user_deniz', 'Clean view. Adding this route to my list.', 12, now() - interval '40 minutes'),
  ('comment_2', 'post_1', 'user_mina', 'Next drive should open with this playlist.', 8, now() - interval '25 minutes'),
  ('comment_3', 'post_2', 'user_viewer_local', 'Share the meet time for the shoreline route.', 5, now() - interval '10 minutes'),
  ('comment_4', 'post_3', 'user_onur', 'Energy is high. Drop details into messages.', 4, now() - interval '7 minutes'),
  ('comment_5', 'post_6', 'user_kerem', 'This one belongs in favorites.', 9, now() - interval '5 minutes')
on conflict (id) do nothing;

insert into follows (follower_id, followed_user_id) values
  ('user_viewer_local', 'user_deniz'),
  ('user_viewer_local', 'user_mina')
on conflict do nothing;

insert into post_engagements (viewer_id, post_id, liked, bookmarked, shared_count, updated_at) values
  ('user_viewer_local', 'post_2', true, false, 1, now()),
  ('user_viewer_local', 'post_3', false, true, 0, now()),
  ('user_viewer_local', 'post_6', true, true, 1, now())
on conflict (viewer_id, post_id) do update set
  liked = excluded.liked,
  bookmarked = excluded.bookmarked,
  shared_count = excluded.shared_count,
  updated_at = excluded.updated_at;
