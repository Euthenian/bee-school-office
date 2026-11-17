-- Keep the active template and communication history in Japanese. The preparation
-- RPC below fixes the outbound copy independently of editable template content.
update public.communication_templates
set subject_template = '【Bee School】AI-EIGO Voice Check ご利用のご案内',
    body_template = 'Bee Schoolの生徒さまへ

Bee Schoolの生徒さまは、AI-EIGOの「Voice Check（発音チェック）」機能をご利用いただけます。

以下のボタンからAI-EIGOにアクセスし、ログインまたは新規登録を行ってください。

[利用を開始する]
{{invitation_link}}

このご案内リンクはお送りした方専用です。他の方への転送はお控えください。
リンクの有効期限は送信から14日間です。

Bee School',
    variable_keys = array['invitation_link'],
    updated_at = now()
where template_key = 'ai_eigo_student_invitation';

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
  -- Fixed Japanese copy is independent of staff locale and editable template content.
  v_subject = '【Bee School】AI-EIGO Voice Check ご利用のご案内';
  v_body = array_to_string(ARRAY[
    'Bee Schoolの生徒さまへ',
    '',
    'Bee Schoolの生徒さまは、AI-EIGOの「Voice Check（発音チェック）」機能をご利用いただけます。',
    '',
    '以下のボタンからAI-EIGOにアクセスし、ログインまたは新規登録を行ってください。',
    '',
    '[利用を開始する]',
    v_link,
    '',
    'このご案内リンクはお送りした方専用です。他の方への転送はお控えください。',
    'リンクの有効期限は送信から14日間です。',
    '',
    'Bee School'
  ], E'\n');

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
    '【Bee School】AI-EIGO Voice Check ご利用のご案内',
    'AI-EIGO Voice Checkのご案内を送信待ちです。',
    'ai_eigo_student_invitation',
    (select auth.uid()),
    'manual',
    'queued'::public.communication_delivery_status,
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
      'subject', '【Bee School】AI-EIGO Voice Check ご利用のご案内',
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
