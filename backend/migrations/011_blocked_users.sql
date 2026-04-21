create table if not exists blocked_users (
  blocker_id text not null references users(id) on delete cascade,
  blocked_user_id text not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_user_id),
  check (blocker_id <> blocked_user_id)
);

create index if not exists idx_blocked_users_blocked_created
  on blocked_users(blocked_user_id, created_at desc);
