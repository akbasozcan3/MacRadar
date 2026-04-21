alter table if exists user_profile_app_settings
  add column if not exists gender text not null default 'prefer_not_to_say';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'user_profile_app_settings_gender_check'
  ) then
    alter table user_profile_app_settings
      add constraint user_profile_app_settings_gender_check
      check (gender in ('male', 'female', 'non_binary', 'prefer_not_to_say'));
  end if;
end $$;

update user_profile_app_settings
set gender = 'prefer_not_to_say'
where gender is null
  or gender not in ('male', 'female', 'non_binary', 'prefer_not_to_say');
