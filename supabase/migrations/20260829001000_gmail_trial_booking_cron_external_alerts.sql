create table if not exists public.gmail_trial_booking_cron_incidents (
  id uuid primary key default gen_random_uuid(),
  monitor_key text not null default 'bee-school-gmail-trial-booking-poll',
  incident_status text not null default 'critical'
    check (incident_status in ('critical', 'recovered')),
  started_at timestamptz not null,
  last_detected_at timestamptz not null,
  recovered_at timestamptz,
  last_health_status text not null
    check (last_health_status in ('healthy', 'warning', 'critical')),
  last_run_at timestamptz,
  last_success_at timestamptz,
  last_result text,
  last_cron_status text,
  last_http_status integer,
  minutes_since_last_success integer,
  recent_failure_count integer not null default 0,
  critical_alert_requested_at timestamptz,
  critical_alert_sent_at timestamptz,
  critical_alert_failed_at timestamptz,
  critical_alert_error text,
  critical_alert_external_id text,
  recovery_alert_requested_at timestamptz,
  recovery_alert_sent_at timestamptz,
  recovery_alert_failed_at timestamptz,
  recovery_alert_error text,
  recovery_alert_external_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint gmail_trial_booking_cron_incidents_recovered_after_start
    check (recovered_at is null or recovered_at >= started_at)
);

create index if not exists gmail_trial_booking_cron_incidents_monitor_idx
on public.gmail_trial_booking_cron_incidents (monitor_key, started_at desc);

create unique index if not exists gmail_trial_booking_cron_incidents_one_open_uidx
on public.gmail_trial_booking_cron_incidents (monitor_key)
where incident_status = 'critical';

drop trigger if exists gmail_trial_booking_cron_incidents_set_updated_at
on public.gmail_trial_booking_cron_incidents;
create trigger gmail_trial_booking_cron_incidents_set_updated_at
before update on public.gmail_trial_booking_cron_incidents
for each row execute function public.set_updated_at();

alter table public.gmail_trial_booking_cron_incidents enable row level security;

revoke all on public.gmail_trial_booking_cron_incidents from public, anon, authenticated;
grant all on public.gmail_trial_booking_cron_incidents to service_role;

create or replace function public.evaluate_gmail_trial_booking_cron_alert_mvp(
  p_current_ok boolean default null,
  p_current_result text default null,
  p_current_http_status integer default null,
  p_now timestamptz default now()
)
returns table (
  action text,
  incident_id uuid,
  health_status text,
  detected_at timestamptz,
  last_run_at timestamptz,
  last_success_at timestamptz,
  last_result text,
  last_cron_status text,
  last_http_status integer,
  minutes_since_last_success integer,
  recent_failure_count integer,
  incident_started_at timestamptz,
  recovered_at timestamptz
)
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_monitor_key text := 'bee-school-gmail-trial-booking-poll';
  v_action text := 'none';
  v_detected_at timestamptz := coalesce(p_now, now());
  v_existing public.gmail_trial_booking_cron_incidents%rowtype;
  v_health_status text := 'critical';
  v_incident_id uuid;
  v_incident_started_at timestamptz;
  v_job_id bigint;
  v_last_cron_status text;
  v_last_http_status integer;
  v_last_result text := 'no_runs';
  v_last_run_at timestamptz;
  v_last_success_at timestamptz;
  v_minutes_since_last_success integer;
  v_recent_failure_count integer := 0;
  v_recovered_at timestamptz;
