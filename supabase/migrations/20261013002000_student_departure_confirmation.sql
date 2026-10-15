-- A confirmed departure is a durable, immutable snapshot. No email is queued here.
create table public.student_departure_confirmations (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null,
  organization_id uuid not null,
  school_id uuid not null,
  billing_profile_id uuid not null,
  previous_status public.student_status not null,
  final_lesson_date date not null,
  final_billing_month date not null,
  billing_end_date date not null,
  confirmed_at timestamptz not null default now(),
  confirmed_by uuid not null references public.profiles (id) on delete restrict,
  voided_at timestamptz,
  voided_by uuid references public.profiles (id) on delete restrict,
  void_reason text,
  foreign key (student_id, organization_id, school_id)
    references public.students (id, organization_id, school_id) on delete restrict,
  foreign key (billing_profile_id, organization_id, school_id, student_id)
    references public.student_billing_profiles (id, organization_id, school_id, student_id) on delete restrict,
  constraint departure_billing_month_first_day check (final_billing_month = date_trunc('month', final_billing_month)::date),
  constraint departure_dates_agree check (final_lesson_date = billing_end_date and date_trunc('month', final_lesson_date)::date = final_billing_month),
  constraint departure_void_complete check (
    (voided_at is null and voided_by is null and void_reason is null)
    or (voided_at is not null and voided_by is not null and nullif(trim(void_reason), '') is not null)
  )
);

create unique index student_departure_one_active_confirmation
  on public.student_departure_confirmations (student_id) where voided_at is null;
create index student_departure_history_student_idx
  on public.student_departure_confirmations (student_id, confirmed_at desc);

comment on table public.student_departure_confirmations is
  'Immutable departure snapshots. A voided event remains in history; a later confirmation gets a new ID. No email is sent by this migration.';

alter table public.student_departure_confirmations enable row level security;
revoke all on public.student_departure_confirmations from public, anon, authenticated;
grant select on public.student_departure_confirmations to authenticated;
create policy student_departure_confirmations_read on public.student_departure_confirmations
  for select to authenticated using (public.can_manage_student(student_id));

create or replace function public.guard_departure_event_history()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Departure confirmation history cannot be deleted.';
  end if;
  if old.voided_at is not null or new.voided_at is null
    or new.voided_by is null or nullif(trim(coalesce(new.void_reason, '')), '') is null
    or (to_jsonb(new) - 'voided_at' - 'voided_by' - 'void_reason')
      is distinct from (to_jsonb(old) - 'voided_at' - 'voided_by' - 'void_reason') then
    raise exception 'Departure confirmation snapshots cannot be changed.';
  end if;
  return new;
end;
$$;

create trigger departure_event_history_guard
before update or delete on public.student_departure_confirmations
for each row execute function public.guard_departure_event_history();

create or replace function public.guard_student_departure_confirmation()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_event public.student_departure_confirmations%rowtype;
begin
  if tg_table_name = 'students' then
    if tg_op = 'INSERT' then
      if new.status = 'withdrawn' then
        raise exception 'Use Confirm Departure to set withdrawn status.';
      end if;
      return new;
    end if;

    select * into v_event from public.student_departure_confirmations
      where student_id = old.id and voided_at is null;
    if found then
      if new.status is distinct from 'withdrawn'::public.student_status
        or new.last_lesson_date is distinct from v_event.final_lesson_date
        or new.organization_id is distinct from v_event.organization_id
        or new.school_id is distinct from v_event.school_id then
        raise exception 'Void the departure confirmation before changing its status or dates.';
      end if;
    elsif new.status = 'withdrawn' and old.status is distinct from 'withdrawn'::public.student_status then
      raise exception 'Use Confirm Departure to set withdrawn status.';
    end if;
    return new;
  end if;

  select * into v_event from public.student_departure_confirmations
    where student_id = new.student_id and voided_at is null;
  if found then
    if tg_op = 'INSERT' then
      raise exception 'Void the departure confirmation before adding a billing profile.';
    end if;
    if new.id is distinct from v_event.billing_profile_id
      or new.billing_end_date is distinct from old.billing_end_date
      or new.student_id is distinct from old.student_id
      or new.organization_id is distinct from old.organization_id
      or new.school_id is distinct from old.school_id then
      raise exception 'Void the departure confirmation before changing billing profiles or dates.';
    end if;
  end if;
  return new;
end;
$$;

create trigger students_departure_confirmation_guard
before insert or update on public.students
for each row execute function public.guard_student_departure_confirmation();
create trigger billing_departure_confirmation_guard
before insert or update on public.student_billing_profiles
for each row execute function public.guard_student_departure_confirmation();

create or replace function public.get_student_departure_confirmation_state_mvp(p_student_id uuid)
returns table (
  student_status public.student_status,
  last_lesson_date date,
  billing_profile_id uuid,
  billing_start_date date,
  billing_end_date date,
  rico_cancellation_verified_at timestamptz,
  active_confirmation_id uuid,
  confirmed_at timestamptz,
  confirmed_final_lesson_date date,
  confirmed_final_billing_month date
) language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_student public.students%rowtype;
begin
  select * into v_student from public.students where id = p_student_id;
  if not found or auth.uid() is null or not public.can_manage_student(p_student_id)
    or not public.can_manage_student_finance_org(v_student.organization_id, v_student.school_id) then
    raise exception 'Student departure details are not available.';
  end if;
  return query
  select v_student.status, v_student.last_lesson_date,
    bp.id, bp.billing_start_date, bp.billing_end_date, bp.rico_cancellation_verified_at,
    dc.id, dc.confirmed_at, dc.final_lesson_date, dc.final_billing_month
  from (select 1) anchor
  left join lateral (
    select sbp.* from public.student_billing_profiles sbp
    where sbp.student_id = p_student_id
      and sbp.organization_id = v_student.organization_id and sbp.school_id = v_student.school_id
    order by sbp.updated_at desc, sbp.created_at desc, sbp.id desc limit 1
  ) bp on true
  left join public.student_departure_confirmations dc
    on dc.student_id = p_student_id and dc.voided_at is null;
