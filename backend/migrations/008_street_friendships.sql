create table if not exists street_friendships (
  user_a_id text not null references users(id) on delete cascade,
  user_b_id text not null references users(id) on delete cascade,
  requested_by text not null references users(id) on delete cascade,
  status text not null check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  accepted_at timestamptz,
  primary key (user_a_id, user_b_id),
  check (user_a_id <> user_b_id),
  check (user_a_id < user_b_id),
  check (requested_by = user_a_id or requested_by = user_b_id)
);

create index if not exists idx_street_friendships_status
  on street_friendships(status);

create index if not exists idx_street_friendships_requested_by
  on street_friendships(requested_by);