begin
  if coalesce((select auth.role()), '') <> 'service_role' then
    raise exception 'Only the service role may evaluate Gmail Trial Booking cron alert incidents.'
      using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtext('gmail_trial_booking_cron_external_alerts'));

  select cj.jobid into v_job_id
  from cron.job cj
  where cj.jobname = v_monitor_key
  order by cj.jobid
  limit 1;

  if v_job_id is null then
    v_health_status := 'critical';
    v_last_result := 'cron_job_missing';
  else
    with runs as (
      select
        r.jobid,
        r.runid,
        r.status as cron_status,
        r.return_message,
        r.start_time,
        r.end_time
      from cron.job_run_details r
      where r.jobid = v_job_id
      order by r.start_time desc
      limit 20
    ),
    run_results as (
      select
        r.*,
        h.status_code,
        h.timed_out,
        h.error_msg,
        h.content,
        case
          when r.cron_status <> 'succeeded' then 'cron_' || r.cron_status
          when h.id is null and v_detected_at <= r.start_time + interval '5 minutes' then 'http_response_pending'
          when h.id is null then 'http_response_missing'
          when coalesce(h.timed_out, false) then 'http_timeout'
          when h.error_msg is not null then 'http_error'
          when h.status_code < 200 or h.status_code >= 300 then 'http_' || h.status_code::text
          when coalesce(h.content, '') like '%"ok":true%'
            or coalesce(h.content, '') like '%"ok": true%' then 'http_200_function_ok'
          else 'http_200_function_unhealthy'
        end as result_text,
        (
          r.cron_status = 'succeeded'
          and h.status_code >= 200
          and h.status_code < 300
          and not coalesce(h.timed_out, false)
          and h.error_msg is null
          and (
            coalesce(h.content, '') like '%"ok":true%'
            or coalesce(h.content, '') like '%"ok": true%'
          )
        ) as is_success,
        (
          r.cron_status <> 'succeeded'
          or (
            r.cron_status = 'succeeded'
            and (
              (h.id is null and v_detected_at > r.start_time + interval '5 minutes')
              or coalesce(h.timed_out, false)
              or h.error_msg is not null
              or h.status_code < 200
              or h.status_code >= 300
              or (
                h.status_code >= 200
                and h.status_code < 300
                and not (
                  coalesce(h.content, '') like '%"ok":true%'
                  or coalesce(h.content, '') like '%"ok": true%'
                )
              )
            )
          )
        ) as is_failure
      from runs r
      left join lateral (
        select hr.*
        from net._http_response hr
        where hr.created >= r.start_time - interval '10 seconds'
          and hr.created <= coalesce(r.end_time, r.start_time) + interval '5 minutes'
        order by
          case
            when coalesce(hr.content, '') like '%"skippedDuplicates"%'
              or coalesce(hr.content, '') like '%"parseErrors"%'
              or coalesce(hr.content, '') like '%"processed"%' then 0
            else 1
          end,
          abs(extract(epoch from (hr.created - r.start_time)))
        limit 1
      ) h on true
    ),
    ordered_results as (
      select
        rr.*,
        row_number() over (order by rr.start_time desc) as rn
      from run_results rr
    ),
    summary_base as (
      select
        (select o.start_time from ordered_results o where o.rn = 1) as last_run_at,
        (select max(o.start_time) from ordered_results o where o.is_success) as last_success_at,
        (select o.result_text from ordered_results o where o.rn = 1) as last_result,
        (select o.cron_status from ordered_results o where o.rn = 1) as last_cron_status,
        (select o.status_code from ordered_results o where o.rn = 1) as last_http_status,
        (
          select count(*)::integer
          from ordered_results o
          where o.rn < coalesce(
            (select min(successes.rn) from ordered_results successes where successes.is_success),
            1000000
          )
            and o.is_failure
        ) as consecutive_failure_count
    ),
    summary as (
      select
        sb.*,
        case
          when sb.last_success_at is null then null::integer
          else greatest(0, floor(extract(epoch from (v_detected_at - sb.last_success_at)) / 60))::integer
        end as minutes_since_last_success
      from summary_base sb
    )
    select
      case
        when s.last_success_at is null then 'critical'
        when s.consecutive_failure_count >= 2 then 'critical'
        when s.minutes_since_last_success > 45 then 'critical'
        when s.consecutive_failure_count = 1 then 'warning'
        when s.minutes_since_last_success > 30 then 'warning'
        else 'healthy'
      end::text,
      s.last_run_at,
      s.last_success_at,
      coalesce(s.last_result, 'no_runs')::text,
      s.last_cron_status,
      s.last_http_status,
      s.minutes_since_last_success,
      coalesce(s.consecutive_failure_count, 0)::integer
    into
      v_health_status,
      v_last_run_at,
      v_last_success_at,
      v_last_result,
      v_last_cron_status,
      v_last_http_status,
      v_minutes_since_last_success,
      v_recent_failure_count
    from summary s;
  end if;

  if p_current_ok is true then
    v_health_status := 'healthy';
    v_last_run_at := v_detected_at;
    v_last_success_at := v_detected_at;
    v_last_result := coalesce(nullif(p_current_result, ''), 'current_poll_ok');
    v_last_cron_status := coalesce(v_last_cron_status, 'succeeded');
    v_last_http_status := coalesce(p_current_http_status, 200);
    v_minutes_since_last_success := 0;
    v_recent_failure_count := 0;
  elsif p_current_ok is false then
    v_last_run_at := v_detected_at;
    v_last_result := coalesce(nullif(p_current_result, ''), 'current_poll_failed');
    v_last_cron_status := coalesce(v_last_cron_status, 'succeeded');
    v_last_http_status := coalesce(p_current_http_status, 502);
    v_minutes_since_last_success := case
      when v_last_success_at is null then null
      else greatest(0, floor(extract(epoch from (v_detected_at - v_last_success_at)) / 60))::integer
    end;
    v_recent_failure_count := coalesce(v_recent_failure_count, 0) + 1;
    v_health_status := case
      when v_last_success_at is null then 'critical'
      when v_recent_failure_count >= 2 then 'critical'
      when v_minutes_since_last_success > 45 then 'critical'
      else 'warning'
    end;
  end if;

  if v_health_status = 'critical' then
    select *
    into v_existing
    from public.gmail_trial_booking_cron_incidents i
    where i.monitor_key = v_monitor_key
      and i.incident_status = 'critical'
    for update;

    if not found then
      insert into public.gmail_trial_booking_cron_incidents (
        monitor_key,
        incident_status,
        started_at,
        last_detected_at,
        last_health_status,
        last_run_at,
        last_success_at,
        last_result,
        last_cron_status,
        last_http_status,
        minutes_since_last_success,
        recent_failure_count,
        critical_alert_requested_at
      )
      values (
        v_monitor_key,
        'critical',
        v_detected_at,
        v_detected_at,
        v_health_status,
        v_last_run_at,
        v_last_success_at,
        v_last_result,
        v_last_cron_status,
        v_last_http_status,
        v_minutes_since_last_success,
        v_recent_failure_count,
        v_detected_at
      )
      returning * into v_existing;

      v_action := 'send_critical_alert';
    else
      update public.gmail_trial_booking_cron_incidents
      set
        last_detected_at = v_detected_at,
        last_health_status = v_health_status,
        last_run_at = v_last_run_at,
        last_success_at = v_last_success_at,
        last_result = v_last_result,
        last_cron_status = v_last_cron_status,
        last_http_status = v_last_http_status,
        minutes_since_last_success = v_minutes_since_last_success,
        recent_failure_count = v_recent_failure_count
      where id = v_existing.id
      returning * into v_existing;
    end if;
  elsif v_health_status = 'healthy' then
    select *
    into v_existing
    from public.gmail_trial_booking_cron_incidents i
    where i.monitor_key = v_monitor_key
      and i.incident_status = 'critical'
    for update;

    if found then
      update public.gmail_trial_booking_cron_incidents
      set
        incident_status = 'recovered',
        recovered_at = v_detected_at,
        last_detected_at = v_detected_at,
        last_health_status = v_health_status,
        last_run_at = v_last_run_at,
        last_success_at = v_last_success_at,
        last_result = v_last_result,
        last_cron_status = v_last_cron_status,
        last_http_status = v_last_http_status,
        minutes_since_last_success = v_minutes_since_last_success,
        recent_failure_count = v_recent_failure_count,
        recovery_alert_requested_at = coalesce(recovery_alert_requested_at, v_detected_at)
      where id = v_existing.id
      returning * into v_existing;

      v_action := 'send_recovery_alert';
    end if;
  else
    select *
    into v_existing
    from public.gmail_trial_booking_cron_incidents i
    where i.monitor_key = v_monitor_key
      and i.incident_status = 'critical'
    for update;

    if found then
      update public.gmail_trial_booking_cron_incidents
      set
        last_detected_at = v_detected_at,
        last_health_status = v_health_status,
        last_run_at = v_last_run_at,
        last_success_at = v_last_success_at,
        last_result = v_last_result,
        last_cron_status = v_last_cron_status,
        last_http_status = v_last_http_status,
        minutes_since_last_success = v_minutes_since_last_success,
        recent_failure_count = v_recent_failure_count
      where id = v_existing.id
      returning * into v_existing;
    end if;
  end if;

  if v_existing.id is not null then
    v_incident_id := v_existing.id;
    v_incident_started_at := v_existing.started_at;
    v_recovered_at := v_existing.recovered_at;
  end if;

  return query
  select
    v_action,
    v_incident_id,
    v_health_status,
    v_detected_at,
    v_last_run_at,
    v_last_success_at,
    v_last_result,
    v_last_cron_status,
    v_last_http_status,
    v_minutes_since_last_success,
    v_recent_failure_count,
    v_incident_started_at,
    v_recovered_at;
