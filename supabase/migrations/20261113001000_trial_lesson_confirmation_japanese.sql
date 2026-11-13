-- Update only the trial lesson confirmation template. Historical migrations stay unchanged.
update public.communication_templates
set subject_template = '【BEE SCHOOL】体験レッスンご予約確認',
    body_template = '{{student_japanese_name}}様

この度は体験レッスンにお申し込みいただき、ありがとうございます。

{{confirmed_date_jp}}（{{confirmed_weekday_jp}}）{{confirmed_time}}～にて、{{course_name}}の体験レッスンをご予約いたしました。

当日、お待ちしております。
どうぞお気をつけてお越しくださいませ。

よろしくお願いいたします。

BEE SCHOOL',
    variable_keys = array['student_japanese_name', 'confirmed_date_jp', 'confirmed_weekday_jp', 'confirmed_time', 'course_name']
where template_key = 'trial_lesson_confirmation';

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
  v_email_action_idempotency_key text;
  v_email_idempotency_key text;
  v_email_status public.communication_delivery_status;
  v_participant_name text;
  v_student_japanese_name text;
  v_course_name text;
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

  select coalesce(nullif(trim(tlp.alphabet_name), ''), nullif(trim(tlp.japanese_name), '')),
         nullif(trim(tlp.japanese_name), '')
  into v_participant_name, v_student_japanese_name
  from public.trial_lesson_participants tlp
  where tlp.trial_lesson_id = v_trial.id
  order by tlp.created_at, tlp.id
  limit 1;

  select coalesce(
    (select nullif(trim(pbi.course), '')
     from public.pending_trial_booking_imports pbi
     where pbi.converted_trial_lesson_id = v_trial.id),
    (select nullif(trim(cl.label), '')
     from public.class_levels cl
     where cl.id = v_trial.level_id)
  ) into v_course_name;

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
    'student_japanese_name', coalesce(v_student_japanese_name, nullif(trim(v_prospect.japanese_name), ''), v_participant_name, nullif(trim(v_prospect.alphabet_name), ''), ''),
    'confirmed_date', to_char(v_trial.trial_date, 'YYYY-MM-DD'),
    'confirmed_date_jp', extract(month from v_trial.trial_date)::integer::text || '月' || extract(day from v_trial.trial_date)::integer::text || '日',
    'confirmed_weekday_jp', (array['月', '火', '水', '木', '金', '土', '日'])[extract(isodow from v_trial.trial_date)::integer],
    'course_name', coalesce(v_course_name, ''),
    'confirmed_time', to_char(v_trial.trial_time, 'HH24:MI'),
    'school_name', coalesce(v_school_name, 'Bee School'),
    'lesson_type', initcap(replace(v_trial.lesson_type::text, '_', ' ')),
    'teacher', coalesce(v_teacher_name, 'Not assigned')
  );

  v_subject = public.render_text_template(v_template.subject_template, v_context);
  v_body = public.render_text_template(v_template.body_template, v_context);
  v_email_idempotency_key = 'trial_lesson:' || v_trial.id::text || ':trial_lesson_confirmation_email';
  v_email_action_idempotency_key = v_email_idempotency_key || ':resend_send';
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
    'resend',
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
      external_provider = case when c.delivery_status = 'sent' then c.external_provider else excluded.external_provider end,
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
    'resend',
    'send_email',
    v_email_action_idempotency_key,
    case when v_email_status = 'failed' then 'failed'::public.integration_action_status else 'pending'::public.integration_action_status end,
    case when v_email_status = 'failed' then 'No email contact exists for this prospect.' else null end,
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
      provider = case
        when cia.status = 'succeeded' then cia.provider
        else excluded.provider
      end,
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
    'email_idempotency_key', v_email_action_idempotency_key,
    'calendar_action_id', v_calendar_action_id,
    'calendar_status', v_calendar_status,
    'calendar_idempotency_key', v_calendar_idempotency_key
  );
end;
$$;

revoke all on function public.confirm_trial_lesson_mvp(uuid, date, time, uuid) from public, anon;
grant execute on function public.confirm_trial_lesson_mvp(uuid, date, time, uuid) to authenticated;
