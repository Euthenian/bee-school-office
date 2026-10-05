-- Local wall-clock capacity belongs to a school, whose timezone is stored on schools.
-- Weekday is ISO-style: 0 = Monday through 6 = Sunday. Intervals are [start, end).
create table public.staff_availability_windows (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  staff_id uuid not null,
  school_id uuid not null,
  weekday smallint not null check (weekday between 0 and 6),
  start_time time not null,
  end_time time not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint staff_availability_time_check check (end_time > start_time),
  constraint staff_availability_staff_fkey foreign key (staff_id, organization_id)
    references public.staff (id, organization_id) on delete cascade,
  constraint staff_availability_school_fkey foreign key (school_id, organization_id)
    references public.schools (id, organization_id) on delete cascade
);

create index staff_availability_staff_school_idx
  on public.staff_availability_windows (staff_id, school_id, weekday, start_time) where active;

-- Serialize changes for one staff/school/day before testing overlaps, including
-- concurrent inserts that cannot see each other's uncommitted rows.
create function public.check_staff_availability_overlap()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not new.active then return new; end if;
  perform pg_advisory_xact_lock(hashtext(new.staff_id::text), hashtext(new.school_id::text || ':' || new.weekday::text));
  if exists (
    select 1 from public.staff_availability_windows existing
    where existing.staff_id = new.staff_id and existing.school_id = new.school_id
      and existing.weekday = new.weekday and existing.active
      and existing.id <> new.id
      and existing.start_time < new.end_time and new.start_time < existing.end_time
  ) then
    raise exception 'Availability windows for this staff member overlap.';
  end if;
  return new;
end;
$$;

create trigger staff_availability_overlap_check
before insert or update of staff_id, school_id, weekday, start_time, end_time, active
on public.staff_availability_windows for each row
execute function public.check_staff_availability_overlap();

-- The existing staff edit RPC replaces school-assignment rows. Do not cascade
-- capacity away during that ordinary edit; require an assignment on new writes.
create function public.ensure_staff_capacity_assignment()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.active and not exists (
    select 1 from public.staff_school_assignments ssa
    where ssa.staff_id = new.staff_id and ssa.school_id = new.school_id
      and ssa.organization_id = new.organization_id and ssa.status = 'active'
  ) then
    raise exception 'Staff member needs an active assignment to this school.';
  end if;
  return new;
end;
$$;

create trigger staff_availability_assignment_check
before insert or update of staff_id, school_id, organization_id, active
on public.staff_availability_windows for each row
execute function public.ensure_staff_capacity_assignment();

create table public.staff_availability_blocks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  staff_id uuid not null,
  school_id uuid not null,
  local_date date not null,
  start_time time not null,
  end_time time not null,
  reason text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint staff_availability_block_time_check check (end_time > start_time),
  constraint staff_availability_block_staff_fkey foreign key (staff_id, organization_id)
    references public.staff (id, organization_id) on delete cascade,
  constraint staff_availability_block_school_fkey foreign key (school_id, organization_id)
    references public.schools (id, organization_id) on delete cascade
);

create index staff_availability_blocks_staff_date_idx
  on public.staff_availability_blocks (staff_id, school_id, local_date) where active;

create trigger staff_block_assignment_check
before insert or update of staff_id, school_id, organization_id, active
on public.staff_availability_blocks for each row
execute function public.ensure_staff_capacity_assignment();

create table public.coaching_programs (
  id text primary key,
  label text not null,
  sort_order integer not null,
  active boolean not null default true
);

insert into public.coaching_programs (id, label, sort_order) values
  ('kids', 'Kids', 10), ('eiken', 'EIKEN', 20),
  ('toeic', 'TOEIC', 30), ('icao', 'ICAO', 40);

create table public.staff_coaching_settings (
  staff_id uuid primary key,
  organization_id uuid not null,
  enabled boolean not null default false,
  updated_at timestamptz not null default now(),
  unique (staff_id, organization_id),
  constraint staff_coaching_settings_staff_fkey foreign key (staff_id, organization_id)
    references public.staff (id, organization_id) on delete cascade
);

