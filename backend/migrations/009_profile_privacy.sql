alter table users add column if not exists is_private_account boolean not null default false;
alter table users add column if not exists is_map_visible boolean not null default true;
