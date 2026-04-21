alter table if exists direct_conversation_reads
  add column if not exists request_accepted_at timestamptz;

create index if not exists idx_direct_conversation_reads_request_accepted
  on direct_conversation_reads(user_id, request_accepted_at desc nulls last);
