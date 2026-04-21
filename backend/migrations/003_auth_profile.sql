alter table users add column if not exists full_name text not null default '';
alter table users add column if not exists email text;
alter table users add column if not exists password_hash text;
alter table users add column if not exists bio text not null default '';
alter table users add column if not exists city text not null default '';
alter table users add column if not exists favorite_car text not null default '';
alter table users add column if not exists hero_tagline text not null default '';
alter table users add column if not exists auth_provider text not null default 'local';
alter table users add column if not exists created_at timestamptz not null default now();
alter table users add column if not exists updated_at timestamptz not null default now();
alter table users add column if not exists last_login_at timestamptz;

create unique index if not exists idx_users_email_unique
  on users ((lower(email)))
  where email is not null;

update users
set
  full_name = case id
    when 'user_viewer_local' then 'Local Driver'
    when 'user_gokhan' then 'Gokhan Demir'
    when 'user_deniz' then 'Deniz Aydin'
    when 'user_kerem' then 'Kerem Arslan'
    when 'user_mina' then 'Mina Yilmaz'
    when 'user_onur' then 'Onur Cetin'
    else initcap(replace(username, '.', ' '))
  end,
  email = case id
    when 'user_viewer_local' then 'local@macradar.app'
    when 'user_gokhan' then 'gokhan@macradar.app'
    when 'user_deniz' then 'deniz@macradar.app'
    when 'user_kerem' then 'kerem@macradar.app'
    when 'user_mina' then 'mina@macradar.app'
    when 'user_onur' then 'onur@macradar.app'
    else lower(username) || '@macradar.app'
  end,
  bio = case id
    when 'user_viewer_local' then 'MacRadar toplulugunu yoneten ve gece rotalarini kuran ana profil.'
    when 'user_gokhan' then 'Alp rotalari, uzun yol kareleri ve net surus planlari.'
    when 'user_deniz' then 'Sahil rotalari ve gun dogumu bulusmalari.'
    when 'user_kerem' then 'Gece ekipleri ve kisa pit-stop notlari.'
    when 'user_mina' then 'Sehir ici lineup ve editor secimleri.'
    when 'user_onur' then 'Tuncel ses akislari ve tunnel check setup.'
    else 'MacRadar toplulugunda aktif bir surucu.'
  end,
  city = case id
    when 'user_gokhan' then 'Trentino'
    when 'user_deniz' then 'Kas'
    when 'user_kerem' then 'Istanbul'
    when 'user_mina' then 'Kadikoy'
    when 'user_onur' then 'Bomonti'
    else 'Istanbul'
  end,
  favorite_car = case id
    when 'user_viewer_local' then 'BMW M4 Competition'
    when 'user_gokhan' then 'Porsche 911 Turbo S'
    when 'user_deniz' then 'Mercedes-AMG GT'
    when 'user_kerem' then 'Audi RS6'
    when 'user_mina' then 'Porsche Taycan 4S'
    when 'user_onur' then 'BMW M3 CS'
    else 'Performance Build'
  end,
  hero_tagline = case id
    when 'user_viewer_local' then 'Night drives, curated routes, premium profile cards.'
    when 'user_gokhan' then 'Mountain roads and disciplined convoys.'
    when 'user_deniz' then 'Sunrise shoreline drops and summer schedules.'
    when 'user_kerem' then 'Midnight pace with compact team routing.'
    when 'user_mina' then 'Blue hour lineup editor.'
    when 'user_onur' then 'Tunnel acoustics and instant meetups.'
    else 'Radar-ready driver profile.'
  end,
  updated_at = now()
where full_name = ''
   or email is null
   or bio = ''
   or city = ''
   or favorite_car = ''
   or hero_tagline = '';

create table if not exists auth_sessions (
  id text primary key,
  user_id text not null references users(id) on delete cascade,
  provider text not null,
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  last_used_at timestamptz not null default now()
);

create index if not exists idx_auth_sessions_user on auth_sessions(user_id, expires_at desc);
