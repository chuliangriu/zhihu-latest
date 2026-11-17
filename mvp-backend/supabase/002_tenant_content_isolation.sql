-- 《未见之人》第二步：租户隔离和授权内容池
-- 可以重复执行；不会删除已有数据。

create extension if not exists pgcrypto;

create table if not exists public.expressions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.users(id) on delete cascade,
  content text not null check (char_length(content) between 1 and 10000),
  context_summary text,
  source_type text not null default 'private_authorized'
    check (source_type in ('private_authorized', 'zhihu_public', 'demo_seed')),
  source_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (id, owner_id)
);

create table if not exists public.expression_consents (
  id uuid primary key default gen_random_uuid(),
  expression_id uuid not null,
  owner_id uuid not null,
  matching_allowed boolean not null default false,
  excerpt_allowed boolean not null default false,
  contact_allowed boolean not null default false,
  identity_disclosure text not null default 'anonymous'
    check (identity_disclosure in ('anonymous', 'nickname', 'full')),
  discoverable_until timestamptz,
  consented_at timestamptz,
  revoked_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (expression_id),
  foreign key (expression_id, owner_id)
    references public.expressions(id, owner_id) on delete cascade
);

create table if not exists public.discovery_results (
  id uuid primary key default gen_random_uuid(),
  viewer_id uuid not null references public.users(id) on delete cascade,
  source_expression_id uuid references public.expressions(id) on delete set null,
  source_owner_id uuid not null references public.users(id) on delete cascade,
  query_text text,
  excerpt_snapshot text not null,
  context_snapshot text,
  identity_label text not null default '匿名用户',
  contact_allowed boolean not null default false,
  relation_summary text,
  difference_summary text,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  constraint discovery_cannot_show_self check (viewer_id <> source_owner_id)
);

create index if not exists expressions_owner_idx
  on public.expressions (owner_id, created_at desc)
  where deleted_at is null;

create index if not exists consents_candidate_idx
  on public.expression_consents (matching_allowed, excerpt_allowed, discoverable_until)
  where revoked_at is null;

create index if not exists discoveries_viewer_idx
  on public.discovery_results (viewer_id, created_at desc);

alter table public.expressions enable row level security;
alter table public.expression_consents enable row level security;
alter table public.discovery_results enable row level security;

-- 浏览器无权直接访问候选池。Vercel 后端验证会话后，使用 Secret Key 代为操作。
revoke all on table public.expressions from anon, authenticated;
revoke all on table public.expression_consents from anon, authenticated;
revoke all on table public.discovery_results from anon, authenticated;
