create table if not exists post_reports (
  viewer_id text not null references users(id) on delete cascade,
  post_id text not null references posts(id) on delete cascade,
  reason text not null default 'other',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (viewer_id, post_id)
);

create index if not exists idx_post_reports_post_created_at
  on post_reports(post_id, created_at desc);
