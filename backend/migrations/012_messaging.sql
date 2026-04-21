create table if not exists direct_conversations (
  id text primary key,
  user_a_id text not null references users(id) on delete cascade,
  user_b_id text not null references users(id) on delete cascade,
  last_message_at timestamptz,
  last_message_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (user_a_id <> user_b_id),
  check (user_a_id < user_b_id),
  unique (user_a_id, user_b_id)
);

create index if not exists idx_direct_conversations_last_message
  on direct_conversations(coalesce(last_message_at, updated_at) desc, id desc);

create table if not exists direct_messages (
  id text primary key,
  conversation_id text not null references direct_conversations(id) on delete cascade,
  sender_id text not null references users(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_direct_messages_conversation_created
  on direct_messages(conversation_id, created_at desc, id desc);

create table if not exists direct_conversation_reads (
  conversation_id text not null references direct_conversations(id) on delete cascade,
  user_id text not null references users(id) on delete cascade,
  last_read_at timestamptz not null default 'epoch'::timestamptz,
  updated_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);

create index if not exists idx_direct_conversation_reads_user
  on direct_conversation_reads(user_id, updated_at desc);
