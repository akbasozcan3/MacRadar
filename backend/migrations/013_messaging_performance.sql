create index if not exists idx_direct_conversations_user_a_sort
  on direct_conversations(user_a_id, coalesce(last_message_at, updated_at) desc, id desc);

create index if not exists idx_direct_conversations_user_b_sort
  on direct_conversations(user_b_id, coalesce(last_message_at, updated_at) desc, id desc);

create index if not exists idx_direct_messages_conversation_sender_created
  on direct_messages(conversation_id, sender_id, created_at desc, id desc);
