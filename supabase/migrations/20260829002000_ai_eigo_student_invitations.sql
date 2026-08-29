do $$
begin
  create type public.ai_eigo_invitation_status as enum (
    'pending_send',
    'sent',
    'send_failed',
    'claimed',
    'revoked',
    'expired',
    'manual_review'
  );
exception
  when duplicate_object then null;
end;
$$;

create table if not exists public.ai_eigo_student_links (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  school_id uuid not null references public.schools (id) on delete restrict,
  student_id uuid not null references public.students (id) on delete cascade,
  ai_eigo_user_id text not null,
  ai_eigo_email citext,
  entitlement_code text not null default 'bee',
  entitlement_activated_at timestamptz not null default now(),
  linked_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id, school_id),
  unique (student_id),
  unique (ai_eigo_user_id),
  constraint ai_eigo_student_links_entitlement_code_check
    check (entitlement_code = 'bee'),
  constraint ai_eigo_student_links_school_id_organization_id_fkey
    foreign key (school_id, organization_id)
    references public.schools (id, organization_id)
    on delete restrict,
  constraint ai_eigo_student_links_student_id_organization_id_school_id_fkey
    foreign key (student_id, organization_id, school_id)
    references public.students (id, organization_id, school_id)
    on delete cascade
);

create table if not exists public.ai_eigo_student_invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  school_id uuid not null references public.schools (id) on delete restrict,
  student_id uuid not null references public.students (id) on delete cascade,
  communication_id uuid references public.communications (id) on delete set null,
  recipient_email citext not null,
  status public.ai_eigo_invitation_status not null default 'pending_send',
  token_hash text,
  token_expires_at timestamptz,
  created_by uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  last_send_attempt_at timestamptz,
  last_send_error text,
  claimed_at timestamptz,
  claimed_ai_eigo_user_id text,
  claimed_ai_eigo_email citext,
  revoked_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (id, organization_id, school_id),
  constraint ai_eigo_student_invitations_school_id_organization_id_fkey
    foreign key (school_id, organization_id)
    references public.schools (id, organization_id)
    on delete restrict,
  constraint ai_eigo_student_invitations_student_id_organization_id_school_id_fkey
    foreign key (student_id, organization_id, school_id)
    references public.students (id, organization_id, school_id)
    on delete cascade,
  constraint ai_eigo_student_invitations_token_state_check
    check (
      (status = 'pending_send' and claimed_at is null and revoked_at is null and (token_hash is null or token_expires_at is not null))
      or (status in ('send_failed', 'revoked', 'expired', 'manual_review') and token_hash is null)
      or (status = 'sent' and token_hash is not null and token_expires_at is not null and claimed_at is null and revoked_at is null)
      or (status = 'claimed' and claimed_at is not null and claimed_ai_eigo_user_id is not null and token_hash is null)
    )
);

create index if not exists ai_eigo_student_links_student_idx
on public.ai_eigo_student_links (student_id);

create index if not exists ai_eigo_student_invitations_student_created_idx
on public.ai_eigo_student_invitations (student_id, created_at desc);

create unique index if not exists ai_eigo_student_invitations_token_hash_uidx
on public.ai_eigo_student_invitations (token_hash)
where token_hash is not null;

create unique index if not exists ai_eigo_student_invitations_one_active_per_student_uidx
on public.ai_eigo_student_invitations (student_id)
where status in ('pending_send', 'sent', 'send_failed', 'manual_review')
  and claimed_at is null
  and revoked_at is null;

drop trigger if exists ai_eigo_student_links_set_updated_at on public.ai_eigo_student_links;
create trigger ai_eigo_student_links_set_updated_at
before update on public.ai_eigo_student_links
for each row execute function public.set_updated_at();

drop trigger if exists ai_eigo_student_invitations_set_updated_at on public.ai_eigo_student_invitations;
create trigger ai_eigo_student_invitations_set_updated_at
before update on public.ai_eigo_student_invitations
for each row execute function public.set_updated_at();

