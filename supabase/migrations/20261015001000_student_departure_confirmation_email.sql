-- Apply after 20261013003000_student_departure_notice_cutoff.sql.
-- Confirmation queues through the existing Resend dispatcher. No cron is added.

insert into public.communication_templates (
  template_key, name, description, communication_type, channel,
  subject_template, body_template, variable_keys, is_system, status
) values (
  'student_departure_confirmation', 'Student Departure Confirmation & Thank You',
  'Automatic confirmation of the final lesson and regular tuition months.',
  'student_departure_confirmation', 'email',
  'Bee School — 退会手続きのご確認とお礼',
  '{{student_greeting_name}} 様

いつもBee Schoolをご利用いただき、ありがとうございます。

このたび、退会のお申し出を承りました。

最終レッスン月は{{departure_month}}となり、月謝のお引き落としも{{last_billing_month}}をもって終了いたします。

これまでBee Schoolに通っていただき、誠にありがとうございました。

またいつかお会いできることを、スタッフ一同楽しみにしております。

Bee School',
  array['student_greeting_name', 'departure_month', 'last_billing_month'],
  false, 'active'
) on conflict (template_key) do nothing;

-- Communication Center's editor validates every template before saving.
create or replace function public.validate_student_email_template_mvp(
  p_subject text, p_body text, p_variable_keys text[]
) returns void language plpgsql set search_path = public, pg_temp as $$
declare
  v_key text;
  v_match text[];
  v_source text;
  v_allowed text[] := array[
    'student_name', 'student_email', 'recipient_name', 'school_name',
    'student_greeting_name', 'departure_month', 'last_billing_month'
  ];
begin
  if nullif(btrim(coalesce(p_subject, '')), '') is null
    or nullif(btrim(coalesce(p_body, '')), '') is null then
    raise exception 'Subject and body are required.';
  end if;
  if p_variable_keys is null or array_position(p_variable_keys, null) is not null then
    raise exception 'Allowed variables must be specified.';
  end if;
  foreach v_key in array p_variable_keys loop
    if not v_key = any(v_allowed) then
      raise exception 'Unknown template variable: %', v_key;
    end if;
  end loop;
  foreach v_source in array array[p_subject, p_body] loop
    for v_match in select regexp_matches(v_source, '\{\{([^{}]*)\}\}', 'g') loop
      v_key := btrim(v_match[1]);
      if not v_key = any(v_allowed) or not v_key = any(p_variable_keys) then
        raise exception 'Unknown or undeclared template variable: %', v_key;
      end if;
    end loop;
    if regexp_replace(v_source, '\{\{[^{}]*\}\}', '', 'g') ~ '\{\{|\}\}' then
      raise exception 'Malformed template variable.';
    end if;
  end loop;
end;
$$;

-- The event is inserted by confirm_student_departure_mvp in the same transaction.
-- A failed render or missing recipient is retained as an attention item, with no
-- dispatcher action. The event ID is the durable idempotency source.
create function public.queue_student_departure_confirmation_email()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_template public.communication_templates%rowtype;
  v_student public.students%rowtype;
  v_recipient text;
  v_name text;
  v_school_name text;
  v_context jsonb;
  v_subject text;
  v_body text;
  v_error text;
  v_key text := 'student_departure_confirmation:' || new.id::text;
  v_communication_id uuid;
  v_action_id uuid;
