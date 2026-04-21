create table if not exists user_profile_app_settings (
  user_id text primary key references users(id) on delete cascade,
  license_plate text not null default '',
  show_license_plate boolean not null default false,
  notify_follow_requests boolean not null default true,
  notify_messages boolean not null default true,
  notify_post_likes boolean not null default true,
  language text not null default 'tr',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (language in ('tr', 'en'))
);
