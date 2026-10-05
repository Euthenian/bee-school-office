-- Coaching occupancy is separate from Bee classes, trials, and package lessons.
create schema if not exists extensions;
create extension if not exists btree_gist with schema extensions;
set search_path = public, extensions;

create table public.coaching_reservations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  school_id uuid not null,
  staff_id uuid not null,
  program_id text not null references public.coaching_programs (id) on delete restrict,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  time_zone text not null,
  status text not null default 'confirmed' check (status in ('confirmed', 'cancelled')),
  source text not null check (source in ('internal_staff', 'ai_eigo')),
  learner_ref text not null check (length(trim(learner_ref)) > 0),
  request_key text not null check (length(trim(request_key)) > 0),
  created_at timestamptz not null default now(),
  cancelled_at timestamptz,
  constraint coaching_reservations_duration_check check (ends_at = starts_at + interval '30 minutes'),
  constraint coaching_reservations_cancellation_check check (
    (status = 'confirmed' and cancelled_at is null)
    or (status = 'cancelled' and cancelled_at is not null)
  ),
  constraint coaching_reservations_school_fkey foreign key (school_id, organization_id)
    references public.schools (id, organization_id) on delete restrict,
  constraint coaching_reservations_staff_fkey foreign key (staff_id, organization_id)
    references public.staff (id, organization_id) on delete restrict,
  unique (source, request_key),
  constraint coaching_reservations_staff_time_excl exclude using gist (
    staff_id with =,
    tstzrange(starts_at, ends_at, '[)') with &&
  ) where (status = 'confirmed')
);

create index coaching_reservations_school_start_idx
  on public.coaching_reservations (school_id, starts_at) where status = 'confirmed';

alter table public.coaching_reservations enable row level security;
revoke all on public.coaching_reservations from public, anon, authenticated, service_role;
grant select on public.coaching_reservations to authenticated;
create policy coaching_reservations_staff_read on public.coaching_reservations
  for select to authenticated
  using (public.can_manage_staff_org(organization_id) and public.can_manage_school(school_id));

