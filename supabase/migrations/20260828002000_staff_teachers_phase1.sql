create table if not exists public.staff (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  profile_id uuid,
  legal_name text not null,
  display_name text,
  address text,
  phone text,
  email citext,
  employment_type text not null default 'employee',
  employment_start_date date,
  employment_end_date date,
  status text not null default 'active',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  constraint staff_organization_id_fkey
    foreign key (organization_id)
    references public.organizations (id)
    on delete restrict,
  constraint staff_profile_id_fkey
    foreign key (profile_id)
    references public.profiles (id)
    on delete set null,
  constraint staff_employment_type_check
    check (employment_type in ('employee', 'contractor', 'part_time', 'temporary', 'other')),
  constraint staff_status_check
    check (status in ('active', 'inactive', 'on_leave', 'ended')),
  constraint staff_employment_dates_check
    check (
      employment_start_date is null
      or employment_end_date is null
      or employment_end_date >= employment_start_date
    )
);

create unique index if not exists staff_organization_profile_id_uidx
on public.staff (organization_id, profile_id)
where profile_id is not null;

create index if not exists staff_organization_status_idx
on public.staff (organization_id, status);

create index if not exists staff_profile_id_idx
on public.staff (profile_id)
where profile_id is not null;

comment on table public.staff is
'Staff HR/employment identity for Bee School Office. Payroll, billing, and My Number data are intentionally out of scope.';

create table if not exists public.staff_school_assignments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  staff_id uuid not null,
  school_id uuid not null,
  can_teach boolean not null default false,
  status text not null default 'active',
  start_date date,
  end_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (staff_id, school_id),
  constraint staff_school_assignments_staff_id_organization_id_fkey
    foreign key (staff_id, organization_id)
    references public.staff (id, organization_id)
    on delete cascade,
  constraint staff_school_assignments_school_id_organization_id_fkey
    foreign key (school_id, organization_id)
    references public.schools (id, organization_id)
    on delete cascade,
  constraint staff_school_assignments_status_check
    check (status in ('active', 'inactive')),
  constraint staff_school_assignments_dates_check
    check (
      start_date is null
      or end_date is null
      or end_date >= start_date
    )
);

create index if not exists staff_school_assignments_school_teacher_idx
on public.staff_school_assignments (school_id, status, can_teach);

create index if not exists staff_school_assignments_staff_id_idx
on public.staff_school_assignments (staff_id);

drop trigger if exists staff_set_updated_at on public.staff;
create trigger staff_set_updated_at
before update on public.staff
for each row execute function public.set_updated_at();

drop trigger if exists staff_school_assignments_set_updated_at on public.staff_school_assignments;
create trigger staff_school_assignments_set_updated_at
before update on public.staff_school_assignments
for each row execute function public.set_updated_at();

