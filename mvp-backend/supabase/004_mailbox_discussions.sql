-- Additive migration. Run after 001/002/003; preserves existing papers and chats.
begin;
alter table public.mailbox_papers add column if not exists matching_allowed boolean not null default true;

create table if not exists public.mailbox_discussions (
  id uuid primary key default gen_random_uuid(),
  paper_id uuid not null,
  introduction_id uuid not null,
  author_id uuid not null references public.users(id),
  reader_id uuid not null references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (paper_id,author_id) references public.mailbox_papers(id,owner_id),
  foreign key (introduction_id,reader_id) references public.mailbox_papers(id,owner_id),
  unique(paper_id,reader_id),
  check(author_id<>reader_id)
);
create table if not exists public.mailbox_replies (
  id uuid primary key default gen_random_uuid(),
  discussion_id uuid not null references public.mailbox_discussions(id),
  sender_id uuid not null references public.users(id),
  content text not null check(char_length(btrim(content)) between 1 and 2000),
  client_message_id uuid not null,
  created_at timestamptz not null default now(),
  unique(discussion_id,sender_id,client_message_id)
);
create index if not exists mailbox_discussions_author_idx on public.mailbox_discussions(author_id,updated_at desc);
create index if not exists mailbox_discussions_reader_idx on public.mailbox_discussions(reader_id,updated_at desc);
create index if not exists mailbox_replies_thread_idx on public.mailbox_replies(discussion_id,created_at,id);
alter table public.mailbox_discussions enable row level security;
alter table public.mailbox_replies enable row level security;
revoke all on public.mailbox_discussions,public.mailbox_replies from public,anon,authenticated;
grant select,insert,update,delete on public.mailbox_discussions,public.mailbox_replies to service_role;

-- The only externally returned paper projection. Withdrawal never exposes a snapshot.
create or replace function public.mailbox_paper_preview(p_id uuid,p_viewer uuid)
returns jsonb language sql stable security definer set search_path=public as $$
 select jsonb_build_object('id',p.id,'status',case when p.status='withdrawn' then 'withdrawn'
   when p.status='expired' or p.discoverable_until<=now() then 'expired' else 'active' end,
   'subject',case when p.status='withdrawn' then '已撤回的纸条' else p.subject end,
   'quote',case when p.status='withdrawn' then null else p.quote end,
   'background',case when p.status='withdrawn' then null else p.background end,
   'displayName',case when p.owner_id=p_viewer then '你' when p.identity_disclosure='nickname' then coalesce(nullif(u.display_name,''),'匿名用户') else '匿名用户' end,
   'own',p.owner_id=p_viewer)
 from public.mailbox_papers p join public.users u on u.id=p.owner_id where p.id=p_id;
$$;

create or replace function public.mailbox_discussion_view(p_discussion_id uuid,p_viewer_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare t public.mailbox_discussions; p public.mailbox_papers; i public.mailbox_papers; v_closed text;
begin
 select * into t from public.mailbox_discussions where id=p_discussion_id and p_viewer_id in(author_id,reader_id);
 if not found then raise exception 'NOT_FOUND' using errcode='P0002'; end if;
 select * into p from public.mailbox_papers where id=t.paper_id;
 select * into i from public.mailbox_papers where id=t.introduction_id;
 v_closed=case when p.status='withdrawn' or i.status='withdrawn' then 'paper_withdrawn'
   when not p.contact_allowed or not i.contact_allowed then 'contact_disabled' else null end;
 return jsonb_build_object('id',t.id,'paper',public.mailbox_paper_preview(t.paper_id,p_viewer_id),
   'introduction',public.mailbox_paper_preview(t.introduction_id,p_viewer_id),
   'canReply',v_closed is null,'closedReason',v_closed,'createdAt',t.created_at,'updatedAt',t.updated_at,
   'messages',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'own',r.sender_id=p_viewer_id,'content',r.content,'createdAt',r.created_at) order by r.created_at,r.id)
      from public.mailbox_replies r where r.discussion_id=t.id),'[]'::jsonb));
end $$;

create or replace function public.list_mailbox_discussions(p_viewer_id uuid)
returns jsonb language sql stable security definer set search_path=public as $$
 select coalesce(jsonb_agg(public.mailbox_discussion_view(t.id,p_viewer_id) order by t.updated_at desc,t.id),'[]'::jsonb)
 from (select * from public.mailbox_discussions where p_viewer_id in(author_id,reader_id) order by updated_at desc,id limit 50) t;
$$;

