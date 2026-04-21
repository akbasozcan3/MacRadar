alter table direct_messages
  add column if not exists client_nonce text;

create unique index if not exists idx_direct_messages_client_nonce
  on direct_messages(conversation_id, sender_id, client_nonce)
  where client_nonce is not null;
