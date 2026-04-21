alter table if exists direct_conversation_reads
  add column if not exists is_muted boolean not null default false,
  add column if not exists cleared_at timestamptz,
  add column if not exists deleted_at timestamptz;

create index if not exists idx_direct_conversation_reads_deleted_at
  on direct_conversation_reads(user_id, deleted_at desc nulls last);