create or replace function public.read_matched_mailbox_paper(p_viewer_id uuid,p_discovery_id uuid,p_candidate_ref text)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare c public.discovery_candidates; p public.mailbox_papers; t uuid; v_status text; v_active boolean;
begin
 -- A matching record grants access to this reader, never an arbitrary paper ID.
 select dc.* into c from public.discovery_candidates dc join public.discovery_runs d on d.id=dc.discovery_id and d.owner_id=dc.viewer_id
   where dc.discovery_id=p_discovery_id and dc.viewer_id=p_viewer_id and dc.candidate_ref=p_candidate_ref and dc.source_type='authorized_private';
 if not found then raise exception 'NOT_FOUND' using errcode='P0002'; end if;
 select * into p from public.mailbox_papers where expression_id=c.source_expression_id and owner_id<>p_viewer_id;
 if not found then raise exception 'NOT_FOUND' using errcode='P0002'; end if;
 select id into t from public.mailbox_discussions where paper_id=p.id and reader_id=p_viewer_id;
 v_active=p.status='active' and p.matching_allowed and p.discoverable_until>now() and p.confirmed_at>now()-interval '7 days'
   and exists(select 1 from public.expression_consents ec join public.expressions e on e.id=ec.expression_id
      where ec.expression_id=p.expression_id and ec.owner_id=p.owner_id and ec.matching_allowed and ec.excerpt_allowed
      and ec.revoked_at is null and ec.discoverable_until>now() and e.deleted_at is null);
 v_status=case when p.status='withdrawn' then 'withdrawn' when v_active then 'active' else 'expired' end;
 return jsonb_build_object('status',v_status,'paper',case when v_status='active' or t is not null then public.mailbox_paper_preview(p.id,p_viewer_id) else null end,
   'contactable',coalesce(v_active and p.contact_allowed,false),'discussionId',t);
end $$;

