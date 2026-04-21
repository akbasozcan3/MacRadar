alter table email_verification_tokens
  add column if not exists attempt_count integer not null default 0;

alter table email_verification_tokens
  add column if not exists last_attempt_at timestamptz;
