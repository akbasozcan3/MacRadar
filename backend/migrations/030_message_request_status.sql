alter table if exists direct_conversation_reads
  add column if not exists request_rejected_at timestamptz;

create index if not exists idx_direct_conversation_reads_request_rejected
  on direct_conversation_reads(user_id, request_rejected_at desc nulls last);
