create index if not exists idx_posts_live_segment_sort
  on posts(segment, sort_order, created_at desc)
  where is_live = true;

create index if not exists idx_posts_user_id
  on posts(user_id);

create index if not exists idx_follows_followed_user
  on follows(followed_user_id);

create index if not exists idx_auth_login_attempts_email_failed
  on auth_login_attempts(lower(email), created_at desc)
  where successful = false;

create index if not exists idx_auth_login_attempts_ip_failed
  on auth_login_attempts(ip_address, created_at desc)
  where successful = false;

create index if not exists idx_password_reset_codes_user_hash
  on password_reset_codes(user_id, code_hash);
