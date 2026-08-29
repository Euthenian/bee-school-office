create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron with schema extensions;

create or replace function public.get_gmail_trial_booking_cron_health(
  p_now timestamptz default now()
)
returns table (
  status text,
  last_run_at timestamptz,
  last_success_at timestamptz,
  last_result text,
  last_cron_status text,
  last_http_status integer,
  minutes_since_last_success integer,
  recent_failure_count integer
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_job_id bigint;
begin
  if not (
    public.is_super_admin()
    or exists (
      select 1
      from public.organization_memberships om
      where om.profile_id = (select auth.uid())
        and om.role in ('franchise_owner', 'office_staff')
    )
    or exists (
      select 1
      from public.school_memberships sm
      where sm.profile_id = (select auth.uid())
        and sm.role in ('school_manager', 'office_staff')
    )
  ) then
    raise exception 'You do not have permission to view Gmail Trial Booking cron health.';
  end if;

  select cj.jobid into v_job_id
  from cron.job cj
  where cj.jobname = 'bee-school-gmail-trial-booking-poll'
  order by cj.jobid
  limit 1;

  if v_job_id is null then
    return query
    select
      'critical'::text,
      null::timestamptz,
      null::timestamptz,
      'cron_job_missing'::text,
      null::text,
      null::integer,
      null::integer,
      0::integer;
    return;
  end if;

  return query
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
        when h.id is null and p_now <= r.start_time + interval '5 minutes' then 'http_response_pending'
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
            (h.id is null and p_now > r.start_time + interval '5 minutes')
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
        else greatest(0, floor(extract(epoch from (p_now - sb.last_success_at)) / 60))::integer
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
    end::text as status,
    s.last_run_at,
    s.last_success_at,
    coalesce(s.last_result, 'no_runs')::text as last_result,
    s.last_cron_status,
    s.last_http_status,
    s.minutes_since_last_success,
    coalesce(s.consecutive_failure_count, 0)::integer as recent_failure_count
  from summary s;
end;
$$;

revoke all on function public.get_gmail_trial_booking_cron_health(timestamptz) from public, anon, authenticated;
grant execute on function public.get_gmail_trial_booking_cron_health(timestamptz) to authenticated;

notify pgrst, 'reload schema';
