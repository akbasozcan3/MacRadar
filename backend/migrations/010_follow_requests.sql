create table if not exists follow_requests (
  requester_id text not null references users(id) on delete cascade,
  target_user_id text not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (requester_id, target_user_id),
  check (requester_id <> target_user_id)
);

create index if not exists idx_follow_requests_target_created
  on follow_requests(target_user_id, created_at desc);
