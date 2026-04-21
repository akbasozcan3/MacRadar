alter table posts
  add column if not exists visibility text not null default 'public';

update posts
set visibility = 'public'
where trim(coalesce(visibility, '')) = '';

alter table posts
  drop constraint if exists posts_visibility_check;

alter table posts
  add constraint posts_visibility_check
  check (visibility in ('public', 'friends', 'private'));

create index if not exists idx_posts_user_visibility_created_at
  on posts(user_id, visibility, created_at desc);