end;
$$;

create or replace function public.confirm_student_departure_mvp(
  p_student_id uuid, p_final_lesson_date date, p_final_billing_month date, p_billing_profile_id uuid
) returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_student public.students%rowtype;
  v_billing public.student_billing_profiles%rowtype;
  v_event public.student_departure_confirmations%rowtype;
  v_event_id uuid;
begin
  if auth.uid() is null then raise exception 'You must be signed in.'; end if;
  select * into v_student from public.students where id = p_student_id for update;
  if not found or not public.can_manage_student(p_student_id)
    or not public.can_manage_student_finance_org(v_student.organization_id, v_student.school_id) then
    raise exception 'You cannot confirm this student departure.';
  end if;

  if p_final_lesson_date is null then raise exception 'Final lesson date is required.'; end if;
  if p_final_billing_month is null then raise exception 'Final billing month is required.'; end if;
  if p_final_billing_month <> date_trunc('month', p_final_billing_month)::date
    or p_final_billing_month <> date_trunc('month', p_final_lesson_date)::date then
    raise exception 'Final lesson date and final billing month conflict.';
  end if;
  if v_student.start_date is not null and p_final_lesson_date < v_student.start_date then
    raise exception 'Final lesson date cannot precede student start date.';
  end if;

  select * into v_billing from public.student_billing_profiles sbp
  where sbp.student_id = p_student_id
    and sbp.organization_id = v_student.organization_id and sbp.school_id = v_student.school_id
  order by sbp.updated_at desc, sbp.created_at desc, sbp.id desc limit 1 for update;
  if not found or p_billing_profile_id is null or v_billing.id <> p_billing_profile_id then
    raise exception 'A valid current billing profile is required. Reload the student and try again.';
  end if;
  if v_billing.billing_start_date is not null and p_final_lesson_date < v_billing.billing_start_date then
    raise exception 'Final lesson date conflicts with billing start date.';
  end if;
  if v_student.last_lesson_date is not null and v_billing.billing_end_date is not null
    and v_student.last_lesson_date <> v_billing.billing_end_date then
    raise exception 'Stored departure and billing dates conflict. Correct them before confirming.';
  end if;

  select * into v_event from public.student_departure_confirmations
    where student_id = p_student_id and voided_at is null for update;
  if found then
    if v_event.billing_profile_id = v_billing.id and v_event.final_lesson_date = p_final_lesson_date
      and v_event.final_billing_month = p_final_billing_month
      and v_student.status = 'withdrawn'
      and v_student.last_lesson_date = v_event.final_lesson_date
      and v_billing.billing_end_date = v_event.billing_end_date then
      return v_event.id;
    end if;
    raise exception 'This departure was already confirmed. Void it before recording a correction.';
  end if;
  if v_student.status = 'withdrawn' then
    raise exception 'This student is already withdrawn without a confirmation. Review the record before confirming.';
  end if;

  -- Existing RICO trigger clears verification if the billing end date changes.
  update public.students set last_lesson_date = p_final_lesson_date where id = p_student_id;
  update public.student_billing_profiles set billing_end_date = p_final_lesson_date where id = v_billing.id;
  insert into public.student_departure_confirmations (
    student_id, organization_id, school_id, billing_profile_id, previous_status,
    final_lesson_date, final_billing_month, billing_end_date, confirmed_by
  ) values (
    p_student_id, v_student.organization_id, v_student.school_id, v_billing.id, v_student.status,
    p_final_lesson_date, p_final_billing_month, p_final_lesson_date, auth.uid()
  ) returning id into v_event_id;
  update public.students set status = 'withdrawn' where id = p_student_id;
  return v_event_id;
end;
$$;

create or replace function public.void_student_departure_confirmation_mvp(p_student_id uuid, p_reason text)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_student public.students%rowtype; v_event public.student_departure_confirmations%rowtype;
begin
  if auth.uid() is null or nullif(trim(coalesce(p_reason, '')), '') is null then
    raise exception 'A signed-in staff member and correction reason are required.';
  end if;
  select * into v_student from public.students where id = p_student_id for update;
  if not found or not public.can_manage_student(p_student_id) then
    raise exception 'You cannot correct this student departure.';
  end if;
  select * into v_event from public.student_departure_confirmations
    where student_id = p_student_id and voided_at is null for update;
  if not found then raise exception 'No active departure confirmation exists.'; end if;
  update public.student_departure_confirmations
  set voided_at = now(), voided_by = auth.uid(), void_reason = trim(p_reason)
  where id = v_event.id;
  update public.students set status = v_event.previous_status where id = p_student_id;
  return v_event.id;
end;
$$;

revoke all on function public.guard_student_departure_confirmation() from public, anon, authenticated;
revoke all on function public.guard_departure_event_history() from public, anon, authenticated;
revoke all on function public.get_student_departure_confirmation_state_mvp(uuid) from public, anon;
revoke all on function public.confirm_student_departure_mvp(uuid, date, date, uuid) from public, anon;
revoke all on function public.void_student_departure_confirmation_mvp(uuid, text) from public, anon;
grant execute on function public.get_student_departure_confirmation_state_mvp(uuid) to authenticated;
grant execute on function public.confirm_student_departure_mvp(uuid, date, date, uuid) to authenticated;
grant execute on function public.void_student_departure_confirmation_mvp(uuid, text) to authenticated;

notify pgrst, 'reload schema';