-- Every writer of a timed Coach commitment takes this same transaction lock.
create function public.lock_coaching_staff_schedule(p_staff_id uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  perform pg_advisory_xact_lock(20261005, hashtext(p_staff_id::text));
end;
$$;
revoke all on function public.lock_coaching_staff_schedule(uuid) from public, anon, authenticated;

-- Trials and package lessons currently have no trustworthy duration. Any
-- assigned source on that local date conflicts with a confirmed reservation.
create function public.assert_no_coaching_reservation_on_day(
  p_staff_id uuid, p_school_id uuid, p_local_date date
) returns void language plpgsql volatile security definer set search_path = public as $$
declare
  v_zone text;
begin
  if p_staff_id is null or p_local_date is null then return; end if;
  perform public.lock_coaching_staff_schedule(p_staff_id);
  select timezone into v_zone from public.schools where id = p_school_id;
  if exists (
    select 1 from public.coaching_reservations cr
    where cr.staff_id = p_staff_id and cr.status = 'confirmed'
      and tstzrange(cr.starts_at, cr.ends_at, '[)') && tstzrange(
        p_local_date::timestamp at time zone v_zone,
        (p_local_date + 1)::timestamp at time zone v_zone, '[)')
  ) then
    raise exception 'Coach has a confirmed Coaching reservation on this date.';
  end if;
end;
$$;
revoke all on function public.assert_no_coaching_reservation_on_day(uuid, uuid, date)
  from public, anon, authenticated;

-- Check the same enrollment/billing duration that the availability engine uses.
create function public.assert_no_coaching_reservation_for_regular_lesson(
  p_student_id uuid, p_staff_id uuid, p_school_id uuid,
  p_weekday public.class_lesson_day, p_start_time time,
  p_start_date date, p_end_date date
) returns void language plpgsql volatile security definer set search_path = public as $$
declare
  v_profile_count integer;
  v_duration_count integer;
  v_duration integer;
  v_date date;
  v_lesson_date date;
  v_reservation record;
  v_zone text;
begin
  if p_staff_id is null then return; end if;
  perform public.lock_coaching_staff_schedule(p_staff_id);
  select timezone into v_zone from public.schools where id = p_school_id;
  select count(*), count(bp.lesson_duration_minutes), max(bp.lesson_duration_minutes)
  into v_profile_count, v_duration_count, v_duration
  from public.student_billing_profiles sbp
  left join public.billing_plans bp on bp.id = sbp.billing_plan_id
    and bp.organization_id = sbp.organization_id
    and (bp.school_id is null or bp.school_id = sbp.school_id)
  where sbp.student_id = p_student_id and sbp.school_id = p_school_id;

  for v_reservation in
    select starts_at, ends_at from public.coaching_reservations
    where staff_id = p_staff_id and status = 'confirmed'
  loop
    v_date = (v_reservation.starts_at at time zone v_zone)::date;
    foreach v_lesson_date in array array[v_date, v_date - 1, v_date + 1] loop
      if v_lesson_date = v_date + 1
        and v_reservation.ends_at <= (v_date + 1)::timestamp at time zone v_zone then
        continue;
      end if;
      if (p_start_date is null or p_start_date <= v_lesson_date)
        and (p_end_date is null or p_end_date >= v_lesson_date)
        and p_weekday::text = lower(trim(to_char(v_lesson_date, 'Day'))) then
        if v_profile_count <> 1 or v_duration_count <> 1
          or v_duration is null or v_duration < 1 or v_duration > 1440 then
          raise exception 'Coach has a confirmed Coaching reservation and class duration is unresolved.';
        end if;
        if tstzrange(v_reservation.starts_at, v_reservation.ends_at, '[)') && tstzrange(
          (v_lesson_date + p_start_time) at time zone v_zone,
          ((v_lesson_date + p_start_time) at time zone v_zone) + v_duration * interval '1 minute', '[)') then
          raise exception 'Bee lesson overlaps a confirmed Coaching reservation.';
        end if;
      end if;
    end loop;
  end loop;
end;
$$;
revoke all on function public.assert_no_coaching_reservation_for_regular_lesson(
  uuid, uuid, uuid, public.class_lesson_day, time, date, date
) from public, anon, authenticated;

create function public.internal_coaching_slot_state(
  p_school_id uuid, p_staff_id uuid, p_program_id text,
  p_local_date date, p_start_time time
) returns text language plpgsql volatile security definer set search_path = public as $$
declare
  v_school public.schools%rowtype;
  v_start_local timestamp;
  v_end_local timestamp;
  v_start_at timestamptz;
  v_lesson record;
  v_lesson_date date;
  v_other_school record;
  v_other_date date;
  v_offset integer;
begin
  if p_school_id is null or p_staff_id is null or p_program_id is null
    or p_local_date is null or p_start_time is null
    or extract(minute from p_start_time) not in (0, 30)
    or extract(second from p_start_time) <> 0 then
    return 'invalid_slot';
  end if;

  select * into v_school from public.schools where id = p_school_id and status = 'active';
  if not found then return 'slot_unavailable'; end if;
  v_start_local = p_local_date + p_start_time;
  v_end_local = v_start_local + interval '30 minutes';
  if v_end_local::date <> p_local_date then return 'slot_unavailable'; end if;
  v_start_at = v_start_local at time zone v_school.timezone;
  if (v_start_at at time zone v_school.timezone) <> v_start_local
    or ((v_start_at + interval '30 minutes') at time zone v_school.timezone) <> v_end_local then
    return 'invalid_slot';
  end if;

  if not exists (
    select 1 from public.staff st
    join public.staff_school_assignments ssa on ssa.staff_id = st.id
      and ssa.organization_id = st.organization_id
    join public.staff_coaching_settings scs on scs.staff_id = st.id
      and scs.organization_id = st.organization_id and scs.enabled
    join public.staff_coaching_programs scp on scp.staff_id = st.id
      and scp.organization_id = st.organization_id and scp.program_id = p_program_id
    join public.coaching_programs cp on cp.id = scp.program_id and cp.active
    where st.id = p_staff_id and st.organization_id = v_school.organization_id
      and st.status = 'active' and ssa.school_id = p_school_id
      and ssa.status = 'active'
      and (st.employment_start_date is null or st.employment_start_date <= p_local_date)
      and (st.employment_end_date is null or st.employment_end_date >= p_local_date)
      and (ssa.start_date is null or ssa.start_date <= p_local_date)
      and (ssa.end_date is null or ssa.end_date >= p_local_date)
  ) then return 'slot_unavailable'; end if;

  if not exists (
    select 1 from public.staff_availability_windows w
    where w.staff_id = p_staff_id and w.school_id = p_school_id and w.active
      and w.weekday = extract(isodow from p_local_date)::integer - 1
      and w.start_time <= p_start_time and w.end_time >= v_end_local::time
  ) then return 'slot_unavailable'; end if;

  if exists (
    select 1 from public.staff_availability_blocks b
    where b.staff_id = p_staff_id and b.school_id = p_school_id and b.active
      and b.local_date = p_local_date
      and b.start_time < v_end_local::time and p_start_time < b.end_time
  ) then return 'slot_unavailable'; end if;

  if exists (
    select 1 from public.trial_lessons tl
    join public.staff st on st.profile_id = tl.assigned_teacher_profile_id
      and st.organization_id = tl.organization_id
    where st.id = p_staff_id and tl.school_id = p_school_id
      and tl.trial_date = p_local_date and tl.status <> 'cancelled'
  ) or exists (
    select 1 from public.trial_package_lessons tpl
    join public.trial_packages tp on tp.id = tpl.trial_package_id
    where tpl.assigned_teacher_staff_id = p_staff_id and tpl.school_id = p_school_id
      and tpl.lesson_date = p_local_date and tpl.status = 'scheduled'
      and tp.status <> 'cancelled'
  ) then return 'unresolved_occupancy'; end if;

  for v_offset in -1..0 loop
    v_lesson_date = p_local_date + v_offset;
    for v_lesson in
      select c.lesson_time, billing.profile_count, billing.duration_count,
        billing.duration_minutes
      from public.student_enrollments se
      join public.classes c on c.id = se.class_id and c.school_id = se.school_id
        and c.organization_id = se.organization_id and c.status = 'active'
      left join lateral (
        select count(*) as profile_count, count(bp.lesson_duration_minutes) as duration_count,
          max(bp.lesson_duration_minutes) as duration_minutes
        from public.student_billing_profiles sbp
        left join public.billing_plans bp on bp.id = sbp.billing_plan_id
          and bp.organization_id = sbp.organization_id
          and (bp.school_id is null or bp.school_id = sbp.school_id)
        where sbp.student_id = se.student_id and sbp.school_id = se.school_id
          and sbp.organization_id = se.organization_id
      ) billing on true
      where se.assigned_teacher_staff_id = p_staff_id and se.school_id = p_school_id
        and se.status in ('active', 'pending')
        and (se.start_date is null or se.start_date <= v_lesson_date)
        and (se.end_date is null or se.end_date >= v_lesson_date)
        and c.lesson_day::text = lower(trim(to_char(v_lesson_date, 'Day')))
    loop
      if v_lesson.profile_count <> 1 or v_lesson.duration_count <> 1
        or v_lesson.duration_minutes is null
        or v_lesson.duration_minutes < 1 or v_lesson.duration_minutes > 1440 then
        return 'unresolved_occupancy';
      end if;
      if tstzrange(v_start_at, v_start_at + interval '30 minutes', '[)') && tstzrange(
        (v_lesson_date + v_lesson.lesson_time) at time zone v_school.timezone,
        ((v_lesson_date + v_lesson.lesson_time) at time zone v_school.timezone)
          + v_lesson.duration_minutes * interval '1 minute', '[)') then
        return 'slot_unavailable';
      end if;
    end loop;
  end loop;

  -- A Coach may teach in another school at the same real instant. Its local
  -- date and lesson start must be interpreted in that school's timezone.
  for v_other_school in
    select s.id, s.timezone from public.schools s
    join public.staff_school_assignments ssa on ssa.school_id = s.id
    where ssa.staff_id = p_staff_id and s.id <> p_school_id
  loop
    v_other_date = (v_start_at at time zone v_other_school.timezone)::date;
    if exists (
      select 1 from public.trial_lessons tl
      join public.staff st on st.profile_id = tl.assigned_teacher_profile_id
        and st.organization_id = tl.organization_id
      where st.id = p_staff_id and tl.school_id = v_other_school.id
        and tl.status <> 'cancelled'
        and tstzrange(v_start_at, v_start_at + interval '30 minutes', '[)') && tstzrange(
          tl.trial_date::timestamp at time zone v_other_school.timezone,
          (tl.trial_date + 1)::timestamp at time zone v_other_school.timezone, '[)')
    ) or exists (
      select 1 from public.trial_package_lessons tpl
      join public.trial_packages tp on tp.id = tpl.trial_package_id
      where tpl.assigned_teacher_staff_id = p_staff_id
        and tpl.school_id = v_other_school.id and tpl.status = 'scheduled'
        and tp.status <> 'cancelled'
        and tstzrange(v_start_at, v_start_at + interval '30 minutes', '[)') && tstzrange(
          tpl.lesson_date::timestamp at time zone v_other_school.timezone,
          (tpl.lesson_date + 1)::timestamp at time zone v_other_school.timezone, '[)')
    ) then return 'unresolved_occupancy'; end if;

    for v_offset in -1..(case
      when v_start_at + interval '30 minutes' >
        (v_other_date + 1)::timestamp at time zone v_other_school.timezone
        then 1 else 0 end) loop
      v_lesson_date = v_other_date + v_offset;
      for v_lesson in
        select c.lesson_time, billing.profile_count, billing.duration_count,
          billing.duration_minutes
        from public.student_enrollments se
        join public.classes c on c.id = se.class_id and c.school_id = se.school_id
          and c.organization_id = se.organization_id and c.status = 'active'
        left join lateral (
          select count(*) as profile_count, count(bp.lesson_duration_minutes) as duration_count,
            max(bp.lesson_duration_minutes) as duration_minutes
          from public.student_billing_profiles sbp
          left join public.billing_plans bp on bp.id = sbp.billing_plan_id
            and bp.organization_id = sbp.organization_id
            and (bp.school_id is null or bp.school_id = sbp.school_id)
          where sbp.student_id = se.student_id and sbp.school_id = se.school_id
            and sbp.organization_id = se.organization_id
        ) billing on true
        where se.assigned_teacher_staff_id = p_staff_id
          and se.school_id = v_other_school.id and se.status in ('active', 'pending')
          and (se.start_date is null or se.start_date <= v_lesson_date)
          and (se.end_date is null or se.end_date >= v_lesson_date)
          and c.lesson_day::text = lower(trim(to_char(v_lesson_date, 'Day')))
      loop
        if v_lesson.profile_count <> 1 or v_lesson.duration_count <> 1
          or v_lesson.duration_minutes is null
          or v_lesson.duration_minutes < 1 or v_lesson.duration_minutes > 1440 then
          return 'unresolved_occupancy';
        end if;
        if tstzrange(v_start_at, v_start_at + interval '30 minutes', '[)') && tstzrange(
          (v_lesson_date + v_lesson.lesson_time) at time zone v_other_school.timezone,
          ((v_lesson_date + v_lesson.lesson_time) at time zone v_other_school.timezone)
            + v_lesson.duration_minutes * interval '1 minute', '[)') then
          return 'slot_unavailable';
        end if;
      end loop;
    end loop;
  end loop;

  if exists (
    select 1 from public.coaching_reservations cr
    where cr.staff_id = p_staff_id and cr.status = 'confirmed'
      and tstzrange(cr.starts_at, cr.ends_at, '[)') &&
        tstzrange(v_start_at, v_start_at + interval '30 minutes', '[)')
  ) then return 'slot_unavailable'; end if;
  return 'available';
end;
$$;
revoke all on function public.internal_coaching_slot_state(uuid, uuid, text, date, time)
  from public, anon, authenticated;

create function public.reserve_internal_coaching_slot(
  p_school_id uuid, p_program_id text, p_staff_id uuid,
  p_local_date date, p_start_time time,
  p_source text, p_learner_ref text, p_request_key text
) returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_school public.schools%rowtype;
  v_existing public.coaching_reservations%rowtype;
  v_id uuid;
  v_state text;
  v_starts_at timestamptz;
begin
  if p_school_id is null or p_staff_id is null or p_program_id is null
    or p_local_date is null or p_start_time is null
    or nullif(trim(coalesce(p_learner_ref, '')), '') is null
    or nullif(trim(coalesce(p_request_key, '')), '') is null
    or p_source is null or p_source not in ('internal_staff', 'ai_eigo') then
    return jsonb_build_object('status', 'invalid_request');
  end if;

  select * into v_school from public.schools where id = p_school_id and status = 'active';
  if not found then return jsonb_build_object('status', 'slot_unavailable'); end if;
  if not (
    ((select auth.role()) = 'authenticated' and p_source = 'internal_staff'
      and public.can_manage_staff_org(v_school.organization_id)
      and public.can_manage_school(p_school_id))
    or ((select auth.role()) = 'service_role' and p_source = 'ai_eigo')
  ) then
    raise exception 'Not authorized to reserve Coaching for this school.' using errcode = '42501';
  end if;

  perform public.lock_coaching_staff_schedule(p_staff_id);
  select * into v_existing from public.coaching_reservations
  where source = p_source and request_key = p_request_key;
  if found then
    v_starts_at = (p_local_date + p_start_time) at time zone v_existing.time_zone;
    if v_existing.school_id = p_school_id and v_existing.staff_id = p_staff_id
      and v_existing.program_id = p_program_id and v_existing.learner_ref = p_learner_ref
      and v_existing.starts_at = v_starts_at then
      return jsonb_build_object('status', v_existing.status,
        'reservation_id', v_existing.id, 'idempotent', true);
    end if;
    return jsonb_build_object('status', 'request_key_conflict');
  end if;

  v_state = public.internal_coaching_slot_state(
    p_school_id, p_staff_id, p_program_id, p_local_date, p_start_time);
  if v_state <> 'available' then return jsonb_build_object('status', v_state); end if;

  v_starts_at = (p_local_date + p_start_time) at time zone v_school.timezone;
  begin
    insert into public.coaching_reservations (
      organization_id, school_id, staff_id, program_id,
      starts_at, ends_at, time_zone, status, source, learner_ref, request_key
    ) values (
      v_school.organization_id, p_school_id, p_staff_id, p_program_id,
      v_starts_at, v_starts_at + interval '30 minutes', v_school.timezone,
      'confirmed', p_source, p_learner_ref, p_request_key
    ) on conflict (source, request_key) do nothing returning id into v_id;
  exception when exclusion_violation then
    return jsonb_build_object('status', 'slot_unavailable');
  end;

  if v_id is null then
    select * into v_existing from public.coaching_reservations
    where source = p_source and request_key = p_request_key;
    if v_existing.school_id = p_school_id and v_existing.staff_id = p_staff_id
      and v_existing.program_id = p_program_id and v_existing.learner_ref = p_learner_ref
      and v_existing.starts_at = v_starts_at then
      return jsonb_build_object('status', v_existing.status,
        'reservation_id', v_existing.id, 'idempotent', true);
    end if;
    return jsonb_build_object('status', 'request_key_conflict');
  end if;
  return jsonb_build_object('status', 'confirmed', 'reservation_id', v_id, 'idempotent', false);
end;
$$;
revoke all on function public.reserve_internal_coaching_slot(
  uuid, text, uuid, date, time, text, text, text
) from public, anon, authenticated, service_role;
grant execute on function public.reserve_internal_coaching_slot(
  uuid, text, uuid, date, time, text, text, text
) to authenticated, service_role;

create function public.cancel_internal_coaching_reservation(p_reservation_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_reservation public.coaching_reservations%rowtype;
begin
  select * into v_reservation from public.coaching_reservations
  where id = p_reservation_id;
  if not found then return jsonb_build_object('status', 'not_found'); end if;
  if not (
    ((select auth.role()) = 'authenticated'
      and public.can_manage_staff_org(v_reservation.organization_id)
      and public.can_manage_school(v_reservation.school_id))
    or ((select auth.role()) = 'service_role' and v_reservation.source = 'ai_eigo')
  ) then
    raise exception 'Not authorized to cancel this Coaching reservation.' using errcode = '42501';
  end if;
  perform public.lock_coaching_staff_schedule(v_reservation.staff_id);
  update public.coaching_reservations
  set status = 'cancelled', cancelled_at = coalesce(cancelled_at, now())
  where id = p_reservation_id and status = 'confirmed';
  return jsonb_build_object('status', 'cancelled', 'reservation_id', p_reservation_id);
end;
$$;
revoke all on function public.cancel_internal_coaching_reservation(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.cancel_internal_coaching_reservation(uuid)
  to authenticated, service_role;

-- AFTER triggers see the final row, including existing assignment triggers and
-- linked package/trial sync. Raising here rolls the original Bee write back.
create function public.guard_bee_schedule_against_coaching()
returns trigger language plpgsql volatile security definer set search_path = public as $$
declare
  v_class public.classes%rowtype;
  v_enrollment public.student_enrollments%rowtype;
  v_lesson public.trial_package_lessons%rowtype;
  v_profile public.student_billing_profiles%rowtype;
  v_staff_id uuid;
begin
  if tg_table_name = 'trial_lessons' then
    if tg_op <> 'DELETE' and new.assigned_teacher_profile_id is not null
      and new.status <> 'cancelled' then
      select st.id into v_staff_id from public.staff st
      where st.profile_id = new.assigned_teacher_profile_id
        and st.organization_id = new.organization_id;
      perform public.assert_no_coaching_reservation_on_day(v_staff_id, new.school_id, new.trial_date);
    end if;
  elsif tg_table_name = 'trial_package_lessons' then
    if tg_op <> 'DELETE' and new.assigned_teacher_staff_id is not null
      and new.status = 'scheduled' and exists (
        select 1 from public.trial_packages tp
        where tp.id = new.trial_package_id and tp.status <> 'cancelled'
      ) then
      perform public.assert_no_coaching_reservation_on_day(
        new.assigned_teacher_staff_id, new.school_id, new.lesson_date);
    end if;
  elsif tg_table_name = 'trial_packages' then
    if tg_op <> 'DELETE' and new.status <> 'cancelled' then
      for v_lesson in select * from public.trial_package_lessons tpl
        where tpl.trial_package_id = new.id and tpl.status = 'scheduled'
          and tpl.assigned_teacher_staff_id is not null
      loop
        perform public.assert_no_coaching_reservation_on_day(
          v_lesson.assigned_teacher_staff_id, v_lesson.school_id, v_lesson.lesson_date);
      end loop;
    end if;
  elsif tg_table_name = 'classes' then
    if tg_op <> 'DELETE' and new.status = 'active' then
      for v_enrollment in select * from public.student_enrollments se
        where se.class_id = new.id and se.status in ('active', 'pending')
          and se.assigned_teacher_staff_id is not null
      loop
        perform public.assert_no_coaching_reservation_for_regular_lesson(
          v_enrollment.student_id, v_enrollment.assigned_teacher_staff_id,
          new.school_id, new.lesson_day, new.lesson_time,
          v_enrollment.start_date, v_enrollment.end_date);
      end loop;
    end if;
  elsif tg_table_name = 'student_enrollments' then
    select * into v_enrollment from public.student_enrollments se where se.id = new.id;
    if found and v_enrollment.status in ('active', 'pending')
      and v_enrollment.assigned_teacher_staff_id is not null then
      select * into v_class from public.classes c
      where c.id = v_enrollment.class_id and c.status = 'active';
      if found then
        perform public.assert_no_coaching_reservation_for_regular_lesson(
          v_enrollment.student_id, v_enrollment.assigned_teacher_staff_id,
          v_enrollment.school_id, v_class.lesson_day, v_class.lesson_time,
          v_enrollment.start_date, v_enrollment.end_date);
      end if;
    end if;
  elsif tg_table_name = 'student_billing_profiles' then
    if tg_op = 'DELETE' then v_profile = old;
    else v_profile = new; end if;
    for v_enrollment in select * from public.student_enrollments se
      where se.student_id = v_profile.student_id and se.school_id = v_profile.school_id
        and se.status in ('active', 'pending') and se.assigned_teacher_staff_id is not null
    loop
      select * into v_class from public.classes c
      where c.id = v_enrollment.class_id and c.status = 'active';
      if found then
        perform public.assert_no_coaching_reservation_for_regular_lesson(
          v_enrollment.student_id, v_enrollment.assigned_teacher_staff_id,
          v_enrollment.school_id, v_class.lesson_day, v_class.lesson_time,
          v_enrollment.start_date, v_enrollment.end_date);
      end if;
    end loop;
  elsif tg_table_name = 'billing_plans' then
    for v_profile in select * from public.student_billing_profiles sbp
      where sbp.billing_plan_id = new.id
    loop
      for v_enrollment in select * from public.student_enrollments se
        where se.student_id = v_profile.student_id and se.school_id = v_profile.school_id
          and se.status in ('active', 'pending') and se.assigned_teacher_staff_id is not null
      loop
        select * into v_class from public.classes c
        where c.id = v_enrollment.class_id and c.status = 'active';
        if found then
          perform public.assert_no_coaching_reservation_for_regular_lesson(
            v_enrollment.student_id, v_enrollment.assigned_teacher_staff_id,
            v_enrollment.school_id, v_class.lesson_day, v_class.lesson_time,
            v_enrollment.start_date, v_enrollment.end_date);
        end if;
      end loop;
    end loop;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function public.guard_bee_schedule_against_coaching()
  from public, anon, authenticated;

create trigger coaching_guard_trial_lessons
after insert or update on public.trial_lessons
for each row execute function public.guard_bee_schedule_against_coaching();

create trigger coaching_guard_trial_package_lessons
after insert or update on public.trial_package_lessons
for each row execute function public.guard_bee_schedule_against_coaching();

create trigger coaching_guard_trial_packages
after update of status on public.trial_packages
for each row execute function public.guard_bee_schedule_against_coaching();

create trigger coaching_guard_classes
after insert or update of school_id, lesson_day, lesson_time, status on public.classes
for each row execute function public.guard_bee_schedule_against_coaching();

create constraint trigger coaching_guard_student_enrollments
after insert or update on public.student_enrollments
deferrable initially deferred
for each row execute function public.guard_bee_schedule_against_coaching();

create constraint trigger coaching_guard_student_billing_profiles
after insert or update or delete on public.student_billing_profiles
deferrable initially deferred
for each row execute function public.guard_bee_schedule_against_coaching();

create trigger coaching_guard_billing_plan_duration
after update of lesson_duration_minutes on public.billing_plans
for each row execute function public.guard_bee_schedule_against_coaching();

-- Keep the existing facts RPC intact; this wrapper adds only confirmed Coaching
-- occupancy and inherits its staff/school authorization check.
create function public.get_internal_coaching_availability_with_reservations(
  p_school_id uuid, p_program_id text, p_start_date date, p_end_date date
) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_facts jsonb;
  v_reservations jsonb;
  v_zone text;
begin
  v_facts = public.get_internal_coaching_availability_facts(
    p_school_id, p_program_id, p_start_date, p_end_date);
  v_zone = v_facts->>'timeZone';
  select coalesce(jsonb_agg(jsonb_build_object(
    'staffId', cr.staff_id,
    'localDate', day.local_day::date,
    'startTime', to_char(greatest(cr.starts_at at time zone v_zone, day.local_day), 'HH24:MI:SS'),
    'endTime', case
      when cr.ends_at at time zone v_zone >= day.local_day + interval '1 day'
        then '23:59:59'
      else to_char(cr.ends_at at time zone v_zone, 'HH24:MI:SS') end
  ) order by day.local_day, cr.starts_at, cr.staff_id), '[]'::jsonb)
  into v_reservations
  from public.coaching_reservations cr
  cross join lateral generate_series(
    p_start_date::timestamp, p_end_date::timestamp, interval '1 day'
  ) as day(local_day)
  where cr.status = 'confirmed' and exists (
      select 1 from public.staff_school_assignments ssa
      where ssa.staff_id = cr.staff_id and ssa.school_id = p_school_id
    )
    and tstzrange(cr.starts_at, cr.ends_at, '[)') && tstzrange(
      day.local_day at time zone v_zone,
      (day.local_day + interval '1 day') at time zone v_zone, '[)');
  return v_facts || jsonb_build_object('coachingReservations', v_reservations);
end;
$$;
revoke all on function public.get_internal_coaching_availability_with_reservations(
  uuid, text, date, date
) from public, anon, authenticated;
grant execute on function public.get_internal_coaching_availability_with_reservations(
  uuid, text, date, date
) to authenticated;
revoke execute on function public.get_internal_coaching_availability_facts(
  uuid, text, date, date
) from authenticated;

notify pgrst, 'reload schema';
