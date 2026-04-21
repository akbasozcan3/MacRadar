alter table users
  add column if not exists birth_year integer;

update users
set birth_year = case id
  when 'user_viewer_local' then 1998
  when 'user_gokhan' then 1994
  when 'user_deniz' then 1997
  when 'user_kerem' then 1995
  when 'user_mina' then 1999
  when 'user_onur' then 1993
  else 2000
end
where birth_year is null;

alter table users
  alter column birth_year set default 2000;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'users_birth_year_range_check'
  ) then
    alter table users
      add constraint users_birth_year_range_check
      check (birth_year between 1900 and 2100);
  end if;
end
$$;