begin
  select * into v_template from public.communication_templates
  where template_key = 'student_departure_confirmation';
  begin
    if v_template.id is null or v_template.status <> 'active' or v_template.channel <> 'email' then
      raise exception 'Active departure confirmation template is required.';
    end if;
    perform public.validate_student_email_template_mvp(
      v_template.subject_template, v_template.body_template, v_template.variable_keys
    );
    if new.notice_date is null or new.final_lesson_date is null or new.final_billing_month is null
      or new.billing_end_date is null then
      raise exception 'Confirmed departure dates are incomplete.';
    end if;
    if date_trunc('month', new.billing_end_date)::date <> new.final_billing_month then
      raise exception 'Confirmed billing month conflicts with billing end date.';
    end if;
    select * into v_student from public.students where id = new.student_id;
    if not found then raise exception 'Confirmed student is missing.'; end if;

    -- Match Communication Center's contact type, validity check, and ordering.
    select btrim(c.value) into v_recipient
    from public.student_contacts c
    where c.student_id = new.student_id and c.contact_type = 'email'
      and btrim(c.value) ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    order by c.is_primary desc, c.created_at asc, c.id asc limit 1;
    if v_recipient is null then raise exception 'No valid email recipient'; end if;

    v_name := coalesce(
      nullif(btrim(v_student.legacy_japanese_name), ''),
      nullif(btrim(concat_ws(' ', nullif(btrim(v_student.first_name), ''),
        nullif(btrim(v_student.last_name), ''))), '')
    );
    v_name := nullif(btrim(regexp_replace(coalesce(v_name, ''),
      '[[:space:]]*[\(（][^\)）]*[\)）]', '', 'g')), '');
    if v_name is null then raise exception 'Student greeting name is missing.'; end if;
    select nullif(btrim(s.name), '') into v_school_name from public.schools s
    where s.id = new.school_id and s.organization_id = new.organization_id;
    v_context := jsonb_build_object(
      'student_greeting_name', v_name,
      'departure_month', extract(year from new.final_lesson_date)::integer::text || '年'
        || extract(month from new.final_lesson_date)::integer::text || '月',
      'last_billing_month', extract(year from new.final_billing_month)::integer::text || '年'
        || extract(month from new.final_billing_month)::integer::text || '月',
      'student_name', v_name, 'recipient_name', v_name,
      'student_email', v_recipient, 'school_name', v_school_name
    );
    v_subject := public.render_text_template(v_template.subject_template, v_context);
    v_body := public.render_text_template(v_template.body_template, v_context);
    if nullif(btrim(v_subject), '') is null or nullif(btrim(v_body), '') is null
      or v_subject ~ '\{\{|\}\}' or v_body ~ '\{\{|\}\}' then
      raise exception 'Departure confirmation template could not be fully rendered.';
    end if;
  exception when others then
    v_error := sqlerrm;
  end;

  if v_error is not null then
    insert into public.communications (
      organization_id, school_id, student_id, communication_type, channel,
      template_key, source, delivery_status, external_provider,
      idempotency_key, error_message, metadata
    ) values (
      new.organization_id, new.school_id, new.student_id,
      'student_departure_confirmation', 'email',
      case when v_template.id is null then null else v_template.template_key end,
      'automated',
      case when v_error = 'No valid email recipient' or v_error = 'Confirmed departure dates are incomplete.'
        then 'skipped'::public.communication_delivery_status
        else 'failed'::public.communication_delivery_status end,
      'resend', v_key, v_error,
      jsonb_build_object('departure_event_id', new.id, 'reason', v_error)
    ) on conflict (idempotency_key) do nothing;
    return new;
  end if;

  insert into public.communications (
    organization_id, school_id, student_id, communication_type, channel,
    recipient, subject, body, template_key, source, delivery_status,
    external_provider, idempotency_key, metadata
  ) values (
    new.organization_id, new.school_id, new.student_id,
    'student_departure_confirmation', 'email', v_recipient, v_subject, v_body,
    v_template.template_key, 'automated', 'queued', 'resend', v_key,
    jsonb_build_object('departure_event_id', new.id, 'notice_date', new.notice_date,
      'final_lesson_date', new.final_lesson_date,
      'final_billing_month', new.final_billing_month)
  ) on conflict (idempotency_key) do nothing returning id into v_communication_id;
  if v_communication_id is null then return new; end if;

  insert into public.communication_integration_actions (
    organization_id, school_id, communication_id, provider, action_type,
    idempotency_key, request_payload
  ) values (
    new.organization_id, new.school_id, v_communication_id, 'resend', 'send_email',
    v_key || ':resend_send',
    jsonb_build_object('recipient', v_recipient, 'subject', v_subject, 'body', v_body,
      'template_key', v_template.template_key,
      'communication_type', 'student_departure_confirmation',
      'departure_event_id', new.id)
  ) on conflict (idempotency_key) do nothing returning id into v_action_id;
  if v_action_id is null then
    raise exception 'Departure confirmation action could not be queued.';
  end if;
  return new;
end;
$$;
revoke all on function public.queue_student_departure_confirmation_email() from public, anon, authenticated;

create trigger student_departure_confirmation_queue_email
after insert on public.student_departure_confirmations
for each row execute function public.queue_student_departure_confirmation_email();

-- A correction cannot overtake a dispatcher claim. Unclaimed work is skipped;
-- already sent work remains in history with an explicit review marker.
create function public.review_voided_student_departure_email()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_key text := 'student_departure_confirmation:' || new.id::text;
  v_action public.communication_integration_actions%rowtype;
begin
  if old.voided_at is not null or new.voided_at is null then return new; end if;
  select * into v_action from public.communication_integration_actions
  where idempotency_key = v_key || ':resend_send' for update;
  if found and v_action.status = 'pending' and v_action.claim_token is not null then
    raise exception 'Departure email delivery is in progress. Review its result before voiding the confirmation.';
  end if;
  if found and v_action.status = 'pending' then
    update public.communication_integration_actions
    set status = 'skipped', error_message = 'Departure confirmation was voided before delivery.',
      updated_at = now()
    where id = v_action.id;
    update public.communications
    set delivery_status = 'skipped',
      error_message = 'Departure confirmation was voided before delivery.',
      metadata = metadata || jsonb_build_object('departure_voided_at', new.voided_at),
      updated_at = now()
    where id = v_action.communication_id;
  else
    update public.communications
    set metadata = metadata || jsonb_build_object('departure_voided_at', new.voided_at,
      'correction_requires_review', delivery_status = 'sent'),
      error_message = case when delivery_status = 'sent'
        then 'Departure was corrected after email delivery. Staff follow-up required.'
        else error_message end,
      updated_at = now()
    where idempotency_key = v_key;
  end if;
  return new;
end;
$$;
revoke all on function public.review_voided_student_departure_email() from public, anon, authenticated;

create trigger student_departure_confirmation_review_email
after update on public.student_departure_confirmations
for each row execute function public.review_voided_student_departure_email();

-- This event-driven template has no manual Send or Preview action.
create or replace function public.send_student_email_template_mvp(p_template_key text, p_student_id uuid)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_message jsonb;
begin
  if p_template_key = 'student_departure_confirmation' then
    raise exception 'Departure confirmation email is sent only by Confirm Departure.';
  end if;
  v_message := public.resolve_student_email_template_mvp(p_template_key, p_student_id);
  return public.queue_communication_mvp(
    (v_message->>'organization_id')::uuid,
    (v_message->>'school_id')::uuid,
    p_student_id, null, null,
    v_message->>'communication_type',
    'email'::public.communication_channel,
    v_message->>'recipient', v_message->>'subject', v_message->>'body',
    p_template_key
  );
end;
$$;

notify pgrst, 'reload schema';