create or replace function public.open_mailbox_discussion(p_viewer_id uuid,p_discovery_id uuid,p_candidate_ref text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_view jsonb; p public.mailbox_papers; i public.mailbox_papers; t public.mailbox_discussions;
begin
 v_view=public.read_matched_mailbox_paper(p_viewer_id,p_discovery_id,p_candidate_ref);
 if v_view->>'discussionId' is not null then return public.mailbox_discussion_view((v_view->>'discussionId')::uuid,p_viewer_id); end if;
 if v_view->>'status'<>'active' or not (v_view->>'contactable')::boolean then raise exception 'DISCUSSION_CLOSED'; end if;
 select * into i from public.mailbox_papers where owner_id=p_viewer_id and confirmed_at is not null and status in('active','expired') and contact_allowed order by confirmed_at desc,id limit 1;
 if not found then raise exception 'OWN_PAPER_REQUIRED'; end if;
 -- Lock both papers in deterministic order. Withdrawal and opening cannot race.
 perform 1 from public.mailbox_papers where id in((v_view->'paper'->>'id')::uuid,i.id) order by id for update;
 select * into p from public.mailbox_papers where id=(v_view->'paper'->>'id')::uuid;
 select * into i from public.mailbox_papers where id=i.id;
 if i.status not in('active','expired') or not i.contact_allowed then raise exception 'OWN_PAPER_REQUIRED'; end if;
 v_view=public.read_matched_mailbox_paper(p_viewer_id,p_discovery_id,p_candidate_ref);
 if v_view->>'status'<>'active' or not (v_view->>'contactable')::boolean then raise exception 'DISCUSSION_CLOSED'; end if;
 insert into public.mailbox_discussions(paper_id,introduction_id,author_id,reader_id) values(p.id,i.id,p.owner_id,p_viewer_id)
   on conflict(paper_id,reader_id) do update set paper_id=excluded.paper_id returning * into t;
 return public.mailbox_discussion_view(t.id,p_viewer_id);
end $$;

create or replace function public.reply_mailbox_discussion(p_discussion_id uuid,p_sender_id uuid,p_content text,p_client_message_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare t public.mailbox_discussions; v_view jsonb; existing public.mailbox_replies;
begin
 select * into t from public.mailbox_discussions where id=p_discussion_id and p_sender_id in(author_id,reader_id);
 if not found then raise exception 'NOT_FOUND' using errcode='P0002'; end if;
 perform 1 from public.mailbox_papers where id in(t.paper_id,t.introduction_id) order by id for update;
 select * into existing from public.mailbox_replies where discussion_id=t.id and sender_id=p_sender_id and client_message_id=p_client_message_id;
 if found then
   if existing.content<>btrim(p_content) then raise exception 'MESSAGE_CONFLICT' using errcode='40001'; end if;
   return public.mailbox_discussion_view(t.id,p_sender_id);
 end if;
 if char_length(btrim(p_content)) not between 1 and 2000 then raise exception 'INVALID_REQUEST' using errcode='22023'; end if;
 v_view=public.mailbox_discussion_view(t.id,p_sender_id);
 if not (v_view->>'canReply')::boolean then raise exception 'DISCUSSION_CLOSED'; end if;
 if not exists(select 1 from public.mailbox_papers where owner_id=p_sender_id and status in('active','expired') and confirmed_at is not null) then raise exception 'OWN_PAPER_REQUIRED'; end if;
 insert into public.mailbox_replies(discussion_id,sender_id,content,client_message_id) values(t.id,p_sender_id,btrim(p_content),p_client_message_id);
 update public.mailbox_discussions set updated_at=now() where id=t.id;
 return public.mailbox_discussion_view(t.id,p_sender_id);
end $$;

create or replace function public.confirm_mailbox_paper_v2(p_paper_id uuid,p_owner_id uuid,p_expected_version integer,p_discoverable_until timestamptz,p_identity_disclosure text,p_contact_allowed boolean,p_matching_allowed boolean)
returns setof public.mailbox_papers language plpgsql security definer set search_path=public as $$
declare p public.mailbox_papers;
begin
 select * into p from public.mailbox_papers where id=p_paper_id and owner_id=p_owner_id for update;
 if not found then raise exception 'NOT_FOUND' using errcode='P0002'; end if;
 if p.status='active' and p.current_version=p_expected_version+1 then
   if p.matching_allowed<>p_matching_allowed or p.identity_disclosure<>p_identity_disclosure or p.contact_allowed<>p_contact_allowed then raise exception 'CONFIRMATION_CONFLICT' using errcode='40001'; end if;
   return next p; return;
 end if;
 select * into p from public.confirm_mailbox_paper(p_paper_id,p_owner_id,p_expected_version,p_discoverable_until,p_identity_disclosure,p_contact_allowed);
 update public.expression_consents set matching_allowed=p_matching_allowed,excerpt_allowed=p_matching_allowed where expression_id=p.expression_id and owner_id=p_owner_id;
 update public.mailbox_papers set matching_allowed=p_matching_allowed where id=p.id returning * into p;
 return next p;
end $$;

-- Repair the legacy delivery owner ambiguity, and serialize it with withdrawal.
create or replace function public.deliver_mailbox_paper(
  p_paper_id uuid,p_paper_version integer,p_sender_id uuid,p_discovery_id uuid,p_candidate_ref text
) returns setof public.paper_deliveries language plpgsql security definer set search_path=public as $$
declare v_target public.discovery_candidates; v_target_owner uuid; v_delivery public.paper_deliveries;
begin
  perform 1 from public.mailbox_papers where id=p_paper_id or expression_id=(select source_expression_id from public.discovery_candidates where discovery_id=p_discovery_id and viewer_id=p_sender_id and candidate_ref=p_candidate_ref) order by id for update;
  if not exists(select 1 from public.mailbox_papers where id=p_paper_id and owner_id=p_sender_id and status='active' and contact_allowed and current_version=p_paper_version and discoverable_until>now()) then raise exception 'paper_not_active' using errcode='40001'; end if;
  select * into v_target from public.discovery_candidates where discovery_id=p_discovery_id and viewer_id=p_sender_id and candidate_ref=p_candidate_ref;
  if not found or v_target.source_type<>'authorized_private' or not v_target.contactable or v_target.source_expression_id is null then raise exception 'target_not_deliverable' using errcode='22023'; end if;
  select e.owner_id into v_target_owner from public.expressions e join public.expression_consents c on c.expression_id=e.id and c.owner_id=e.owner_id
    where e.id=v_target.source_expression_id and e.deleted_at is null and e.created_at>now()-interval '7 days' and c.matching_allowed and c.excerpt_allowed and c.contact_allowed and c.revoked_at is null and c.discoverable_until>now();
  if v_target_owner is null or v_target_owner=p_sender_id then raise exception 'target_not_deliverable' using errcode='22023'; end if;
  insert into public.paper_deliveries(paper_id,paper_version,sender_id,discovery_id,candidate_ref,target_expression_id,target_owner_id)
    values(p_paper_id,p_paper_version,p_sender_id,p_discovery_id,p_candidate_ref,v_target.source_expression_id,v_target_owner)
    on conflict (paper_id,paper_version,discovery_id,candidate_ref) do update set paper_id=excluded.paper_id
    returning * into v_delivery;
  return next v_delivery;
end $$;

create or replace function public.confirm_and_deliver_mailbox_paper_v2(p_paper_id uuid,p_owner_id uuid,p_expected_version integer,p_discoverable_until timestamptz,p_identity_disclosure text,p_contact_allowed boolean,p_matching_allowed boolean,p_discovery_id uuid,p_candidate_ref text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare p public.mailbox_papers; d public.paper_deliveries; v_target public.mailbox_papers;
begin
 select mp.* into v_target from public.mailbox_papers mp join public.discovery_candidates dc on dc.source_expression_id=mp.expression_id
   where dc.discovery_id=p_discovery_id and dc.viewer_id=p_owner_id and dc.candidate_ref=p_candidate_ref;
 if not found then raise exception 'DISCUSSION_CLOSED'; end if;
 perform 1 from public.mailbox_papers where id in(v_target.id,p_paper_id) order by id for update;
 if not p_contact_allowed then raise exception 'DISCUSSION_CLOSED'; end if;
 -- Require the current target grant in the same transaction as confirmation.
 if not (public.read_matched_mailbox_paper(p_owner_id,p_discovery_id,p_candidate_ref)->>'contactable')::boolean then raise exception 'DISCUSSION_CLOSED'; end if;
 select * into p from public.confirm_mailbox_paper_v2(p_paper_id,p_owner_id,p_expected_version,p_discoverable_until,p_identity_disclosure,p_contact_allowed,p_matching_allowed);
 select * into d from public.deliver_mailbox_paper(p.id,p.current_version,p_owner_id,p_discovery_id,p_candidate_ref);
 return jsonb_build_object('paper',to_jsonb(p),'delivery',to_jsonb(d));
end $$;

create or replace function public.withdraw_mailbox_paper_v2(p_paper_id uuid,p_owner_id uuid)
returns setof public.mailbox_papers language plpgsql security definer set search_path=public as $$
declare p public.mailbox_papers;
begin
 select * into p from public.mailbox_papers where id=p_paper_id and owner_id=p_owner_id for update;
 if not found then raise exception 'NOT_FOUND' using errcode='P0002'; end if;
 if p.status='withdrawn' then return next p; return; end if;
 if p.status not in('active','expired') then raise exception 'PAPER_CONFLICT' using errcode='40001'; end if;
 update public.expression_consents set revoked_at=coalesce(revoked_at,now()),matching_allowed=false,excerpt_allowed=false,contact_allowed=false,updated_at=now() where expression_id=p.expression_id and owner_id=p_owner_id;
 update public.mailbox_papers set status='withdrawn',current_version=current_version+1,withdrawn_at=now(),updated_at=now() where id=p_paper_id returning * into p;
 update public.discovery_candidates set excerpt_snapshot='',relation_snapshot='',contactable=false where source_expression_id=p.expression_id;
 update public.paper_deliveries set status='cancelled' where paper_id=p.id or target_expression_id=p.expression_id;
 update public.mailbox_discussions set updated_at=now() where paper_id=p.id or introduction_id=p.id;
 return next p;
end $$;

-- Service sessions are checked by our backend. Supabase anonymous/authenticated
-- roles must never call an RPC with a forged p_viewer_id or inspect raw rows.
revoke all on function public.mailbox_paper_preview(uuid,uuid) from public,anon,authenticated;
revoke all on function public.mailbox_discussion_view(uuid,uuid) from public,anon,authenticated;
revoke all on function public.list_mailbox_discussions(uuid) from public,anon,authenticated;
revoke all on function public.read_matched_mailbox_paper(uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.open_mailbox_discussion(uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.reply_mailbox_discussion(uuid,uuid,text,uuid) from public,anon,authenticated;
revoke all on function public.confirm_mailbox_paper_v2(uuid,uuid,integer,timestamptz,text,boolean,boolean) from public,anon,authenticated;
revoke all on function public.confirm_and_deliver_mailbox_paper_v2(uuid,uuid,integer,timestamptz,text,boolean,boolean,uuid,text) from public,anon,authenticated;
revoke all on function public.withdraw_mailbox_paper_v2(uuid,uuid) from public,anon,authenticated;
grant execute on function public.mailbox_discussion_view(uuid,uuid),public.list_mailbox_discussions(uuid),public.read_matched_mailbox_paper(uuid,uuid,text),
 public.open_mailbox_discussion(uuid,uuid,text),public.reply_mailbox_discussion(uuid,uuid,text,uuid),
 public.confirm_mailbox_paper_v2(uuid,uuid,integer,timestamptz,text,boolean,boolean),
 public.confirm_and_deliver_mailbox_paper_v2(uuid,uuid,integer,timestamptz,text,boolean,boolean,uuid,text),
 public.withdraw_mailbox_paper_v2(uuid,uuid) to service_role;
notify pgrst,'reload schema';
commit;
