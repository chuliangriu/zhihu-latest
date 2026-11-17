-- 《未见之人》MVP 业务增量草案。
-- 必须由同事先核对正式库 001/002 的实际状态，再作为新 migration 执行；不要覆盖旧 migration。
create extension if not exists pgcrypto;

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, owner_id)
);

create table if not exists public.conversation_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null,
  owner_id uuid not null,
  role text not null check (role in ('user','assistant')),
  content text not null default '' check (char_length(content) <= 4000),
  generation_status text not null check (generation_status in ('complete','pending','failed')),
  created_at timestamptz not null default now(),
  foreign key (conversation_id, owner_id) references public.conversations(id, owner_id) on delete cascade
);

create table if not exists public.conversation_topic_assessments (
  assistant_message_id uuid primary key references public.conversation_messages(id) on delete cascade,
  conversation_id uuid not null,
  owner_id uuid not null,
  personal_situation boolean not null,
  topic_key text check (topic_key is null or char_length(topic_key) between 1 and 120),
  evidence_message_ids uuid[] not null default '{}',
  transition text not null check (transition in ('first','same_topic','clear_change','uncertain')),
  reason text not null check (char_length(reason) between 1 and 160),
  created_at timestamptz not null default now(),
  foreign key (conversation_id, owner_id) references public.conversations(id, owner_id) on delete cascade
);

create table if not exists public.discovery_displays (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null,
  owner_id uuid not null,
  assistant_message_id uuid not null references public.conversation_messages(id) on delete cascade,
  topic_key text not null check (char_length(topic_key) between 1 and 120),
  created_at timestamptz not null default now(),
  foreign key (conversation_id, owner_id) references public.conversations(id, owner_id) on delete cascade,
  unique (conversation_id, assistant_message_id),
  unique (conversation_id, topic_key)
);

create table if not exists public.discovery_runs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.users(id) on delete cascade,
  conversation_id uuid not null,
  pipeline_request_id uuid not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  foreign key (conversation_id, owner_id) references public.conversations(id, owner_id) on delete cascade,
  unique (owner_id, pipeline_request_id),
  unique (id, owner_id)
);

create table if not exists public.discovery_candidates (
  id uuid primary key default gen_random_uuid(),
  discovery_id uuid not null,
  viewer_id uuid not null,
  candidate_ref text not null check (char_length(candidate_ref) between 1 and 80),
  path text not null check (path in ('situationClose','structureRelated')),
  source_type text not null check (source_type in ('public','authorized_private','synthetic_private')),
  source_expression_id uuid references public.expressions(id) on delete set null,
  source_url text,
  author_profile_url text,
  contactable boolean not null default false,
  published_at timestamptz not null,
  excerpt_snapshot text not null check (char_length(excerpt_snapshot) <= 4000),
  relation_snapshot text not null check (char_length(relation_snapshot) <= 360),
  created_at timestamptz not null default now(),
  foreign key (discovery_id, viewer_id) references public.discovery_runs(id, owner_id) on delete cascade,
  unique (discovery_id, candidate_ref)
);

create table if not exists public.mailbox_papers (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.users(id) on delete cascade,
  conversation_id uuid not null,
  expression_id uuid references public.expressions(id) on delete set null,
  current_version integer not null default 1 check (current_version > 0),
  status text not null default 'draft' check (status in ('draft','active','withdrawn','expired')),
  subject text not null check (char_length(subject) between 1 and 24),
  quote text not null check (char_length(quote) between 8 and 100),
  context text not null check (char_length(context) between 1 and 30),
  background text not null check (char_length(background) between 8 and 160),
  discoverable_until timestamptz,
  identity_disclosure text not null default 'anonymous' check (identity_disclosure in ('anonymous','nickname')),
  contact_allowed boolean not null default false,
  confirmed_at timestamptz,
  withdrawn_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (conversation_id, owner_id) references public.conversations(id, owner_id) on delete cascade,
  unique (id, owner_id)
);

