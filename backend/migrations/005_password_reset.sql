create table if not exists password_reset_codes (
  id text primary key,
  user_id text not null references users(id) on delete cascade,
  code_hash text not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  attempt_count integer not null default 0,
  last_attempt_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_password_reset_codes_user
  on password_reset_codes(user_id, created_at desc);

create unique index if not exists idx_password_reset_codes_active_user
  on password_reset_codes(user_id)
  where used_at is null;
