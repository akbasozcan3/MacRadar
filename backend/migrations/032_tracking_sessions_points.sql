create table if not exists tracking_sessions (
  id bigserial primary key,
  user_id text not null references users(id) on delete cascade,
  room_id text not null default '',
  started_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  closed_at timestamptz null
);

create index if not exists idx_tracking_sessions_user_active
  on tracking_sessions (user_id, last_seen_at desc)
  where closed_at is null;

create table if not exists tracking_points (
  id bigserial primary key,
  session_id bigint not null references tracking_sessions(id) on delete cascade,
  user_id text not null references users(id) on delete cascade,
  room_id text not null default '',
  latitude double precision not null,
  longitude double precision not null,
  accuracy double precision not null default 0,
  heading double precision not null default 0,
  speed double precision not null default 0,
  source text not null default 'gps',
  sequence integer not null default 0,
  captured_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists idx_tracking_points_user_created
  on tracking_points (user_id, created_at desc);

create index if not exists idx_tracking_points_session_created
  on tracking_points (session_id, created_at desc);
