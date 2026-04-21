create table if not exists user_reports (
  viewer_id text not null references users(id) on delete cascade,
  reported_user_id text not null references users(id) on delete cascade,
  reason text not null default 'other',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (viewer_id, reported_user_id),
  check (viewer_id <> reported_user_id)
);

create index if not exists idx_user_reports_reported_created_at
  on user_reports(reported_user_id, created_at desc);