create table if not exists public.mailbox_paper_versions (
  paper_id uuid not null,
  owner_id uuid not null,
  version integer not null check (version > 0),
  status text not null check (status in ('draft','active','withdrawn','expired')),
  subject text not null,
  quote text not null,
  context text not null,
  background text not null,
  recorded_at timestamptz not null default now(),
  primary key (paper_id, version),
  foreign key (paper_id, owner_id) references public.mailbox_papers(id, owner_id) on delete cascade
);

create table if not exists public.paper_deliveries (
  id uuid primary key default gen_random_uuid(),
  paper_id uuid not null,
  paper_version integer not null,
  sender_id uuid not null,
  discovery_id uuid not null,
  candidate_ref text not null,
  target_expression_id uuid not null references public.expressions(id) on delete restrict,
  target_owner_id uuid not null references public.users(id) on delete restrict,
  status text not null default 'delivered' check (status in ('delivered','cancelled')),
  created_at timestamptz not null default now(),
  foreign key (paper_id, sender_id) references public.mailbox_papers(id, owner_id) on delete cascade,
  unique (paper_id, paper_version, discovery_id, candidate_ref),
  check (sender_id <> target_owner_id)
);

create table if not exists public.workflow_runs (
  id uuid primary key,
  owner_id uuid references public.users(id) on delete set null,
  endpoint_id text not null,
  business_status text not null,
  reason_code text not null,
  duration_ms integer not null default 0 check (duration_ms >= 0),
  model_mode text not null check (model_mode in ('mock','live','none')),
  created_at timestamptz not null default now()
);

create or replace function public.capture_mailbox_paper_version()
returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' or new.current_version <> old.current_version then
    insert into public.mailbox_paper_versions(paper_id,owner_id,version,status,subject,quote,context,background)
    values(new.id,new.owner_id,new.current_version,new.status,new.subject,new.quote,new.context,new.background);
  end if;
  return new;
end $$;

drop trigger if exists mailbox_paper_version_snapshot on public.mailbox_papers;
create trigger mailbox_paper_version_snapshot after insert or update on public.mailbox_papers
for each row execute function public.capture_mailbox_paper_version();

create or replace function public.confirm_mailbox_paper(
  p_paper_id uuid,p_owner_id uuid,p_expected_version integer,p_discoverable_until timestamptz,
  p_identity_disclosure text,p_contact_allowed boolean
) returns setof public.mailbox_papers language plpgsql security definer set search_path=public as $$
declare v_paper public.mailbox_papers; v_expression_id uuid;
begin
  select * into v_paper from public.mailbox_papers where id=p_paper_id and owner_id=p_owner_id for update;
  if not found then raise exception 'paper_not_found' using errcode='P0002'; end if;
  if v_paper.status='active' and v_paper.current_version=p_expected_version+1 then return next v_paper; return; end if;
  if v_paper.status<>'draft' or v_paper.current_version<>p_expected_version then raise exception 'paper_version_conflict' using errcode='40001'; end if;
  if p_discoverable_until<=now() or p_discoverable_until>now()+interval '7 days 5 minutes' then raise exception 'paper_expiry_invalid' using errcode='22023'; end if;
  insert into public.expressions(owner_id,content,context_summary,source_type)
  values(p_owner_id,v_paper.quote,v_paper.background,'private_authorized') returning id into v_expression_id;
  insert into public.expression_consents(expression_id,owner_id,matching_allowed,excerpt_allowed,contact_allowed,identity_disclosure,discoverable_until,consented_at)
  values(v_expression_id,p_owner_id,true,true,p_contact_allowed,p_identity_disclosure,p_discoverable_until,now());
  update public.mailbox_papers set expression_id=v_expression_id,status='active',current_version=current_version+1,
    discoverable_until=p_discoverable_until,identity_disclosure=p_identity_disclosure,contact_allowed=p_contact_allowed,
    confirmed_at=now(),updated_at=now() where id=p_paper_id returning * into v_paper;
  return next v_paper;
