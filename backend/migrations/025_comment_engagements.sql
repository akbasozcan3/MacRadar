create table if not exists comment_engagements (
  viewer_id text not null references users(id) on delete cascade,
  comment_id text not null references comments(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (viewer_id, comment_id)
);

create index if not exists idx_comment_engagements_comment_id
  on comment_engagements(comment_id);
