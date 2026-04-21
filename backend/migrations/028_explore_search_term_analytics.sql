create table if not exists explore_search_term_analytics (
  search_kind text not null,
  query_key text not null,
  query_text text not null,
  total_search_count bigint not null default 0,
  last_searched_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (search_kind, query_key),
  check (search_kind in ('posts', 'tags', 'places')),
  check (length(trim(query_key)) > 0)
);

create index if not exists idx_explore_search_term_analytics_kind_last
  on explore_search_term_analytics(search_kind, last_searched_at desc);

create table if not exists explore_search_term_daily_hits (
  search_kind text not null,
  query_key text not null,
  day date not null,
  hit_count bigint not null default 0,
  updated_at timestamptz not null default now(),
  primary key (search_kind, query_key, day),
  foreign key (search_kind, query_key)
    references explore_search_term_analytics(search_kind, query_key)
    on delete cascade,
  check (search_kind in ('posts', 'tags', 'places')),
  check (hit_count >= 0)
);

create index if not exists idx_explore_search_term_daily_hits_day_kind
  on explore_search_term_daily_hits(day desc, search_kind);

insert into explore_search_term_analytics (
  search_kind,
  query_key,
  query_text,
  total_search_count,
  last_searched_at,
  created_at,
  updated_at
)
select
  t.search_kind,
  t.query_key,
  max(t.query_text) as query_text,
  count(*)::bigint as total_search_count,
  max(t.updated_at) as last_searched_at,
  min(t.created_at) as created_at,
  max(t.updated_at) as updated_at
from explore_recent_search_terms t
group by t.search_kind, t.query_key
on conflict (search_kind, query_key)
do update set
  query_text = excluded.query_text,
  total_search_count = greatest(
    explore_search_term_analytics.total_search_count,
    excluded.total_search_count
  ),
  last_searched_at = greatest(
    explore_search_term_analytics.last_searched_at,
    excluded.last_searched_at
  ),
  updated_at = greatest(
    explore_search_term_analytics.updated_at,
    excluded.updated_at
  );

insert into explore_search_term_daily_hits (
  search_kind,
  query_key,
  day,
  hit_count,
  updated_at
)
select
  t.search_kind,
  t.query_key,
  date(t.updated_at) as day,
  count(*)::bigint as hit_count,
  max(t.updated_at) as updated_at
from explore_recent_search_terms t
group by t.search_kind, t.query_key, date(t.updated_at)
on conflict (search_kind, query_key, day)
do update set
  hit_count = greatest(
    explore_search_term_daily_hits.hit_count,
    excluded.hit_count
  ),
  updated_at = greatest(
    explore_search_term_daily_hits.updated_at,
    excluded.updated_at
  );

