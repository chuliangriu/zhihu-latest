create extension if not exists pgcrypto;

alter table public.users enable row level security;
alter table public.zhihu_accounts enable row level security;
alter table public.zhihu_accounts
  add column if not exists token_storage_version text not null default 'plain';

create table if not exists public.app_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  session_hash text unique not null,
  expires_at timestamptz not null,
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.audit_events (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references public.users(id) on delete set null,
  event_type text not null,
  resource_type text,
  resource_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists app_sessions_lookup_idx
  on public.app_sessions (session_hash, expires_at)
  where revoked_at is null;

alter table public.app_sessions enable row level security;
alter table public.audit_events enable row level security;

-- 浏览器不能读取用户凭证和 session；只有 Vercel 后端使用 Secret Key 操作。
revoke all on table public.zhihu_accounts from anon, authenticated;
revoke all on table public.app_sessions from anon, authenticated;
revoke all on table public.audit_events from anon, authenticated;