end $$;

create or replace function public.withdraw_mailbox_paper(p_paper_id uuid,p_owner_id uuid)
returns setof public.mailbox_papers language plpgsql security definer set search_path=public as $$
declare v_paper public.mailbox_papers;
begin
  select * into v_paper from public.mailbox_papers where id=p_paper_id and owner_id=p_owner_id for update;
  if not found then raise exception 'paper_not_found' using errcode='P0002'; end if;
  if v_paper.status='withdrawn' then return next v_paper; return; end if;
  if v_paper.status<>'active' then raise exception 'paper_state_conflict' using errcode='40001'; end if;
  update public.expression_consents set revoked_at=now(),updated_at=now() where expression_id=v_paper.expression_id and owner_id=p_owner_id and revoked_at is null;
  update public.mailbox_papers set status='withdrawn',current_version=current_version+1,withdrawn_at=now(),updated_at=now()
    where id=p_paper_id returning * into v_paper;
  return next v_paper;
end $$;

create or replace function public.deliver_mailbox_paper(
  p_paper_id uuid,p_paper_version integer,p_sender_id uuid,p_discovery_id uuid,p_candidate_ref text
) returns setof public.paper_deliveries language plpgsql security definer set search_path=public as $$
declare v_target public.discovery_candidates; v_target_owner uuid; v_delivery public.paper_deliveries;
begin
  if not exists(select 1 from public.mailbox_papers where id=p_paper_id and owner_id=p_sender_id and status='active' and current_version=p_paper_version and discoverable_until>now()) then raise exception 'paper_not_active' using errcode='40001'; end if;
  select * into v_target from public.discovery_candidates where discovery_id=p_discovery_id and viewer_id=p_sender_id and candidate_ref=p_candidate_ref for update;
  if not found or v_target.source_type<>'authorized_private' or not v_target.contactable or v_target.source_expression_id is null then raise exception 'target_not_deliverable' using errcode='22023'; end if;
  select owner_id into v_target_owner from public.expressions e join public.expression_consents c on c.expression_id=e.id and c.owner_id=e.owner_id
    where e.id=v_target.source_expression_id and e.deleted_at is null and c.matching_allowed and c.excerpt_allowed and c.contact_allowed and c.revoked_at is null and c.discoverable_until>now();
  if v_target_owner is null or v_target_owner=p_sender_id then raise exception 'target_not_deliverable' using errcode='22023'; end if;
  insert into public.paper_deliveries(paper_id,paper_version,sender_id,discovery_id,candidate_ref,target_expression_id,target_owner_id)
    values(p_paper_id,p_paper_version,p_sender_id,p_discovery_id,p_candidate_ref,v_target.source_expression_id,v_target_owner)
    on conflict (paper_id,paper_version,discovery_id,candidate_ref) do update set paper_id=excluded.paper_id
    returning * into v_delivery;
  return next v_delivery;
end $$;

create or replace function public.confirm_and_deliver_mailbox_paper(
  p_paper_id uuid,p_owner_id uuid,p_expected_version integer,p_discoverable_until timestamptz,
  p_identity_disclosure text,p_contact_allowed boolean,p_discovery_id uuid,p_candidate_ref text
) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_paper public.mailbox_papers; v_delivery public.paper_deliveries;
begin
  select * into v_paper from public.confirm_mailbox_paper(p_paper_id,p_owner_id,p_expected_version,p_discoverable_until,p_identity_disclosure,p_contact_allowed);
  if v_paper.id is null then raise exception 'paper_confirmation_failed' using errcode='40001'; end if;
  select * into v_delivery from public.deliver_mailbox_paper(v_paper.id,v_paper.current_version,p_owner_id,p_discovery_id,p_candidate_ref);
  if v_delivery.id is null then raise exception 'delivery_failed' using errcode='40001'; end if;
  return jsonb_build_object('paper',to_jsonb(v_paper),'delivery',to_jsonb(v_delivery));
