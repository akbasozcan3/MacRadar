create table if not exists user_map_preferences (
  user_id text primary key references users(id) on delete cascade,
  map_filter_mode text not null default 'street_friends',
  map_theme_mode text not null default 'dark',
  show_local_layer boolean not null default true,
  show_remote_layer boolean not null default true,
  tracking_enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (map_filter_mode in ('street_friends', 'all')),
  check (map_theme_mode in ('dark', 'light', 'street'))
);
