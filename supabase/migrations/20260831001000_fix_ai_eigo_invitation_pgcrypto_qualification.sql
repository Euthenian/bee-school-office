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
  v_raw_token = rtrim(translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/', '-_'), '=');
  v_token_hash = encode(extensions.digest(v_raw_token, 'sha256'), 'hex');
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

  v_hash = encode(extensions.digest(trim(p_token), 'sha256'), 'hex');

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
  linked_at timestamptz,
  claim_status text
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
  v_claim_user_id text;
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

  v_claim_user_id = trim(p_ai_eigo_user_id);
  v_claim_email = lower(trim(p_ai_eigo_email));
  v_hash = encode(extensions.digest(trim(p_token), 'sha256'), 'hex');

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

  if v_invitation.token_expires_at is null or v_invitation.token_expires_at <= v_now then
    if v_invitation.status = 'sent' and v_invitation.claimed_at is null then
      update public.ai_eigo_student_invitations inv
      set status = 'expired',
          token_hash = null,
          token_expires_at = null,
          updated_at = v_now
      where inv.id = v_invitation.id;
    end if;

    raise exception 'AI-EIGO invitation has expired.';
  end if;

  if v_invitation.claimed_at is not null or v_invitation.status = 'claimed' then
    if v_invitation.claimed_ai_eigo_user_id = v_claim_user_id then
      select * into v_link
      from public.ai_eigo_student_links link
      where link.student_id = v_invitation.student_id
        and link.ai_eigo_user_id = v_claim_user_id
      for update;

      if not found then
        raise exception 'AI-EIGO invitation requires manual review because its claimed link is missing.';
      end if;

      return query
      select
        v_link.student_id,
        v_link.organization_id,
        v_link.school_id,
        v_link.ai_eigo_user_id,
        v_link.ai_eigo_email::text,
        v_link.entitlement_code,
        v_link.linked_at,
        'already_linked_same_user'::text;
      return;
    end if;

    raise exception 'AI-EIGO invitation has already been claimed by another AI-EIGO user.';
  end if;

  if v_invitation.status <> 'sent' then
    raise exception 'AI-EIGO invitation is not ready to be claimed.';
  end if;

  if v_claim_email <> v_invitation.recipient_email then
    update public.ai_eigo_student_invitations inv
    set status = 'manual_review',
        token_hash = null,
        token_expires_at = null,
        claimed_ai_eigo_user_id = v_claim_user_id,
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
        claimed_ai_eigo_user_id = v_claim_user_id,
        claimed_ai_eigo_email = v_claim_email,
        last_send_error = 'Invitation recipient email is shared by multiple Bee students.',
        updated_at = v_now
    where inv.id = v_invitation.id;

    raise exception 'AI-EIGO invitation requires manual review because this email is shared by multiple Bee students.';
  end if;

  select * into v_existing_link
  from public.ai_eigo_student_links link
  where link.student_id = v_invitation.student_id
     or link.ai_eigo_user_id = v_claim_user_id
  for update;

  if found then
    update public.ai_eigo_student_invitations inv
    set status = 'manual_review',
        token_hash = null,
        token_expires_at = null,
        claimed_ai_eigo_user_id = v_claim_user_id,
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
    v_claim_user_id,
    v_claim_email,
    'bee',
    v_now,
    v_now
  )
  returning * into v_link;

  update public.ai_eigo_student_invitations inv
  set status = 'claimed',
      claimed_at = v_now,
      claimed_ai_eigo_user_id = v_claim_user_id,
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
    v_link.linked_at,
    'linked'::text;
end;
$$;

revoke all on function public.claim_ai_eigo_student_invitation_mvp(text, text, text) from public, anon, authenticated;
grant execute on function public.claim_ai_eigo_student_invitation_mvp(text, text, text) to service_role;

notify pgrst, 'reload schema';
