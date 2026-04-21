alter table post_engagements
  add column if not exists post_deleted_at timestamptz,
  add column if not exists post_deleted_reason text not null default '';

alter table post_engagements
  drop constraint if exists post_engagements_post_id_fkey;

create index if not exists idx_post_engagements_post_id on post_engagements(post_id);
create index if not exists idx_post_engagements_post_deleted_at on post_engagements(post_deleted_at desc);

update post_engagements pe
set
  post_deleted_at = coalesce(pe.post_deleted_at, now()),
  post_deleted_reason = case
    when trim(pe.post_deleted_reason) = '' then 'soft_deleted'
    else pe.post_deleted_reason
  end
from posts p
where
  p.id = pe.post_id
  and coalesce(p.is_live, false) = false;

create or replace function sync_post_engagement_tombstone_from_posts()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    update post_engagements
    set
      post_deleted_at = coalesce(post_deleted_at, now()),
      post_deleted_reason = case
        when trim(post_deleted_reason) = '' then 'deleted'
        else post_deleted_reason
      end,
      updated_at = now()
    where post_id = old.id;
    return old;
  end if;

  if tg_op = 'UPDATE' then
    if coalesce(old.is_live, true) = true and coalesce(new.is_live, true) = false then
      update post_engagements
      set
        post_deleted_at = coalesce(post_deleted_at, now()),
        post_deleted_reason = case
          when trim(post_deleted_reason) = '' then 'soft_deleted'
          else post_deleted_reason
        end,
        updated_at = now()
      where post_id = new.id;
    elsif coalesce(old.is_live, false) = false and coalesce(new.is_live, false) = true then
      update post_engagements
      set
        post_deleted_at = null,
        post_deleted_reason = '',
        updated_at = now()
      where post_id = new.id;
    end if;
    return new;
  end if;

  return null;
end;
$$;

drop trigger if exists trg_post_engagement_tombstone_on_delete on posts;
create trigger trg_post_engagement_tombstone_on_delete
after delete on posts
for each row
execute function sync_post_engagement_tombstone_from_posts();

drop trigger if exists trg_post_engagement_tombstone_on_live_update on posts;
create trigger trg_post_engagement_tombstone_on_live_update
after update of is_live on posts
for each row
when (old.is_live is distinct from new.is_live)
execute function sync_post_engagement_tombstone_from_posts();
