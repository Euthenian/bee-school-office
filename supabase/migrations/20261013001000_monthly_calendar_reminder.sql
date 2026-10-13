-- Apply after 20261009001000_communication_center_templates.sql.
-- This migration creates no cron job and leaves the automation disabled.

insert into public.communication_templates (
  template_key, name, description, communication_type, channel,
  subject_template, body_template, variable_keys, is_system, status
) values (
  'monthly_calendar_reminder', 'Monthly Calendar Reminder',
  'Operational reminder to check the official Bee School lesson calendar.',
  'monthly_calendar_reminder', 'email',
  'Bee School — Monthly Lesson Calendar / レッスンカレンダーのご案内',
  '{{student_name}} 様

いつもBee Schoolをご利用いただき、ありがとうございます。
今月のレッスンスケジュールをご確認ください。
Bee Schoolのレッスンカレンダーは、日本の祝日と必ずしも一致しておりません。お休みの日程などについては、下記のカレンダーをご確認ください。

【レッスンカレンダー】
[Calendar URL]

Bee School',
  array['student_name'], false, 'inactive'
) on conflict (template_key) do nothing;

create table public.monthly_calendar_reminder_settings (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  enabled boolean not null default false,
  scheduled_day integer check (scheduled_day between 1 and 28),
  scheduled_time time without time zone,
  template_key text not null default 'monthly_calendar_reminder'
    references public.communication_templates(template_key),
  last_execution_at timestamptz,
  run_month text,
  last_student_id uuid,
  run_completed_at timestamptz,
  recipient_count integer not null default 0,
  updated_at timestamptz not null default now(),
  constraint monthly_calendar_schedule_complete check (
    (scheduled_day is null and scheduled_time is null)
    or (scheduled_day is not null and scheduled_time is not null)
  )
);

alter table public.monthly_calendar_reminder_settings enable row level security;
create index monthly_calendar_active_students_idx
on public.students (organization_id, id) where status = 'active';
create index monthly_calendar_history_idx
on public.communications (organization_id, idempotency_key)
where template_key = 'monthly_calendar_reminder' and source = 'automated';
revoke all on public.monthly_calendar_reminder_settings from public, anon, authenticated;
grant select on public.monthly_calendar_reminder_settings to authenticated;
grant all on public.monthly_calendar_reminder_settings to service_role;
create policy monthly_calendar_reminder_settings_admin_select
on public.monthly_calendar_reminder_settings for select to authenticated
using (
  public.is_super_admin() or public.has_org_role(
    organization_id, array['franchise_owner']::public.membership_role[]
  )
);

create function public.save_monthly_calendar_reminder_settings(
  p_organization_id uuid, p_enabled boolean, p_scheduled_day integer,
  p_scheduled_time time without time zone
) returns public.monthly_calendar_reminder_settings
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_row public.monthly_calendar_reminder_settings%rowtype;
begin
  if auth.uid() is null or not (
    public.is_super_admin() or public.has_org_role(
      p_organization_id, array['franchise_owner']::public.membership_role[]
    )
  ) then
    raise exception 'Administrator permission required.';
  end if;
  if (p_scheduled_day is null) <> (p_scheduled_time is null)
    or (p_scheduled_day is not null and p_scheduled_day not between 1 and 28) then
    raise exception 'Choose a day from 1 to 28 and a Japan time, or leave both unset.';
  end if;
  if p_enabled then
    if p_scheduled_day is null then
      raise exception 'Set a schedule before enabling the automation.';
    end if;
    if not exists (
      select 1 from public.communication_templates t
      where t.template_key = 'monthly_calendar_reminder'
        and t.status = 'active' and t.channel = 'email'
        and t.body_template not like '%[Calendar URL]%'
        and t.body_template ~* 'https?://[^[:space:]]+'
    ) then
      raise exception 'Activate the calendar template with a verified URL before enabling.';
    end if;
  end if;
  insert into public.monthly_calendar_reminder_settings as s (
    organization_id, enabled, scheduled_day, scheduled_time
  ) values (p_organization_id, p_enabled, p_scheduled_day, p_scheduled_time)
  on conflict (organization_id) do update set
    enabled = excluded.enabled,
    scheduled_day = excluded.scheduled_day,
    scheduled_time = excluded.scheduled_time,
    updated_at = now()
  returning * into v_row;
  return v_row;
end;
$$;
revoke all on function public.save_monthly_calendar_reminder_settings(uuid, boolean, integer, time without time zone) from public, anon;
grant execute on function public.save_monthly_calendar_reminder_settings(uuid, boolean, integer, time without time zone) to authenticated;

