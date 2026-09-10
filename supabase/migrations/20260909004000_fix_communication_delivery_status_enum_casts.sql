create or replace function public.queue_communication_mvp(
  p_organization_id uuid,
  p_school_id uuid,
  p_student_id uuid default null,
  p_prospect_id uuid default null,
  p_trial_lesson_id uuid default null,
  p_communication_type text default 'custom',
  p_channel public.communication_channel default 'email',
  p_recipient text default null,
  p_subject text default null,
  p_body text default null,
  p_template_key text default null
)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_communication_id uuid;
begin
  if p_organization_id is null or p_school_id is null then
    raise exception 'Organization and school are required for communication records.';
  end if;

  if not exists (
    select 1
    from public.schools s
    where s.id = p_school_id
      and s.organization_id = p_organization_id
  ) then
    raise exception 'School % does not belong to organization %.', p_school_id, p_organization_id;
  end if;

  if not public.can_manage_school(p_school_id) then
    raise exception 'You do not have permission to send communications for this school.';
  end if;

  if p_student_id is null and p_prospect_id is null and p_trial_lesson_id is null then
    raise exception 'A student, prospect, or trial lesson context is required.';
  end if;

  if p_student_id is not null and not exists (
    select 1
    from public.students st
    where st.id = p_student_id
      and st.organization_id = p_organization_id
      and st.school_id = p_school_id
  ) then
    raise exception 'Student % does not belong to the selected tenant.', p_student_id;
  end if;

  if p_prospect_id is not null and not exists (
    select 1
    from public.prospects pr
    where pr.id = p_prospect_id
      and pr.organization_id = p_organization_id
      and pr.school_id = p_school_id
  ) then
    raise exception 'Prospect % does not belong to the selected tenant.', p_prospect_id;
  end if;

  if p_trial_lesson_id is not null and not exists (
    select 1
    from public.trial_lessons tl
    where tl.id = p_trial_lesson_id
      and tl.organization_id = p_organization_id
      and tl.school_id = p_school_id
  ) then
    raise exception 'Trial lesson % does not belong to the selected tenant.', p_trial_lesson_id;
  end if;

  if p_channel = 'email' and nullif(trim(coalesce(p_recipient, '')), '') is null then
    raise exception 'Recipient is required for email communication.';
  end if;

  if nullif(trim(coalesce(p_body, '')), '') is null then
    raise exception 'Message body is required.';
  end if;

  insert into public.communications as c (
    organization_id,
    school_id,
    student_id,
    prospect_id,
    trial_lesson_id,
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
    p_organization_id,
    p_school_id,
    p_student_id,
    p_prospect_id,
    p_trial_lesson_id,
    coalesce(nullif(trim(p_communication_type), ''), 'custom'),
    p_channel,
    nullif(trim(coalesce(p_recipient, '')), ''),
    nullif(trim(coalesce(p_subject, '')), ''),
    trim(p_body),
    nullif(trim(coalesce(p_template_key, '')), ''),
    (select auth.uid()),
    'manual',
    case
      when p_channel = 'email' then 'queued'::public.communication_delivery_status
      else 'sent'::public.communication_delivery_status
    end,
    case when p_channel = 'email' then 'gmail' else null end,
    jsonb_build_object('queued_from', 'bee_school_office')
  )
  returning id into v_communication_id;

  if p_channel = 'email' then
    insert into public.communication_integration_actions (
      organization_id,
      school_id,
      communication_id,
      trial_lesson_id,
      provider,
      action_type,
      idempotency_key,
      request_payload
    )
    values (
      p_organization_id,
      p_school_id,
      v_communication_id,
      p_trial_lesson_id,
      'gmail',
      'send_email',
      'communication:' || v_communication_id::text || ':gmail_send',
      jsonb_build_object(
        'recipient', nullif(trim(coalesce(p_recipient, '')), ''),
        'subject', nullif(trim(coalesce(p_subject, '')), ''),
        'body', trim(p_body),
        'template_key', nullif(trim(coalesce(p_template_key, '')), ''),
        'communication_type', coalesce(nullif(trim(p_communication_type), ''), 'custom')
      )
    );
  end if;

  return v_communication_id;
end;
$$;

revoke all on function public.queue_communication_mvp(
  uuid,
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  public.communication_channel,
  text,
  text,
  text,
  text
) from public, anon;

grant execute on function public.queue_communication_mvp(
  uuid,
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  public.communication_channel,
  text,
  text,
  text,
  text
) to authenticated;

