create extension if not exists pgcrypto;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'explore_segment') then
    create type explore_segment as enum ('kesfet', 'takipte', 'sizin-icin');
  end if;

  if not exists (select 1 from pg_type where typname = 'media_type') then
    create type media_type as enum ('photo', 'video');
  end if;
end
$$;

create table if not exists users (
  id text primary key,
  username text not null unique,
  avatar_url text not null,
  is_verified boolean not null default false
);

create table if not exists spotify_playlists (
  id text primary key,
  spotify_playlist_id text not null unique,
  title text not null,
  subtitle text not null,
  cover_image_url text not null,
  open_url text not null,
  embed_url text not null,
  theme smallint not null default 0,
  accent_color text not null default '#1DB954'
);

create table if not exists segment_playlists (
  segment explore_segment primary key,
  playlist_id text not null references spotify_playlists(id) on delete cascade
);

create table if not exists posts (
  id text primary key,
  user_id text not null references users(id) on delete cascade,
  segment explore_segment not null,
  media_type media_type not null,
  media_url text not null,
  caption text not null,
  location_name text not null,
  track_title text,
  track_preview_url text,
  likes_count bigint not null default 0,
  comments_count bigint not null default 0,
  bookmarks_count bigint not null default 0,
  shares_count bigint not null default 0,
  is_live boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_posts_segment_sort on posts(segment, sort_order, created_at desc);

create table if not exists comments (
  id text primary key,
  post_id text not null references posts(id) on delete cascade,
  user_id text not null references users(id) on delete cascade,
  body text not null,
  like_count integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_comments_post_created_at on comments(post_id, created_at desc);

create table if not exists follows (
  follower_id text not null references users(id) on delete cascade,
  followed_user_id text not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, followed_user_id)
);

create table if not exists post_engagements (
  viewer_id text not null references users(id) on delete cascade,
  post_id text not null references posts(id) on delete cascade,
  liked boolean not null default false,
  bookmarked boolean not null default false,
  shared_count integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (viewer_id, post_id)
);
