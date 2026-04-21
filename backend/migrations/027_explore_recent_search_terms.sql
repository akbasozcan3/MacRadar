create table if not exists explore_recent_search_terms (
  viewer_id text not null references users(id) on delete cascade,
  search_kind text not null,
  query_text text not null,
  query_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (viewer_id, search_kind, query_key),
  check (search_kind in ('posts', 'tags', 'places')),
  check (length(trim(query_key)) > 0)
);

create index if not exists idx_explore_recent_search_terms_viewer_kind_updated
  on explore_recent_search_terms(viewer_id, search_kind, updated_at desc);