-- Keep the Communication Center's exact recipient and rendering rules. The
-- service role may call this only from server-side automation; browser users
-- retain the original school-management check.
create or replace function public.resolve_student_email_template_mvp(p_template_key text, p_student_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_student public.students%rowtype;
  v_school_name text;
  v_template public.communication_templates%rowtype;
  v_recipient text;
  v_name text;
  v_subject text;
  v_body text;
  v_match text[];
  v_key text;
  v_value text;
begin
  select * into v_student from public.students where id = p_student_id;
  if not found or (
    auth.role() is distinct from 'service_role'
    and (auth.uid() is null or not public.can_manage_school(v_student.school_id))
  ) then
    raise exception 'Student not found or permission denied.';
  end if;
  select * into v_template from public.communication_templates
  where template_key = p_template_key and status = 'active' and channel = 'email';
  if not found then
    raise exception 'Active email template not found.';
  end if;
  perform public.validate_student_email_template_mvp(
    v_template.subject_template, v_template.body_template, v_template.variable_keys
  );
  select btrim(c.value) into v_recipient
  from public.student_contacts c
  where c.student_id = p_student_id and c.contact_type = 'email'
    and btrim(c.value) ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  order by c.is_primary desc, c.created_at asc, c.id asc
  limit 1;
  if v_recipient is null then
    raise exception 'No valid email recipient';
  end if;
  v_name := nullif(concat_ws(' ', nullif(btrim(v_student.first_name), ''), nullif(btrim(v_student.last_name), '')), '');
  v_name := coalesce(v_name, nullif(btrim(v_student.legacy_japanese_name), ''));
  if v_name is not null and nullif(btrim(v_student.preferred_name), '') is not null then
    v_name := v_name || ' (' || btrim(v_student.preferred_name) || ')';
  end if;
  select nullif(btrim(s.name), '') into v_school_name
  from public.schools s where s.id = v_student.school_id and s.organization_id = v_student.organization_id;
  v_subject := v_template.subject_template;
  v_body := v_template.body_template;
  for v_match in select regexp_matches(v_subject || E'\n' || v_body, '\{\{([^{}]*)\}\}', 'g') loop
    v_key := btrim(v_match[1]);
    v_value := case v_key
      when 'student_name' then v_name
      when 'student_email' then v_recipient
      when 'recipient_name' then v_name
      when 'school_name' then v_school_name
      else null end;
    if nullif(btrim(coalesce(v_value, '')), '') is null then
      raise exception 'Missing template variable: %', v_key;
    end if;
    v_subject := replace(v_subject, '{{' || v_match[1] || '}}', v_value);
    v_body := replace(v_body, '{{' || v_match[1] || '}}', v_value);
  end loop;
  return jsonb_build_object(
    'template_key', v_template.template_key,
    'recipient', v_recipient, 'subject', v_subject, 'body', v_body,
    'student_id', v_student.id, 'school_id', v_student.school_id,
    'organization_id', v_student.organization_id,
    'communication_type', v_template.communication_type
  );
end;
$$;

create function public.enqueue_monthly_calendar_reminder_batch(p_limit integer default 200)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_settings public.monthly_calendar_reminder_settings%rowtype;
  v_student public.students%rowtype;
  v_message jsonb;
  v_month text := to_char(clock_timestamp() at time zone 'Asia/Tokyo', 'YYYY-MM');
  v_local timestamp := clock_timestamp() at time zone 'Asia/Tokyo';
  v_key text;
  v_id uuid;
  v_processed integer := 0;
  v_queued integer := 0;
  v_skipped integer := 0;
  v_error text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role required.';
  end if;
  if p_limit is null or p_limit not between 1 and 500 then
    raise exception 'Batch limit must be between 1 and 500.';
  end if;
  select * into v_settings from public.monthly_calendar_reminder_settings s
  where s.enabled
    and (s.run_month is distinct from v_month or s.run_completed_at is null)
    and (extract(day from v_local)::integer > s.scheduled_day or (
      extract(day from v_local)::integer = s.scheduled_day
      and v_local::time >= s.scheduled_time
    ))
  order by s.organization_id
  limit 1 for update skip locked;
  if not found then
    return jsonb_build_object('due', false);
  end if;
  if not exists (
    select 1 from public.communication_templates t
    where t.template_key = v_settings.template_key and t.status = 'active'
      and t.channel = 'email' and t.body_template not like '%[Calendar URL]%'
      and t.body_template ~* 'https?://[^[:space:]]+'
  ) then
    raise exception 'Active calendar template with a verified URL is required.';
  end if;
  if v_settings.run_month is distinct from v_month then
    update public.monthly_calendar_reminder_settings
    set run_month = v_month, last_student_id = null, run_completed_at = null,
      recipient_count = (select count(*) from public.students s
        where s.organization_id = v_settings.organization_id and s.status = 'active')
    where organization_id = v_settings.organization_id;
    v_settings.last_student_id := null;
  end if;
  for v_student in
    select * from public.students s
    where s.organization_id = v_settings.organization_id and s.status = 'active'
      and (v_settings.last_student_id is null or s.id > v_settings.last_student_id)
    order by s.id limit p_limit
  loop
    v_processed := v_processed + 1;
    v_key := 'monthly_calendar:' || v_month || ':' || v_student.id::text;
    v_message := null;
    v_error := null;
    begin
      v_message := public.resolve_student_email_template_mvp(v_settings.template_key, v_student.id);
    exception when others then
      v_error := sqlerrm;
    end;
    if v_error is not null then
      insert into public.communications (
        organization_id, school_id, student_id, communication_type, channel,
        template_key, source, delivery_status, external_provider,
        idempotency_key, error_message, metadata
      ) values (
        v_student.organization_id, v_student.school_id, v_student.id,
        'monthly_calendar_reminder', 'email', v_settings.template_key,
        'automated', 'skipped', 'resend', v_key, v_error,
        jsonb_build_object('month', v_month, 'reason', v_error)
      ) on conflict (idempotency_key) do nothing;
      v_skipped := v_skipped + 1;
    else
      insert into public.communications (
        organization_id, school_id, student_id, communication_type, channel,
        recipient, subject, body, template_key, source, delivery_status,
        external_provider, idempotency_key, metadata
      ) values (
        v_student.organization_id, v_student.school_id, v_student.id,
        'monthly_calendar_reminder', 'email', v_message->>'recipient',
        v_message->>'subject', v_message->>'body', v_settings.template_key,
        'automated', 'queued', 'resend', v_key,
        jsonb_build_object('month', v_month, 'queued_from', 'monthly_calendar_reminder')
      ) on conflict (idempotency_key) do nothing returning id into v_id;
      if v_id is not null then
        insert into public.communication_integration_actions (
          organization_id, school_id, communication_id, provider, action_type,
          idempotency_key, request_payload
        ) values (
          v_student.organization_id, v_student.school_id, v_id, 'resend',
          'send_email', v_key || ':resend_send',
          jsonb_build_object('recipient', v_message->>'recipient',
            'subject', v_message->>'subject', 'body', v_message->>'body',
            'template_key', v_settings.template_key,
            'communication_type', 'monthly_calendar_reminder')
        );
        v_queued := v_queued + 1;
      end if;
      v_id := null;
    end if;
    v_settings.last_student_id := v_student.id;
  end loop;
  update public.monthly_calendar_reminder_settings
  set last_student_id = v_settings.last_student_id,
      last_execution_at = clock_timestamp(),
      run_completed_at = case when v_processed < p_limit then clock_timestamp() else null end,
      updated_at = clock_timestamp()
  where organization_id = v_settings.organization_id;
  return jsonb_build_object('due', true, 'organization_id', v_settings.organization_id,
    'month', v_month, 'processed', v_processed, 'queued', v_queued,
    'skipped', v_skipped, 'complete', v_processed < p_limit);
end;
$$;
revoke all on function public.enqueue_monthly_calendar_reminder_batch(integer) from public, anon, authenticated;
grant execute on function public.enqueue_monthly_calendar_reminder_batch(integer) to service_role;

create function public.monthly_calendar_reminder_status(p_organization_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_settings public.monthly_calendar_reminder_settings%rowtype;
  v_sent integer;
  v_failed integer;
  v_skipped integer;
  v_review integer;
begin
  if auth.uid() is null or not (
    public.is_super_admin() or public.has_org_role(
      p_organization_id, array['franchise_owner']::public.membership_role[]
    )
  ) then raise exception 'Administrator permission required.'; end if;
  select * into v_settings from public.monthly_calendar_reminder_settings
  where organization_id = p_organization_id;
  select count(*) filter (where delivery_status = 'sent'),
    count(*) filter (where delivery_status = 'failed'),
    count(*) filter (where delivery_status = 'skipped')
    into v_sent, v_failed, v_skipped
  from public.communications c
  where c.organization_id = p_organization_id
    and c.template_key = 'monthly_calendar_reminder'
    and c.source = 'automated'
    and left(c.idempotency_key, length('monthly_calendar:' || coalesce(v_settings.run_month, '') || ':'))
      = 'monthly_calendar:' || coalesce(v_settings.run_month, '') || ':';
  select count(*) into v_review
  from public.communication_integration_actions a
  join public.communications c on c.id = a.communication_id
  where c.organization_id = p_organization_id
    and c.template_key = 'monthly_calendar_reminder'
    and c.source = 'automated'
    and left(c.idempotency_key, length('monthly_calendar:' || coalesce(v_settings.run_month, '') || ':'))
      = 'monthly_calendar:' || coalesce(v_settings.run_month, '') || ':'
    and a.status = 'pending' and a.claim_token is not null
    and a.claim_expires_at < now();
  return jsonb_build_object(
    'enabled', coalesce(v_settings.enabled, false),
    'template_key', coalesce(v_settings.template_key, 'monthly_calendar_reminder'),
    'scheduled_day', v_settings.scheduled_day,
    'scheduled_time', v_settings.scheduled_time,
    'last_execution_at', v_settings.last_execution_at,
    'run_month', v_settings.run_month,
    'run_completed_at', v_settings.run_completed_at,
    'recipient_count', coalesce(v_settings.recipient_count, 0),
    'sent_count', v_sent, 'failed_count', v_failed, 'skipped_count', v_skipped,
    'review_count', v_review
  );
end;
$$;
revoke all on function public.monthly_calendar_reminder_status(uuid) from public, anon;
grant execute on function public.monthly_calendar_reminder_status(uuid) to authenticated;

-- Atomic, durable claim. Expired claims are held for investigation; automatic
-- reclamation after a provider request could send the same email twice.
alter table public.communication_integration_actions
  add column claim_token uuid,
  add column claim_expires_at timestamptz;

create function public.claim_communication_integration_actions(p_limit integer default 25)
returns setof public.communication_integration_actions
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role required.';
  end if;
  if p_limit is null or p_limit not between 1 and 100 then
    raise exception 'Claim limit must be between 1 and 100.';
  end if;
  return query
  with next_actions as (
    select a.id from public.communication_integration_actions a
    where a.status = 'pending' and a.claim_token is null
      and (a.communication_id is null or not exists (
        select 1 from public.communications c
        left join public.monthly_calendar_reminder_settings s
          on s.organization_id = c.organization_id
        where c.id = a.communication_id
          and c.template_key = 'monthly_calendar_reminder'
          and c.source = 'automated' and coalesce(s.enabled, false) = false
      ))
    order by a.created_at, a.id
    limit p_limit for update skip locked
  )
  update public.communication_integration_actions a
  set claim_token = gen_random_uuid(),
    claim_expires_at = clock_timestamp() + interval '15 minutes',
    last_attempt_at = clock_timestamp()
  from next_actions n where a.id = n.id
  returning a.*;
end;
$$;
revoke all on function public.claim_communication_integration_actions(integer) from public, anon, authenticated;
grant execute on function public.claim_communication_integration_actions(integer) to service_role;

create function public.release_communication_integration_claim(p_idempotency_key text, p_claim_token uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Service role required.'; end if;
  update public.communication_integration_actions
  set claim_token = null, claim_expires_at = null
  where idempotency_key = p_idempotency_key and status = 'pending'
    and claim_token = p_claim_token;
  if not found then raise exception 'Claim is no longer active.'; end if;
end;
$$;
revoke all on function public.release_communication_integration_claim(text, uuid) from public, anon, authenticated;
grant execute on function public.release_communication_integration_claim(text, uuid) to service_role;

create function public.record_claimed_communication_integration_result(
  p_idempotency_key text, p_claim_token uuid, p_status public.integration_action_status,
  p_external_id text default null, p_error_message text default null,
  p_response_payload jsonb default '{}'::jsonb
) returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id uuid;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Service role required.'; end if;
  if p_status not in ('succeeded', 'failed', 'skipped') then
    raise exception 'Only terminal statuses can be recorded.';
  end if;
  select id into v_id from public.communication_integration_actions
  where idempotency_key = p_idempotency_key and status = 'pending'
    and claim_token = p_claim_token for update;
  if not found then raise exception 'Claim is no longer active.'; end if;
  perform public.record_communication_integration_result(
    p_idempotency_key, p_status, p_external_id, p_error_message, p_response_payload
  );
  update public.communication_integration_actions
  set claim_token = null, claim_expires_at = null where id = v_id;
end;
$$;
revoke all on function public.record_claimed_communication_integration_result(text, uuid, public.integration_action_status, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.record_claimed_communication_integration_result(text, uuid, public.integration_action_status, text, text, jsonb) to service_role;

notify pgrst, 'reload schema';
