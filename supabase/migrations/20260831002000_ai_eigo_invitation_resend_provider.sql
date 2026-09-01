alter table public.communication_integration_actions
drop constraint if exists communication_integration_actions_provider_check;

alter table public.communication_integration_actions
add constraint communication_integration_actions_provider_check
check (provider in ('gmail', 'google_calendar', 'internal', 'resend'));

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
    'resend',
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
    'resend',
    'send_email',
    'ai_eigo_invitation:' || v_invitation_id::text || ':resend_send',
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

notify pgrst, 'reload schema';
