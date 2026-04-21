alter table users add column if not exists is_email_verified boolean not null default true;
alter table users add column if not exists status text not null default 'active';

update users
set
  is_email_verified = true,
  status = 'active',
  updated_at = now()
where is_email_verified = false
   or status <> 'active';

create table if not exists email_verification_tokens (
  id text primary key,
  user_id text not null references users(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_email_verification_tokens_user
  on email_verification_tokens(user_id, created_at desc);

create unique index if not exists idx_email_verification_tokens_active_user
  on email_verification_tokens(user_id)
  where used_at is null;

create table if not exists auth_login_attempts (
  id text primary key,
  email text not null,
  ip_address text not null default '',
  successful boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists idx_auth_login_attempts_email
  on auth_login_attempts(lower(email), created_at desc);

create index if not exists idx_auth_login_attempts_ip
  on auth_login_attempts(ip_address, created_at desc);