end;
$$;

create or replace function public.record_gmail_trial_booking_cron_alert_email_result(
  p_incident_id uuid,
  p_alert_type text,
  p_external_id text default null,
  p_error_message text default null,
  p_now timestamptz default now()
)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  if coalesce((select auth.role()), '') <> 'service_role' then
    raise exception 'Only the service role may record Gmail Trial Booking cron alert delivery.'
      using errcode = '42501';
  end if;

  if p_alert_type not in ('critical', 'recovery') then
    raise exception 'Unsupported alert type %. Expected critical or recovery.', p_alert_type;
  end if;

  if p_alert_type = 'critical' then
    update public.gmail_trial_booking_cron_incidents
    set
      critical_alert_sent_at = case when p_error_message is null then coalesce(critical_alert_sent_at, p_now) else critical_alert_sent_at end,
      critical_alert_failed_at = case when p_error_message is null then critical_alert_failed_at else p_now end,
      critical_alert_error = p_error_message,
      critical_alert_external_id = case
        when p_error_message is null then coalesce(p_external_id, critical_alert_external_id)
        else critical_alert_external_id
      end
    where id = p_incident_id;
  else
    update public.gmail_trial_booking_cron_incidents
    set
      recovery_alert_sent_at = case when p_error_message is null then coalesce(recovery_alert_sent_at, p_now) else recovery_alert_sent_at end,
      recovery_alert_failed_at = case when p_error_message is null then recovery_alert_failed_at else p_now end,
      recovery_alert_error = p_error_message,
      recovery_alert_external_id = case
        when p_error_message is null then coalesce(p_external_id, recovery_alert_external_id)
        else recovery_alert_external_id
      end
    where id = p_incident_id;
  end if;
end;
$$;

revoke all on function public.evaluate_gmail_trial_booking_cron_alert_mvp(
  boolean,
  text,
  integer,
  timestamptz
) from public, anon, authenticated;
grant execute on function public.evaluate_gmail_trial_booking_cron_alert_mvp(
  boolean,
  text,
  integer,
  timestamptz
) to service_role;

revoke all on function public.record_gmail_trial_booking_cron_alert_email_result(
  uuid,
  text,
  text,
  text,
  timestamptz
) from public, anon, authenticated;
grant execute on function public.record_gmail_trial_booking_cron_alert_email_result(
  uuid,
  text,
  text,
  text,
  timestamptz
) to service_role;

notify pgrst, 'reload schema';