end $$;

create or replace function public.expire_mailbox_papers()
returns integer language plpgsql security definer set search_path=public as $$
declare v_count integer;
begin
  update public.expression_consents c set revoked_at=coalesce(c.revoked_at,now()),updated_at=now()
  from public.mailbox_papers p where p.expression_id=c.expression_id and p.status='active' and p.discoverable_until<=now();
  update public.mailbox_papers set status='expired',current_version=current_version+1,updated_at=now()
    where status='active' and discoverable_until<=now();
  get diagnostics v_count=row_count;
  return v_count;
end $$;

create index if not exists conversation_messages_timeline_idx on public.conversation_messages(conversation_id,created_at);
create index if not exists discovery_displays_timeline_idx on public.discovery_displays(conversation_id,created_at);
create index if not exists discovery_runs_owner_idx on public.discovery_runs(owner_id,created_at desc);
create index if not exists discovery_candidates_lookup_idx on public.discovery_candidates(discovery_id,candidate_ref);
create index if not exists mailbox_papers_owner_idx on public.mailbox_papers(owner_id,updated_at desc);
create index if not exists mailbox_papers_active_idx on public.mailbox_papers(discoverable_until) where status='active';
create index if not exists paper_deliveries_target_idx on public.paper_deliveries(target_owner_id,created_at desc) where status='delivered';

alter table public.conversations enable row level security;
alter table public.conversation_messages enable row level security;
alter table public.conversation_topic_assessments enable row level security;
alter table public.discovery_displays enable row level security;
alter table public.discovery_runs enable row level security;
alter table public.discovery_candidates enable row level security;
alter table public.mailbox_papers enable row level security;
alter table public.mailbox_paper_versions enable row level security;
alter table public.paper_deliveries enable row level security;
alter table public.workflow_runs enable row level security;

revoke all on public.conversations,public.conversation_messages,public.conversation_topic_assessments,public.discovery_displays,
  public.discovery_runs,public.discovery_candidates,public.mailbox_papers,public.mailbox_paper_versions,public.paper_deliveries,public.workflow_runs
  from anon,authenticated;
grant select,insert,update,delete on public.conversations,public.conversation_messages,public.conversation_topic_assessments,public.discovery_displays,
  public.discovery_runs,public.discovery_candidates,public.mailbox_papers,public.mailbox_paper_versions,public.paper_deliveries,public.workflow_runs
  to service_role;
revoke all on function public.capture_mailbox_paper_version() from public,anon,authenticated;
revoke all on function public.confirm_mailbox_paper(uuid,uuid,integer,timestamptz,text,boolean) from public,anon,authenticated;
revoke all on function public.withdraw_mailbox_paper(uuid,uuid) from public,anon,authenticated;
revoke all on function public.deliver_mailbox_paper(uuid,integer,uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.confirm_and_deliver_mailbox_paper(uuid,uuid,integer,timestamptz,text,boolean,uuid,text) from public,anon,authenticated;
revoke all on function public.expire_mailbox_papers() from public,anon,authenticated;
grant execute on function public.capture_mailbox_paper_version() to service_role;
grant execute on function public.confirm_mailbox_paper(uuid,uuid,integer,timestamptz,text,boolean) to service_role;
grant execute on function public.withdraw_mailbox_paper(uuid,uuid) to service_role;
grant execute on function public.deliver_mailbox_paper(uuid,integer,uuid,uuid,text) to service_role;
grant execute on function public.confirm_and_deliver_mailbox_paper(uuid,uuid,integer,timestamptz,text,boolean,uuid,text) to service_role;
grant execute on function public.expire_mailbox_papers() to service_role;
