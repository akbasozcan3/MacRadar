alter table if exists user_profile_app_settings
  add column if not exists only_followed_users_can_message boolean not null default false;