create or replace function public.can_manage_staff_org(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_super_admin()
    or public.has_org_role(p_organization_id, array['franchise_owner', 'office_staff']::public.membership_role[])
    or exists (
      select 1
      from public.schools s
      join public.school_memberships sm on sm.school_id = s.id
      where s.organization_id = p_organization_id
        and sm.profile_id = (select auth.uid())
        and sm.role in ('school_manager', 'office_staff')
    );
$$;

revoke all on function public.can_manage_staff_org(uuid) from public, anon;
grant execute on function public.can_manage_staff_org(uuid) to authenticated;

create or replace function public.can_manage_staff_member(p_staff_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.staff st
    where st.id = p_staff_id
      and (
        public.can_manage_staff_org(st.organization_id)
        or exists (
          select 1
          from public.staff_school_assignments ssa
          where ssa.staff_id = st.id
            and public.can_manage_school(ssa.school_id)
        )
      )
  );
$$;

revoke all on function public.can_manage_staff_member(uuid) from public, anon;
grant execute on function public.can_manage_staff_member(uuid) to authenticated;

create or replace function public.profile_belongs_to_staff_org(
  p_organization_id uuid,
  p_profile_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_profile_id is null
    or exists (
      select 1
      from public.profiles p
      where p.id = p_profile_id
        and (
          exists (
            select 1
            from public.organization_memberships om
            where om.profile_id = p.id
              and om.organization_id = p_organization_id
          )
          or exists (
            select 1
            from public.school_memberships sm
            join public.schools s on s.id = sm.school_id
            where sm.profile_id = p.id
              and s.organization_id = p_organization_id
          )
        )
    );
$$;

revoke all on function public.profile_belongs_to_staff_org(uuid, uuid) from public, anon;
grant execute on function public.profile_belongs_to_staff_org(uuid, uuid) to authenticated;

create or replace function public.has_active_staff_teacher_assignment(
  p_school_id uuid,
  p_profile_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.staff_school_assignments ssa
    join public.staff st
      on st.id = ssa.staff_id
      and st.organization_id = ssa.organization_id
    join public.profiles p on p.id = st.profile_id
    join public.schools s on s.id = ssa.school_id
    join public.school_memberships sm
      on sm.school_id = ssa.school_id
      and sm.profile_id = st.profile_id
    where ssa.school_id = p_school_id
      and st.profile_id = p_profile_id
      and s.status = 'active'
      and p.status = 'active'
      and st.status = 'active'
      and ssa.status = 'active'
      and ssa.can_teach = true
      and (ssa.start_date is null or ssa.start_date <= current_date)
      and (ssa.end_date is null or ssa.end_date >= current_date)
  );
$$;

revoke all on function public.has_active_staff_teacher_assignment(uuid, uuid) from public, anon, authenticated;

alter table public.staff enable row level security;
alter table public.staff_school_assignments enable row level security;

revoke all on public.staff from anon, authenticated;
revoke all on public.staff_school_assignments from anon, authenticated;

grant select, insert, update, delete on public.staff to authenticated;
grant select, insert, update, delete on public.staff_school_assignments to authenticated;

grant all on public.staff to service_role;
grant all on public.staff_school_assignments to service_role;

drop policy if exists "staff_select_manageable" on public.staff;
create policy "staff_select_manageable"
on public.staff
for select
to authenticated
using (public.can_manage_staff_member(id));

drop policy if exists "staff_insert_managers" on public.staff;
create policy "staff_insert_managers"
on public.staff
for insert
to authenticated
with check (public.can_manage_staff_org(organization_id));

drop policy if exists "staff_update_managers" on public.staff;
create policy "staff_update_managers"
on public.staff
for update
to authenticated
using (public.can_manage_staff_member(id))
with check (public.can_manage_staff_org(organization_id));

drop policy if exists "staff_delete_super_admin" on public.staff;
create policy "staff_delete_super_admin"
on public.staff
for delete
to authenticated
using (public.is_super_admin());

drop policy if exists "staff_school_assignments_select_manageable" on public.staff_school_assignments;
create policy "staff_school_assignments_select_manageable"
on public.staff_school_assignments
for select
to authenticated
using (
  public.can_manage_staff_org(organization_id)
  or public.can_manage_school(school_id)
);

drop policy if exists "staff_school_assignments_insert_managers" on public.staff_school_assignments;
create policy "staff_school_assignments_insert_managers"
on public.staff_school_assignments
for insert
to authenticated
with check (
  public.can_manage_staff_org(organization_id)
  and public.can_manage_school(school_id)
);

drop policy if exists "staff_school_assignments_update_managers" on public.staff_school_assignments;
create policy "staff_school_assignments_update_managers"
on public.staff_school_assignments
for update
to authenticated
using (
  public.can_manage_staff_org(organization_id)
  and public.can_manage_school(school_id)
)
with check (
  public.can_manage_staff_org(organization_id)
  and public.can_manage_school(school_id)
);

drop policy if exists "staff_school_assignments_delete_managers" on public.staff_school_assignments;
create policy "staff_school_assignments_delete_managers"
on public.staff_school_assignments
for delete
to authenticated
using (
  public.can_manage_staff_org(organization_id)
  and public.can_manage_school(school_id)
);

create or replace function public.create_staff_member_mvp(
  p_organization_id uuid,
  p_profile_id uuid default null,
  p_legal_name text default null,
  p_display_name text default null,
  p_address text default null,
  p_phone text default null,
  p_email citext default null,
  p_employment_type text default 'employee',
  p_employment_start_date date default null,
  p_employment_end_date date default null,
  p_status text default 'active',
  p_notes text default null,
  p_assignments jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_assignment jsonb;
  v_assignment_status text;
  v_can_teach boolean;
  v_end_date date;
  v_organization_id uuid;
  v_school_id uuid;
  v_staff_id uuid;
  v_start_date date;
begin
  if nullif(trim(coalesce(p_legal_name, '')), '') is null then
    raise exception 'Legal name is required.';
  end if;

  select o.id into v_organization_id
  from public.organizations o
  where o.id = p_organization_id;

  if v_organization_id is null then
    raise exception 'Organization % was not found.', p_organization_id;
  end if;

  if not public.can_manage_staff_org(p_organization_id) then
    raise exception 'You do not have permission to create staff for this organization.';
  end if;

  if not public.profile_belongs_to_staff_org(p_organization_id, p_profile_id) then
    raise exception 'Linked profile must belong to the same organization.';
  end if;

  if coalesce(p_employment_type, 'employee') not in ('employee', 'contractor', 'part_time', 'temporary', 'other') then
    raise exception 'Unsupported employment type %. Use employee, contractor, part_time, temporary, or other.', p_employment_type;
  end if;

  if coalesce(p_status, 'active') not in ('active', 'inactive', 'on_leave', 'ended') then
    raise exception 'Unsupported staff status %. Use active, inactive, on_leave, or ended.', p_status;
  end if;

  if p_employment_start_date is not null
    and p_employment_end_date is not null
    and p_employment_end_date < p_employment_start_date
  then
    raise exception 'Employment end date cannot be before the start date.';
  end if;

  if jsonb_typeof(coalesce(p_assignments, '[]'::jsonb)) <> 'array' then
    raise exception 'School assignments must be submitted as a JSON array.';
  end if;

  insert into public.staff (
    organization_id,
    profile_id,
    legal_name,
    display_name,
    address,
    phone,
    email,
    employment_type,
    employment_start_date,
    employment_end_date,
    status,
    notes
  )
  values (
    p_organization_id,
    p_profile_id,
    trim(p_legal_name),
    nullif(trim(coalesce(p_display_name, '')), ''),
    nullif(trim(coalesce(p_address, '')), ''),
    nullif(trim(coalesce(p_phone, '')), ''),
    nullif(trim(coalesce(p_email::text, '')), '')::citext,
    coalesce(p_employment_type, 'employee'),
    p_employment_start_date,
    p_employment_end_date,
    coalesce(p_status, 'active'),
    nullif(trim(coalesce(p_notes, '')), '')
  )
  returning id into v_staff_id;

  for v_assignment in
    select value
    from jsonb_array_elements(coalesce(p_assignments, '[]'::jsonb)) as assignment_row(value)
  loop
    if jsonb_typeof(v_assignment) <> 'object' then
      raise exception 'Each school assignment must be an object.';
    end if;

    v_school_id = nullif(trim(coalesce(v_assignment ->> 'school_id', '')), '')::uuid;
    if v_school_id is null then
      raise exception 'School assignment school_id is required.';
    end if;

    if not exists (
      select 1
      from public.schools s
      where s.id = v_school_id
        and s.organization_id = p_organization_id
    ) then
      raise exception 'School % does not belong to this staff organization.', v_school_id;
    end if;

    if not public.can_manage_school(v_school_id) then
      raise exception 'You do not have permission to manage staff assignments for school %.', v_school_id;
    end if;

    v_assignment_status = coalesce(nullif(trim(coalesce(v_assignment ->> 'status', '')), ''), 'active');
    if v_assignment_status not in ('active', 'inactive') then
      raise exception 'Unsupported assignment status %. Use active or inactive.', v_assignment_status;
    end if;

    v_can_teach = coalesce((v_assignment ->> 'can_teach')::boolean, false);
    v_start_date = nullif(trim(coalesce(v_assignment ->> 'start_date', '')), '')::date;
    v_end_date = nullif(trim(coalesce(v_assignment ->> 'end_date', '')), '')::date;

    if v_start_date is not null and v_end_date is not null and v_end_date < v_start_date then
      raise exception 'Assignment end date cannot be before the start date.';
    end if;

    insert into public.staff_school_assignments (
      organization_id,
      staff_id,
      school_id,
      can_teach,
      status,
      start_date,
      end_date
    )
    values (
      p_organization_id,
      v_staff_id,
      v_school_id,
      v_can_teach,
      v_assignment_status,
      v_start_date,
      v_end_date
    );
  end loop;

  return v_staff_id;
end;
$$;

revoke all on function public.create_staff_member_mvp(
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  citext,
  text,
  date,
  date,
  text,
  text,
  jsonb
) from public, anon;

grant execute on function public.create_staff_member_mvp(
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  citext,
  text,
  date,
  date,
  text,
  text,
  jsonb
) to authenticated;

create or replace function public.update_staff_member_mvp(
  p_staff_id uuid,
  p_profile_id uuid default null,
  p_legal_name text default null,
  p_display_name text default null,
  p_address text default null,
  p_phone text default null,
  p_email citext default null,
  p_employment_type text default 'employee',
  p_employment_start_date date default null,
  p_employment_end_date date default null,
  p_status text default 'active',
  p_notes text default null,
  p_assignments jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_assignment jsonb;
  v_assignment_status text;
  v_can_teach boolean;
  v_end_date date;
  v_school_id uuid;
  v_staff public.staff%rowtype;
  v_start_date date;
begin
  select * into v_staff
  from public.staff st
  where st.id = p_staff_id
  for update;

  if not found then
    raise exception 'Staff member % was not found.', p_staff_id;
  end if;

  if not public.can_manage_staff_member(p_staff_id) then
    raise exception 'You do not have permission to edit this staff member.';
  end if;

  if nullif(trim(coalesce(p_legal_name, '')), '') is null then
    raise exception 'Legal name is required.';
  end if;

  if not public.profile_belongs_to_staff_org(v_staff.organization_id, p_profile_id) then
    raise exception 'Linked profile must belong to the same organization.';
  end if;

  if coalesce(p_employment_type, 'employee') not in ('employee', 'contractor', 'part_time', 'temporary', 'other') then
    raise exception 'Unsupported employment type %. Use employee, contractor, part_time, temporary, or other.', p_employment_type;
  end if;

  if coalesce(p_status, 'active') not in ('active', 'inactive', 'on_leave', 'ended') then
    raise exception 'Unsupported staff status %. Use active, inactive, on_leave, or ended.', p_status;
  end if;

  if p_employment_start_date is not null
    and p_employment_end_date is not null
    and p_employment_end_date < p_employment_start_date
  then
    raise exception 'Employment end date cannot be before the start date.';
  end if;

  if jsonb_typeof(coalesce(p_assignments, '[]'::jsonb)) <> 'array' then
    raise exception 'School assignments must be submitted as a JSON array.';
  end if;

  for v_assignment in
    select value
    from jsonb_array_elements(coalesce(p_assignments, '[]'::jsonb)) as assignment_row(value)
  loop
    if jsonb_typeof(v_assignment) <> 'object' then
      raise exception 'Each school assignment must be an object.';
    end if;

    v_school_id = nullif(trim(coalesce(v_assignment ->> 'school_id', '')), '')::uuid;
    if v_school_id is null then
      raise exception 'School assignment school_id is required.';
    end if;

    if not exists (
      select 1
      from public.schools s
      where s.id = v_school_id
        and s.organization_id = v_staff.organization_id
    ) then
      raise exception 'School % does not belong to this staff organization.', v_school_id;
    end if;

    if not public.can_manage_school(v_school_id) then
      raise exception 'You do not have permission to manage staff assignments for school %.', v_school_id;
    end if;

    v_assignment_status = coalesce(nullif(trim(coalesce(v_assignment ->> 'status', '')), ''), 'active');
    if v_assignment_status not in ('active', 'inactive') then
      raise exception 'Unsupported assignment status %. Use active or inactive.', v_assignment_status;
    end if;

    v_start_date = nullif(trim(coalesce(v_assignment ->> 'start_date', '')), '')::date;
    v_end_date = nullif(trim(coalesce(v_assignment ->> 'end_date', '')), '')::date;

    if v_start_date is not null and v_end_date is not null and v_end_date < v_start_date then
      raise exception 'Assignment end date cannot be before the start date.';
    end if;
  end loop;

  update public.staff
  set profile_id = p_profile_id,
      legal_name = trim(p_legal_name),
      display_name = nullif(trim(coalesce(p_display_name, '')), ''),
      address = nullif(trim(coalesce(p_address, '')), ''),
      phone = nullif(trim(coalesce(p_phone, '')), ''),
      email = nullif(trim(coalesce(p_email::text, '')), '')::citext,
      employment_type = coalesce(p_employment_type, 'employee'),
      employment_start_date = p_employment_start_date,
      employment_end_date = p_employment_end_date,
      status = coalesce(p_status, 'active'),
      notes = nullif(trim(coalesce(p_notes, '')), '')
  where id = p_staff_id;

  delete from public.staff_school_assignments ssa
  where ssa.staff_id = p_staff_id
    and public.can_manage_school(ssa.school_id);

  for v_assignment in
    select value
    from jsonb_array_elements(coalesce(p_assignments, '[]'::jsonb)) as assignment_row(value)
  loop
    v_school_id = nullif(trim(coalesce(v_assignment ->> 'school_id', '')), '')::uuid;
    v_assignment_status = coalesce(nullif(trim(coalesce(v_assignment ->> 'status', '')), ''), 'active');
    v_can_teach = coalesce((v_assignment ->> 'can_teach')::boolean, false);
    v_start_date = nullif(trim(coalesce(v_assignment ->> 'start_date', '')), '')::date;
    v_end_date = nullif(trim(coalesce(v_assignment ->> 'end_date', '')), '')::date;

    insert into public.staff_school_assignments (
      organization_id,
      staff_id,
      school_id,
      can_teach,
      status,
      start_date,
      end_date
    )
    values (
      v_staff.organization_id,
      p_staff_id,
      v_school_id,
      v_can_teach,
      v_assignment_status,
      v_start_date,
      v_end_date
    );
  end loop;

  return p_staff_id;
end;
$$;

revoke all on function public.update_staff_member_mvp(
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  citext,
  text,
  date,
  date,
  text,
  text,
  jsonb
) from public, anon;

grant execute on function public.update_staff_member_mvp(
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  citext,
  text,
  date,
  date,
  text,
  text,
  jsonb
) to authenticated;

create or replace function public.school_teacher_options(p_school_id uuid)
returns table (
  profile_id uuid,
  full_name text,
  email citext
)
language sql
stable
security definer
set search_path = public
as $$
  select teacher_options.profile_id,
         teacher_options.full_name,
         teacher_options.email
  from (
    select distinct on (p.id)
           p.id as profile_id,
           coalesce(nullif(trim(st.display_name), ''), nullif(trim(st.legal_name), ''), p.full_name, p.email::text) as full_name,
           coalesce(st.email, p.email) as email
    from public.staff_school_assignments ssa
    join public.staff st
      on st.id = ssa.staff_id
      and st.organization_id = ssa.organization_id
    join public.profiles p on p.id = st.profile_id
    join public.schools s on s.id = ssa.school_id
    join public.school_memberships sm
      on sm.school_id = ssa.school_id
      and sm.profile_id = st.profile_id
    where ssa.school_id = p_school_id
      and public.can_manage_school(p_school_id)
      and s.status = 'active'
      and p.status = 'active'
      and st.status = 'active'
      and ssa.status = 'active'
      and ssa.can_teach = true
      and (ssa.start_date is null or ssa.start_date <= current_date)
      and (ssa.end_date is null or ssa.end_date >= current_date)
    order by p.id, st.created_at
  ) teacher_options
  order by teacher_options.full_name nulls last, teacher_options.email nulls last;
$$;

revoke all on function public.school_teacher_options(uuid) from public, anon;
grant execute on function public.school_teacher_options(uuid) to authenticated;

create or replace function public.ensure_class_teacher_membership()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.assigned_teacher_profile_id is null then
    return new;
  end if;

  if not public.has_active_staff_teacher_assignment(new.school_id, new.assigned_teacher_profile_id) then
    raise exception 'Assigned teacher must be active staff assigned to teach at this school.';
  end if;

  return new;
end;
$$;

revoke all on function public.ensure_class_teacher_membership() from public, anon, authenticated;

create or replace function public.ensure_trial_lesson_teacher_membership()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.assigned_teacher_profile_id is null then
    return new;
  end if;

  if not public.has_active_staff_teacher_assignment(new.school_id, new.assigned_teacher_profile_id) then
    raise exception 'Assigned teacher must be active staff assigned to teach at this school.';
  end if;

  return new;
end;
$$;

revoke all on function public.ensure_trial_lesson_teacher_membership() from public, anon, authenticated;

notify pgrst, 'reload schema';