create or replace function public.confirm_trial_lesson_mvp(
  p_trial_lesson_id uuid,
  p_trial_date date default null,
  p_trial_time time default null,
  p_assigned_teacher_profile_id uuid default null
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_calendar_action_id uuid;
  v_calendar_idempotency_key text;
  v_calendar_status public.integration_action_status;
  v_communication_id uuid;
  v_context jsonb;
  v_email_idempotency_key text;
  v_email_status public.communication_delivery_status;
  v_participant_name text;
  v_prospect public.prospects%rowtype;
  v_recipient text;
  v_school_name text;
  v_subject text;
  v_body text;
  v_template public.communication_templates%rowtype;
  v_trial public.trial_lessons%rowtype;
  v_teacher_name text;
begin
  select * into v_trial
  from public.trial_lessons tl
  where tl.id = p_trial_lesson_id
  for update;

  if not found then
    raise exception 'Trial lesson % was not found or is not accessible.', p_trial_lesson_id;
  end if;

  if v_trial.status = 'joined' then
    raise exception 'Converted trial lessons cannot be reconfirmed.';
  end if;

  if not public.can_manage_school(v_trial.school_id) then
    raise exception 'You do not have permission to confirm this trial lesson.';
  end if;

  update public.trial_lessons
  set trial_date = coalesce(p_trial_date, trial_date),
      trial_time = coalesce(p_trial_time, trial_time),
      assigned_teacher_profile_id = coalesce(p_assigned_teacher_profile_id, assigned_teacher_profile_id),
      status = 'booked',
      updated_at = now()
  where id = v_trial.id
  returning * into v_trial;

  select * into v_prospect
  from public.prospects pr
  where pr.id = v_trial.prospect_id;

  select s.name into v_school_name
  from public.schools s
  where s.id = v_trial.school_id;

  select coalesce(p.full_name, p.email::text) into v_teacher_name
  from public.profiles p
  where p.id = v_trial.assigned_teacher_profile_id;

  select coalesce(nullif(trim(tlp.alphabet_name), ''), nullif(trim(tlp.japanese_name), '')) into v_participant_name
  from public.trial_lesson_participants tlp
  where tlp.trial_lesson_id = v_trial.id
  order by tlp.created_at, tlp.id
  limit 1;

  select pc.value into v_recipient
  from public.prospect_contacts pc
  where pc.prospect_id = v_trial.prospect_id
    and pc.contact_type = 'email'
  order by pc.is_primary desc, pc.created_at, pc.id
  limit 1;

  select * into v_template
  from public.communication_templates ct
  where ct.template_key = 'trial_lesson_confirmation'
    and ct.status = 'active';

  if not found then
    raise exception 'Trial lesson confirmation communication template is missing.';
  end if;

  v_context = jsonb_build_object(
    'recipient_name', coalesce(nullif(trim(v_prospect.alphabet_name), ''), nullif(trim(v_prospect.japanese_name), ''), 'there'),
    'prospect_name', coalesce(nullif(trim(v_prospect.alphabet_name), ''), nullif(trim(v_prospect.japanese_name), ''), 'Prospect'),
    'student_name', coalesce(v_participant_name, nullif(trim(v_prospect.alphabet_name), ''), nullif(trim(v_prospect.japanese_name), ''), 'Student'),
    'confirmed_date', to_char(v_trial.trial_date, 'YYYY-MM-DD'),
    'confirmed_time', to_char(v_trial.trial_time, 'HH24:MI'),
    'school_name', coalesce(v_school_name, 'Bee School'),
    'lesson_type', initcap(replace(v_trial.lesson_type::text, '_', ' ')),
    'teacher', coalesce(v_teacher_name, 'Not assigned')
  );

  v_subject = public.render_text_template(v_template.subject_template, v_context);
  v_body = public.render_text_template(v_template.body_template, v_context);
  v_email_idempotency_key = 'trial_lesson:' || v_trial.id::text || ':trial_lesson_confirmation_email';
  v_calendar_idempotency_key = 'trial_lesson:' || v_trial.id::text || ':google_calendar_event';

  insert into public.communications as c (
    organization_id,
    school_id,
    prospect_id,
    trial_lesson_id,
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
    idempotency_key,
    error_message,
    metadata
  )
  values (
    v_trial.organization_id,
    v_trial.school_id,
    v_trial.prospect_id,
    v_trial.id,
    'trial_lesson_confirmation',
    'email',
    nullif(trim(coalesce(v_recipient, '')), ''),
    v_subject,
    v_body,
    'trial_lesson_confirmation',
    (select auth.uid()),
    'manual',
    case
      when nullif(trim(coalesce(v_recipient, '')), '') is null then 'failed'::public.communication_delivery_status
      else 'queued'::public.communication_delivery_status
    end,
    'gmail',
    v_email_idempotency_key,
    case
      when nullif(trim(coalesce(v_recipient, '')), '') is null then 'No email contact exists for this prospect.'
      else null
    end,
    v_context
  )
  on conflict (idempotency_key) do update
  set recipient = case when c.delivery_status = 'sent' then c.recipient else excluded.recipient end,
      subject = case when c.delivery_status = 'sent' then c.subject else excluded.subject end,
      body = case when c.delivery_status = 'sent' then c.body else excluded.body end,
      sent_by = coalesce(c.sent_by, excluded.sent_by),
      delivery_status = case when c.delivery_status = 'sent' then c.delivery_status else excluded.delivery_status end,
      error_message = case when c.delivery_status = 'sent' then c.error_message else excluded.error_message end,
      metadata = case when c.delivery_status = 'sent' then c.metadata else excluded.metadata end,
      updated_at = now()
  returning id, delivery_status into v_communication_id, v_email_status;

  insert into public.communication_integration_actions as cia (
    organization_id,
    school_id,
    communication_id,
    trial_lesson_id,
    provider,
    action_type,
    idempotency_key,
    status,
    error_message,
    request_payload
  )
  values (
    v_trial.organization_id,
    v_trial.school_id,
    v_communication_id,
    v_trial.id,
    'gmail',
    'send_email',
    v_email_idempotency_key,
    case
      when nullif(trim(coalesce(v_recipient, '')), '') is null then 'failed'::public.integration_action_status
      else 'pending'::public.integration_action_status
    end,
    case
      when nullif(trim(coalesce(v_recipient, '')), '') is null then 'No email contact exists for this prospect.'
      else null
    end,
    jsonb_build_object(
      'recipient', nullif(trim(coalesce(v_recipient, '')), ''),
      'subject', v_subject,
      'body', v_body,
      'template_key', 'trial_lesson_confirmation',
      'context', v_context
    )
  )
  on conflict (idempotency_key) do update
  set communication_id = excluded.communication_id,
      request_payload = case
        when cia.status = 'succeeded' then cia.request_payload
        else excluded.request_payload
      end,
      status = case
        when cia.status = 'succeeded' then cia.status
        else excluded.status
      end,
      error_message = case
        when cia.status = 'succeeded' then cia.error_message
        else excluded.error_message
      end,
      updated_at = now()
  returning id into v_calendar_action_id;

  insert into public.communication_integration_actions as cia (
    organization_id,
    school_id,
    trial_lesson_id,
    provider,
    action_type,
    idempotency_key,
    request_payload
  )
  values (
    v_trial.organization_id,
    v_trial.school_id,
    v_trial.id,
    'google_calendar',
    'create_calendar_event',
    v_calendar_idempotency_key,
    jsonb_build_object(
      'trial_lesson_id', v_trial.id,
      'summary', 'Bee School Trial Lesson - ' || coalesce(v_participant_name, v_prospect.japanese_name),
      'date', to_char(v_trial.trial_date, 'YYYY-MM-DD'),
      'time', to_char(v_trial.trial_time, 'HH24:MI'),
      'duration_minutes', 60,
      'school_name', coalesce(v_school_name, 'Bee School'),
      'teacher', coalesce(v_teacher_name, ''),
      'prospect_id', v_trial.prospect_id
    )
  )
  on conflict (idempotency_key) do update
  set request_payload = case
        when cia.status = 'succeeded' then cia.request_payload
        else excluded.request_payload
      end,
      status = case
        when cia.status = 'succeeded' then cia.status
        else excluded.status
      end,
      updated_at = now()
  returning id, status into v_calendar_action_id, v_calendar_status;

  return jsonb_build_object(
    'trial_lesson_id', v_trial.id,
    'status', v_trial.status,
    'communication_id', v_communication_id,
    'email_delivery_status', v_email_status,
    'email_idempotency_key', v_email_idempotency_key,
    'calendar_action_id', v_calendar_action_id,
    'calendar_status', v_calendar_status,
    'calendar_idempotency_key', v_calendar_idempotency_key
  );
end;
$$;

revoke all on function public.confirm_trial_lesson_mvp(uuid, date, time, uuid) from public, anon;
grant execute on function public.confirm_trial_lesson_mvp(uuid, date, time, uuid) to authenticated;

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
