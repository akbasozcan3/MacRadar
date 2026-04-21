create table if not exists explore_recent_user_searches (
  viewer_id text not null references users(id) on delete cascade,
  searched_user_id text not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (viewer_id, searched_user_id),
  check (viewer_id <> searched_user_id)
);

create index if not exists idx_explore_recent_user_searches_viewer_updated_at
  on explore_recent_user_searches(viewer_id, updated_at desc);