create table public.staff_coaching_programs (
  staff_id uuid not null,
  organization_id uuid not null,
  program_id text not null references public.coaching_programs (id) on delete restrict,
  primary key (staff_id, program_id),
  constraint staff_coaching_programs_settings_fkey foreign key (staff_id, organization_id)
    references public.staff_coaching_settings (staff_id, organization_id) on delete cascade
);

create trigger staff_availability_windows_set_updated_at before update on public.staff_availability_windows
  for each row execute function public.set_updated_at();
create trigger staff_availability_blocks_set_updated_at before update on public.staff_availability_blocks
  for each row execute function public.set_updated_at();
create trigger staff_coaching_settings_set_updated_at before update on public.staff_coaching_settings
  for each row execute function public.set_updated_at();

alter table public.staff_availability_windows enable row level security;
alter table public.staff_availability_blocks enable row level security;
alter table public.coaching_programs enable row level security;
alter table public.staff_coaching_settings enable row level security;
alter table public.staff_coaching_programs enable row level security;

revoke all on public.staff_availability_windows, public.staff_availability_blocks,
  public.coaching_programs, public.staff_coaching_settings, public.staff_coaching_programs
  from public, anon, authenticated;
grant select, insert, update on public.staff_availability_windows, public.staff_availability_blocks,
  public.staff_coaching_settings to authenticated;
grant select, insert, delete on public.staff_coaching_programs to authenticated;
grant select on public.coaching_programs to authenticated;
grant all on public.staff_availability_windows, public.staff_availability_blocks,
  public.coaching_programs, public.staff_coaching_settings, public.staff_coaching_programs to service_role;
revoke all on function public.check_staff_availability_overlap() from public, anon, authenticated;
revoke all on function public.ensure_staff_capacity_assignment() from public, anon, authenticated;

create policy staff_availability_select on public.staff_availability_windows for select to authenticated
  using (public.can_manage_staff_org(organization_id) and public.can_manage_school(school_id));
create policy staff_availability_insert on public.staff_availability_windows for insert to authenticated
  with check (public.can_manage_staff_org(organization_id) and public.can_manage_school(school_id));
create policy staff_availability_update on public.staff_availability_windows for update to authenticated
  using (public.can_manage_staff_org(organization_id) and public.can_manage_school(school_id))
  with check (public.can_manage_staff_org(organization_id) and public.can_manage_school(school_id));

create policy staff_blocks_select on public.staff_availability_blocks for select to authenticated
  using (public.can_manage_staff_org(organization_id) and public.can_manage_school(school_id));
create policy staff_blocks_insert on public.staff_availability_blocks for insert to authenticated
  with check (public.can_manage_staff_org(organization_id) and public.can_manage_school(school_id));
create policy staff_blocks_update on public.staff_availability_blocks for update to authenticated
  using (public.can_manage_staff_org(organization_id) and public.can_manage_school(school_id))
  with check (public.can_manage_staff_org(organization_id) and public.can_manage_school(school_id));

create policy coaching_programs_select on public.coaching_programs for select to authenticated
  using (public.is_super_admin() or exists (
    select 1 from public.organization_memberships om
    where om.profile_id = (select auth.uid()) and om.role in ('franchise_owner', 'office_staff')
  ) or exists (
    select 1 from public.school_memberships sm
    where sm.profile_id = (select auth.uid()) and sm.role in ('school_manager', 'office_staff')
  ));

create policy coaching_settings_select on public.staff_coaching_settings for select to authenticated
  using (public.can_manage_staff_org(organization_id));
create policy coaching_settings_insert on public.staff_coaching_settings for insert to authenticated
  with check (public.can_manage_staff_org(organization_id));
create policy coaching_settings_update on public.staff_coaching_settings for update to authenticated
  using (public.can_manage_staff_org(organization_id)) with check (public.can_manage_staff_org(organization_id));

create policy coaching_eligibility_select on public.staff_coaching_programs for select to authenticated
  using (public.can_manage_staff_org(organization_id));
create policy coaching_eligibility_insert on public.staff_coaching_programs for insert to authenticated
  with check (public.can_manage_staff_org(organization_id));
create policy coaching_eligibility_delete on public.staff_coaching_programs for delete to authenticated
  using (public.can_manage_staff_org(organization_id));