insert into public.communication_templates (
  template_key,
  name,
  description,
  communication_type,
  channel,
  subject_template,
  body_template,
  variable_keys,
  is_system,
  status
)
values (
  'ai_eigo_student_invitation',
  'AI-EIGO student invitation',
  'Secure personal AI-EIGO access invitation for existing Bee School students.',
  'ai_eigo_student_invitation',
  'email',
  'Bee School AI-EIGO access invitation',
  'Hello {{student_name}},

Bee School has prepared special AI-EIGO access for this student.

Please create or sign in to an AI-EIGO account using this personal link:
{{invitation_link}}

This link is intended only for {{student_name}} and expires on {{expires_at}}.

Bee School',
  array['student_name', 'school_name', 'invitation_link', 'expires_at'],
  true,
  'active'
)
on conflict (template_key) do update
set name = excluded.name,
    description = excluded.description,
    communication_type = excluded.communication_type,
    channel = excluded.channel,
    subject_template = excluded.subject_template,
    body_template = excluded.body_template,
    variable_keys = excluded.variable_keys,
    is_system = excluded.is_system,
    status = excluded.status,
    updated_at = now();

create or replace function public.send_ai_eigo_student_invitation_mvp(p_student_id uuid)
returns table (
  id uuid,
  communication_id uuid,
  student_id uuid,
  status public.ai_eigo_invitation_status,
  recipient_email text,
  token_expires_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz,
  last_send_error text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := now();
  v_student public.students%rowtype;
  v_recipient text;
  v_invitation_id uuid;
  v_communication_id uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication is required to send AI-EIGO invitations.';
  end if;

  select * into v_student
  from public.students st
  where st.id = p_student_id;

  if not found then
    raise exception 'Student was not found.';
  end if;

  if not public.can_manage_student(v_student.id) then
    raise exception 'You do not have permission to invite this student to AI-EIGO.';
  end if;

  if v_student.status <> 'active' then
    raise exception 'Only active students can be invited to AI-EIGO.';
  end if;

  if exists (
    select 1
    from public.ai_eigo_student_links link
    where link.student_id = v_student.id
  ) then
    raise exception 'This student is already linked to AI-EIGO.';
  end if;

  select sc.value into v_recipient
  from public.student_contacts sc
  where sc.student_id = v_student.id
    and sc.contact_type = 'email'
    and nullif(trim(sc.value), '') is not null
  order by sc.is_primary desc, sc.created_at asc
  limit 1;

  if nullif(trim(coalesce(v_recipient, '')), '') is null then
    raise exception 'An email contact is required before sending an AI-EIGO invitation.';
  end if;

  update public.ai_eigo_student_invitations inv
  set status = 'revoked',
      token_hash = null,
      token_expires_at = null,
      revoked_at = coalesce(inv.revoked_at, v_now),
      updated_at = v_now
  where inv.student_id = v_student.id
    and inv.status in ('pending_send', 'sent', 'send_failed', 'manual_review')
    and inv.claimed_at is null
    and inv.revoked_at is null;

  insert into public.ai_eigo_student_invitations (
    organization_id,
    school_id,
    student_id,
    recipient_email,
    status,
    created_by
  )
  values (
    v_student.organization_id,
    v_student.school_id,
    v_student.id,
    lower(trim(v_recipient)),
    'pending_send',
    (select auth.uid())
  )
  returning ai_eigo_student_invitations.id into v_invitation_id;

  insert into public.communications (
    organization_id,
    school_id,
    student_id,
    communication_type,
    channel,
    recipient,
    subject,
    body,
    template_key,
    sent_by,
    source,
    delivery_status,
    external_provider,
    metadata
  )
  values (
    v_student.organization_id,
    v_student.school_id,
    v_student.id,
    'ai_eigo_student_invitation',
    'email',
    lower(trim(v_recipient)),
    'Bee School AI-EIGO access invitation',
    'Secure AI-EIGO invitation queued for delivery.',
    'ai_eigo_student_invitation',
    (select auth.uid()),
    'manual',
    'queued',
    'gmail',
    jsonb_build_object('ai_eigo_invitation_id', v_invitation_id)
  )
  returning communications.id into v_communication_id;

  update public.ai_eigo_student_invitations inv
  set communication_id = v_communication_id,
      updated_at = v_now
  where inv.id = v_invitation_id;

  insert into public.communication_integration_actions (
    organization_id,
    school_id,
    communication_id,
    provider,
    action_type,
    idempotency_key,
    request_payload
  )
  values (
    v_student.organization_id,
    v_student.school_id,
    v_communication_id,
    'gmail',
    'send_email',
    'ai_eigo_invitation:' || v_invitation_id::text || ':gmail_send',
    jsonb_build_object(
      'recipient', lower(trim(v_recipient)),
      'subject', 'Bee School AI-EIGO access invitation',
      'template_key', 'ai_eigo_student_invitation',
      'communication_type', 'ai_eigo_student_invitation',
      'invitation_id', v_invitation_id
    )
  );

  return query
  select
    inv.id,
    inv.communication_id,
    inv.student_id,
    inv.status,
    inv.recipient_email::text,
    inv.token_expires_at,
    inv.sent_at,
    inv.created_at,
    inv.last_send_error
  from public.ai_eigo_student_invitations inv
  where inv.id = v_invitation_id;
end;
$$;

revoke all on function public.send_ai_eigo_student_invitation_mvp(uuid) from public, anon, authenticated;
grant execute on function public.send_ai_eigo_student_invitation_mvp(uuid) to authenticated;

create or replace function public.prepare_ai_eigo_student_invitation_email_mvp(p_invitation_id uuid)
returns table (
  recipient text,
  subject text,
  body text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := now();
  v_raw_token text;
  v_token_hash text;
  v_link text;
  v_expires_at timestamptz;
  v_body text;
  v_context jsonb;
  v_student_name text;
  v_school_name text;
  v_subject text;
  v_template public.communication_templates%rowtype;
  v_invitation public.ai_eigo_student_invitations%rowtype;
begin
  if coalesce((select auth.role()), '') <> 'service_role' then
    raise exception 'Only the service role may prepare AI-EIGO invitation emails.';
  end if;

  select * into v_invitation
  from public.ai_eigo_student_invitations inv
  where inv.id = p_invitation_id
  for update;

  if not found then
    raise exception 'AI-EIGO invitation was not found.';
  end if;

  if v_invitation.status not in ('pending_send', 'send_failed') then
    raise exception 'AI-EIGO invitation is not pending email delivery.';
  end if;

  if v_invitation.revoked_at is not null or v_invitation.claimed_at is not null then
    raise exception 'AI-EIGO invitation is no longer active.';
  end if;

  if exists (
    select 1
    from public.ai_eigo_student_links link
    where link.student_id = v_invitation.student_id
  ) then
    update public.ai_eigo_student_invitations inv
    set status = 'revoked',
        token_hash = null,
        token_expires_at = null,
        revoked_at = v_now,
        updated_at = v_now
    where inv.id = v_invitation.id;

    raise exception 'Student is already linked to AI-EIGO.';
  end if;

  select trim(concat_ws(' ', nullif(st.first_name, ''), nullif(st.last_name, ''))),
         coalesce(s.name, 'Bee School')
    into v_student_name,
         v_school_name
  from public.students st
  join public.schools s on s.id = st.school_id
  where st.id = v_invitation.student_id
    and st.organization_id = v_invitation.organization_id
    and st.school_id = v_invitation.school_id;

  v_student_name = coalesce(nullif(v_student_name, ''), 'Bee School student');
  v_raw_token = rtrim(translate(encode(gen_random_bytes(32), 'base64'), '+/', '-_'), '=');
  v_token_hash = encode(digest(v_raw_token, 'sha256'), 'hex');
  v_expires_at = v_now + interval '14 days';
  v_link = 'https://ai-eigo.com/invite/' || v_raw_token;

  select * into v_template
  from public.communication_templates ct
  where ct.template_key = 'ai_eigo_student_invitation'
    and ct.status = 'active';

  if not found then
    raise exception 'AI-EIGO invitation communication template is missing.';
  end if;

  v_context = jsonb_build_object(
    'student_name', v_student_name,
    'school_name', v_school_name,
    'invitation_link', v_link,
    'expires_at', to_char(v_expires_at at time zone 'Asia/Tokyo', 'YYYY-MM-DD')
  );
  v_subject = public.render_text_template(v_template.subject_template, v_context);
  v_body = public.render_text_template(v_template.body_template, v_context);

  update public.ai_eigo_student_invitations inv
  set token_hash = v_token_hash,
      token_expires_at = v_expires_at,
      last_send_attempt_at = v_now,
      last_send_error = null,
      updated_at = v_now
  where inv.id = v_invitation.id;

  return query
  select
    v_invitation.recipient_email::text,
    v_subject,
    v_body;
end;
$$;

revoke all on function public.prepare_ai_eigo_student_invitation_email_mvp(uuid) from public, anon, authenticated;
grant execute on function public.prepare_ai_eigo_student_invitation_email_mvp(uuid) to service_role;

create or replace function public.verify_ai_eigo_student_invitation_mvp(p_token text)
returns table (
  invitation_id uuid,
  student_id uuid,
  organization_id uuid,
  school_id uuid,
  student_name text,
  school_name text,
  invitation_status text,
  token_expires_at timestamptz,
  claimable boolean,
  failure_reason text,
  entitlement_code text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_hash text;
  v_row record;
begin
  if coalesce((select auth.role()), '') <> 'service_role' then
    raise exception 'Only the service role may verify AI-EIGO invitations.';
  end if;

  if nullif(trim(coalesce(p_token, '')), '') is null then
    raise exception 'Invitation token is required.';
  end if;

  v_hash = encode(digest(trim(p_token), 'sha256'), 'hex');

  select inv.id,
         inv.student_id,
         inv.organization_id,
         inv.school_id,
         trim(concat_ws(' ', nullif(st.first_name, ''), nullif(st.last_name, ''))) as student_name,
         coalesce(s.name, 'Bee School') as school_name,
         inv.status,
         inv.token_expires_at,
         inv.revoked_at,
         inv.claimed_at
    into v_row
  from public.ai_eigo_student_invitations inv
  join public.students st on st.id = inv.student_id
    and st.organization_id = inv.organization_id
    and st.school_id = inv.school_id
  join public.schools s on s.id = inv.school_id
  where inv.token_hash = v_hash
  limit 1;

  if not found then
    return query
    select null::uuid,
           null::uuid,
           null::uuid,
           null::uuid,
           null::text,
           null::text,
           'invalid'::text,
           null::timestamptz,
           false,
           'invalid_token'::text,
           'bee'::text;
    return;
  end if;

  return query
  select v_row.id,
         v_row.student_id,
         v_row.organization_id,
         v_row.school_id,
         coalesce(nullif(v_row.student_name, ''), 'Bee School student'),
         v_row.school_name,
         case
           when v_row.revoked_at is not null then 'revoked'
           when v_row.claimed_at is not null then 'claimed'
           when v_row.status <> 'sent' then v_row.status::text
           when v_row.token_expires_at <= now() then 'expired'
           else 'sent'
         end,
         v_row.token_expires_at,
         v_row.status = 'sent'
           and v_row.revoked_at is null
           and v_row.claimed_at is null
           and v_row.token_expires_at > now(),
         case
           when v_row.revoked_at is not null then 'revoked'
           when v_row.claimed_at is not null then 'already_claimed'
           when v_row.status <> 'sent' then v_row.status::text
           when v_row.token_expires_at <= now() then 'expired'
           else null
         end,
         'bee'::text;
end;
$$;

revoke all on function public.verify_ai_eigo_student_invitation_mvp(text) from public, anon, authenticated;
grant execute on function public.verify_ai_eigo_student_invitation_mvp(text) to service_role;

create or replace function public.claim_ai_eigo_student_invitation_mvp(
  p_token text,
  p_ai_eigo_user_id text,
  p_ai_eigo_email text
)
returns table (
  student_id uuid,
  organization_id uuid,
  school_id uuid,
  ai_eigo_user_id text,
  ai_eigo_email text,
  entitlement_code text,
  linked_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := now();
  v_hash text;
  v_invitation public.ai_eigo_student_invitations%rowtype;
  v_existing_link public.ai_eigo_student_links%rowtype;
  v_link public.ai_eigo_student_links%rowtype;
  v_claim_email citext;
begin
  if coalesce((select auth.role()), '') <> 'service_role' then
    raise exception 'Only the service role may claim AI-EIGO invitations.';
  end if;

  if nullif(trim(coalesce(p_token, '')), '') is null then
    raise exception 'Invitation token is required.';
  end if;

  if nullif(trim(coalesce(p_ai_eigo_user_id, '')), '') is null then
    raise exception 'AI-EIGO user ID is required.';
  end if;

  if nullif(trim(coalesce(p_ai_eigo_email, '')), '') is null then
    raise exception 'AI-EIGO account email is required.';
  end if;

  v_claim_email = lower(trim(p_ai_eigo_email));
  v_hash = encode(digest(trim(p_token), 'sha256'), 'hex');

  select * into v_invitation
  from public.ai_eigo_student_invitations inv
  where inv.token_hash = v_hash
  for update;

  if not found then
    raise exception 'AI-EIGO invitation is invalid or expired.';
  end if;

  if v_invitation.revoked_at is not null or v_invitation.status = 'revoked' then
    raise exception 'AI-EIGO invitation has been revoked.';
  end if;

  if v_invitation.claimed_at is not null or v_invitation.status = 'claimed' then
    raise exception 'AI-EIGO invitation has already been claimed.';
  end if;

  if v_invitation.status <> 'sent' then
    raise exception 'AI-EIGO invitation is not ready to be claimed.';
  end if;

  if v_invitation.token_expires_at <= v_now then
    update public.ai_eigo_student_invitations inv
    set status = 'expired',
        token_hash = null,
        token_expires_at = null,
        updated_at = v_now
    where inv.id = v_invitation.id;

    raise exception 'AI-EIGO invitation has expired.';
  end if;

  if v_claim_email <> v_invitation.recipient_email then
    update public.ai_eigo_student_invitations inv
    set status = 'manual_review',
        token_hash = null,
        token_expires_at = null,
        claimed_ai_eigo_user_id = trim(p_ai_eigo_user_id),
        claimed_ai_eigo_email = v_claim_email,
        last_send_error = 'AI-EIGO login email did not match the invitation recipient.',
        updated_at = v_now
    where inv.id = v_invitation.id;

    raise exception 'AI-EIGO invitation requires manual review before Bee access can be activated.';
  end if;

  if exists (
    select 1
    from public.student_contacts sc
    where sc.contact_type = 'email'
      and lower(trim(sc.value)) = lower(v_invitation.recipient_email::text)
      and sc.student_id <> v_invitation.student_id
  ) then
    update public.ai_eigo_student_invitations inv
    set status = 'manual_review',
        token_hash = null,
        token_expires_at = null,
        claimed_ai_eigo_user_id = trim(p_ai_eigo_user_id),
        claimed_ai_eigo_email = v_claim_email,
        last_send_error = 'Invitation recipient email is shared by multiple Bee students.',
        updated_at = v_now
    where inv.id = v_invitation.id;

    raise exception 'AI-EIGO invitation requires manual review because this email is shared by multiple Bee students.';
  end if;

  select * into v_existing_link
  from public.ai_eigo_student_links link
  where link.student_id = v_invitation.student_id
     or link.ai_eigo_user_id = trim(p_ai_eigo_user_id)
  for update;

  if found then
    update public.ai_eigo_student_invitations inv
    set status = 'manual_review',
        token_hash = null,
        token_expires_at = null,
        claimed_ai_eigo_user_id = trim(p_ai_eigo_user_id),
        claimed_ai_eigo_email = v_claim_email,
        last_send_error = 'The Bee student or AI-EIGO account is already linked.',
        updated_at = v_now
    where inv.id = v_invitation.id;

    raise exception 'AI-EIGO invitation requires manual review because this student or account is already linked.';
  end if;

  insert into public.ai_eigo_student_links (
    organization_id,
    school_id,
    student_id,
    ai_eigo_user_id,
    ai_eigo_email,
    entitlement_code,
    entitlement_activated_at,
    linked_at
  )
  values (
    v_invitation.organization_id,
    v_invitation.school_id,
    v_invitation.student_id,
    trim(p_ai_eigo_user_id),
    v_claim_email,
    'bee',
    v_now,
    v_now
  )
  returning * into v_link;

  update public.ai_eigo_student_invitations inv
  set status = 'claimed',
      token_hash = null,
      token_expires_at = null,
      claimed_at = v_now,
      claimed_ai_eigo_user_id = trim(p_ai_eigo_user_id),
      claimed_ai_eigo_email = v_claim_email,
      last_send_error = null,
      updated_at = v_now
  where inv.id = v_invitation.id;

  return query
  select
    v_link.student_id,
    v_link.organization_id,
    v_link.school_id,
    v_link.ai_eigo_user_id,
    v_link.ai_eigo_email::text,
    v_link.entitlement_code,
    v_link.linked_at;
end;
$$;

revoke all on function public.claim_ai_eigo_student_invitation_mvp(text, text, text) from public, anon, authenticated;
grant execute on function public.claim_ai_eigo_student_invitation_mvp(text, text, text) to service_role;

create or replace function public.record_communication_integration_result(
  p_idempotency_key text,
  p_status public.integration_action_status,
  p_external_id text default null,
  p_error_message text default null,
  p_response_payload jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_action public.communication_integration_actions%rowtype;
  v_communication public.communications%rowtype;
  v_invitation_id uuid;
begin
  if p_status not in ('succeeded', 'failed', 'skipped') then
    raise exception 'Only terminal integration statuses can be recorded.';
  end if;

  update public.communication_integration_actions cia
  set status = p_status,
      external_id = coalesce(nullif(trim(coalesce(p_external_id, '')), ''), cia.external_id),
      error_message = nullif(trim(coalesce(p_error_message, '')), ''),
      response_payload = coalesce(p_response_payload, '{}'::jsonb),
      attempt_count = cia.attempt_count + 1,
      last_attempt_at = now(),
      updated_at = now()
  where cia.idempotency_key = p_idempotency_key
  returning * into v_action;

  if not found then
    raise exception 'Integration action % was not found.', p_idempotency_key;
  end if;

  if v_action.communication_id is not null then
    update public.communications c
    set delivery_status = case
          when p_status = 'succeeded' then 'sent'::public.communication_delivery_status
          when p_status = 'failed' then 'failed'::public.communication_delivery_status
          else 'skipped'::public.communication_delivery_status
        end,
        sent_at = case when p_status = 'succeeded' then coalesce(c.sent_at, now()) else c.sent_at end,
        external_message_id = case when p_status = 'succeeded' then coalesce(nullif(trim(coalesce(p_external_id, '')), ''), c.external_message_id) else c.external_message_id end,
        error_message = nullif(trim(coalesce(p_error_message, '')), ''),
        updated_at = now()
    where c.id = v_action.communication_id
    returning * into v_communication;
  end if;

  if v_action.action_type = 'send_email'
    and coalesce(v_action.request_payload ->> 'template_key', '') = 'ai_eigo_student_invitation'
    and nullif(v_action.request_payload ->> 'invitation_id', '') is not null
  then
    v_invitation_id = (v_action.request_payload ->> 'invitation_id')::uuid;

    update public.ai_eigo_student_invitations inv
    set status = case
          when p_status = 'succeeded' then 'sent'::public.ai_eigo_invitation_status
          when p_status = 'failed' then 'send_failed'::public.ai_eigo_invitation_status
          else inv.status
        end,
        sent_at = case when p_status = 'succeeded' then coalesce(inv.sent_at, now()) else inv.sent_at end,
        last_send_attempt_at = coalesce(inv.last_send_attempt_at, now()),
        last_send_error = case when p_status = 'failed' then nullif(trim(coalesce(p_error_message, '')), '') else null end,
        token_hash = case when p_status = 'failed' then null else inv.token_hash end,
        token_expires_at = case when p_status = 'failed' then null else inv.token_expires_at end,
        updated_at = now()
    where inv.id = v_invitation_id
      and inv.communication_id = v_action.communication_id
      and inv.status in ('pending_send', 'send_failed', 'sent')
      and inv.claimed_at is null
      and inv.revoked_at is null;
  end if;

  if v_action.trial_lesson_id is not null
    and v_action.action_type = 'send_email'
    and v_communication.template_key = 'no_show_follow_up'
    and v_communication.source = 'automated'
  then
    update public.trial_lessons
    set automated_follow_up_sent_at = case
          when p_status = 'succeeded' then coalesce(automated_follow_up_sent_at, now())
          else automated_follow_up_sent_at
        end,
        follow_up_state = case
          when p_status = 'succeeded' then 'automated_email_sent'::public.trial_follow_up_state
          when p_status = 'failed' then 'automated_email_failed'::public.trial_follow_up_state
          else follow_up_state
        end,
        updated_at = now()
    where id = v_action.trial_lesson_id
      and status = 'no_show';
  end if;
end;
$$;

revoke all on function public.record_communication_integration_result(
  text,
  public.integration_action_status,
  text,
  text,
  jsonb
) from public, anon, authenticated;

grant execute on function public.record_communication_integration_result(
  text,
  public.integration_action_status,
  text,
  text,
  jsonb
) to service_role;

alter table public.ai_eigo_student_links enable row level security;
alter table public.ai_eigo_student_invitations enable row level security;

revoke all on public.ai_eigo_student_links from public, anon, authenticated;
revoke all on public.ai_eigo_student_invitations from public, anon, authenticated;

grant select on public.ai_eigo_student_links to authenticated;
grant select on public.ai_eigo_student_invitations to authenticated;

grant all on public.ai_eigo_student_links to service_role;
grant all on public.ai_eigo_student_invitations to service_role;

drop policy if exists "ai_eigo_student_links_select_managers" on public.ai_eigo_student_links;
create policy "ai_eigo_student_links_select_managers"
on public.ai_eigo_student_links
for select
to authenticated
using (public.can_manage_student(student_id));

drop policy if exists "ai_eigo_student_invitations_select_managers" on public.ai_eigo_student_invitations;
create policy "ai_eigo_student_invitations_select_managers"
on public.ai_eigo_student_invitations
for select
to authenticated
using (public.can_manage_student(student_id));

notify pgrst, 'reload schema';
