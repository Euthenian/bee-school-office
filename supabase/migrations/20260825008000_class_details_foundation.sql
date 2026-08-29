do $$
begin
  create type public.class_lesson_type as enum ('group', 'private');
exception
  when duplicate_object then null;
end;
$$;

do $$
begin
  create type public.class_lesson_day as enum (
    'monday',
    'tuesday',
    'wednesday',
    'thursday',
    'friday',
    'saturday',
    'sunday'
  );
exception
  when duplicate_object then null;
end;
$$;

create table if not exists public.class_levels (
  id text primary key,
  label text not null unique,
  sort_order integer not null unique,
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.class_levels (id, label, sort_order)
values
  ('baby', 'Baby', 10),
  ('kindergarten', 'Kindergarten', 20),
  ('elementary', 'Elementary', 30),
  ('junior_high', 'Junior High', 40),
  ('high_school', 'High School', 50),
  ('adult', 'Adult', 60),
  ('eiken_grade_5', 'EIKEN Grade 5', 70),
  ('eiken_grade_4', 'EIKEN Grade 4', 80),
  ('eiken_grade_3', 'EIKEN Grade 3', 90),
  ('eiken_pre_2', 'EIKEN Pre-2', 100),
  ('eiken_grade_2', 'EIKEN Grade 2', 110),
  ('eiken_pre_1', 'EIKEN Pre-1', 120),
  ('eiken_grade_1', 'EIKEN Grade 1', 130)
on conflict (id) do update
set label = excluded.label,
    sort_order = excluded.sort_order,
    status = 'active',
    updated_at = now();

drop trigger if exists class_levels_set_updated_at on public.class_levels;
create trigger class_levels_set_updated_at
before update on public.class_levels
for each row execute function public.set_updated_at();

create table if not exists public.classes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  school_id uuid not null references public.schools (id) on delete restrict,
  assigned_teacher_profile_id uuid references public.profiles (id) on delete restrict,
  lesson_type public.class_lesson_type not null,
  level_id text not null references public.class_levels (id) on delete restrict,
  lesson_day public.class_lesson_day not null,
  lesson_time time not null,
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id, school_id),
  constraint classes_school_id_organization_id_fkey
    foreign key (school_id, organization_id)
    references public.schools (id, organization_id)
    on delete restrict,
  constraint classes_school_teacher_membership_fkey
    foreign key (school_id, assigned_teacher_profile_id)
    references public.school_memberships (school_id, profile_id)
    on delete restrict
);

create index if not exists classes_organization_school_status_idx
on public.classes (organization_id, school_id, status);

create index if not exists classes_teacher_idx
on public.classes (assigned_teacher_profile_id)
where assigned_teacher_profile_id is not null;

create index if not exists classes_schedule_idx
on public.classes (school_id, lesson_day, lesson_time);

drop trigger if exists classes_set_updated_at on public.classes;
create trigger classes_set_updated_at
before update on public.classes
for each row execute function public.set_updated_at();

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

  if not exists (
    select 1
    from public.school_memberships sm
    where sm.school_id = new.school_id
      and sm.profile_id = new.assigned_teacher_profile_id
      and sm.role = 'teacher'
  ) then
    raise exception 'Assigned teacher must have a teacher membership for this school.';
  end if;

  return new;
end;
$$;

revoke all on function public.ensure_class_teacher_membership() from public, anon, authenticated;

drop trigger if exists classes_teacher_membership_check on public.classes;
create trigger classes_teacher_membership_check
before insert or update of school_id, assigned_teacher_profile_id on public.classes
for each row execute function public.ensure_class_teacher_membership();

alter table public.student_enrollments
add column if not exists class_id uuid;

do $$
begin
  alter table public.student_enrollments
  add constraint student_enrollments_class_id_organization_id_school_id_fkey
  foreign key (class_id, organization_id, school_id)
  references public.classes (id, organization_id, school_id)
  on delete restrict;
exception
  when duplicate_object then null;
end;
$$;

create index if not exists student_enrollments_class_id_idx
on public.student_enrollments (class_id)
where class_id is not null;

alter table public.class_levels enable row level security;
alter table public.classes enable row level security;

revoke all on public.class_levels from anon, authenticated;
revoke all on public.classes from anon, authenticated;
grant select on public.class_levels to authenticated;
grant select, insert, update, delete on public.classes to authenticated;
grant all on public.class_levels to service_role;
grant all on public.classes to service_role;

drop policy if exists "class_levels_select_active" on public.class_levels;
create policy "class_levels_select_active"
on public.class_levels
for select
to authenticated
using (status = 'active');

drop policy if exists "classes_select_accessible" on public.classes;
create policy "classes_select_accessible"
on public.classes
for select
to authenticated
using (
  public.can_access_org(organization_id)
  and public.can_access_school(school_id)
);

drop policy if exists "classes_insert_staff" on public.classes;
create policy "classes_insert_staff"
on public.classes
for insert
to authenticated
with check (
  public.can_access_org(organization_id)
  and public.can_manage_school(school_id)
);

drop policy if exists "classes_update_staff" on public.classes;
create policy "classes_update_staff"
on public.classes
for update
to authenticated
using (public.can_manage_school(school_id))
with check (
  public.can_access_org(organization_id)
  and public.can_manage_school(school_id)
);

drop policy if exists "classes_delete_super_admin" on public.classes;
create policy "classes_delete_super_admin"
on public.classes
for delete
to authenticated
using (public.is_super_admin());

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
  select p.id, p.full_name, p.email
  from public.school_memberships sm
  join public.profiles p on p.id = sm.profile_id
  where sm.school_id = p_school_id
    and sm.role = 'teacher'
    and p.status = 'active'
    and public.can_manage_school(p_school_id)
  order by p.full_name nulls last, p.email nulls last;
$$;

revoke all on function public.school_teacher_options(uuid) from public, anon;
grant execute on function public.school_teacher_options(uuid) to authenticated;

drop function if exists public.create_student_mvp(
  uuid,
  text,
  text,
  text,
  public.student_status,
  date,
  date,
  jsonb,
  text,
  text,
  citext,
  text,
  text,
  text,
  text
);

create or replace function public.create_student_mvp(
  p_school_id uuid,
  p_first_name text,
  p_last_name text,
  p_preferred_name text default null,
  p_status public.student_status default 'active',
  p_start_date date default null,
  p_date_of_birth date default null,
  p_contacts jsonb default '[]'::jsonb,
  p_assigned_teacher_profile_id uuid default null,
  p_lesson_type public.class_lesson_type default null,
  p_class_level_id text default null,
  p_lesson_day public.class_lesson_day default null,
  p_lesson_time time default null,
  p_guardian_full_name text default null,
  p_guardian_relationship text default null,
  p_guardian_email citext default null,
  p_guardian_phone text default null,
  p_internal_note text default null
)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_class_id uuid;
  v_contact jsonb;
  v_contact_type public.contact_type;
  v_contact_type_text text;
  v_email_count integer := 0;
  v_email_primary_used boolean := false;
  v_enrollment_status public.enrollment_status;
  v_has_class_details boolean;
  v_is_primary boolean;
  v_label text;
  v_level_label text;
  v_organization_id uuid;
  v_phone_count integer := 0;
  v_phone_primary_used boolean := false;
  v_student_id uuid;
  v_value text;
begin
  if nullif(trim(p_first_name), '') is null then
    raise exception 'First name is required.';
  end if;

  if nullif(trim(p_last_name), '') is null then
    raise exception 'Last name is required.';
  end if;

  if jsonb_typeof(coalesce(p_contacts, '[]'::jsonb)) <> 'array' then
    raise exception 'Contacts must be submitted as a JSON array.';
  end if;

  select s.organization_id into v_organization_id
  from public.schools s
  where s.id = p_school_id;

  if v_organization_id is null then
    raise exception 'School % was not found or is not accessible.', p_school_id;
  end if;

  if nullif(trim(coalesce(p_guardian_email::text, '')), '') is not null
    or nullif(trim(coalesce(p_guardian_phone, '')), '') is not null
    or nullif(trim(coalesce(p_guardian_relationship, '')), '') is not null
  then
    if nullif(trim(coalesce(p_guardian_full_name, '')), '') is null then
      raise exception 'Guardian name is required when guardian details are provided.';
    end if;
  end if;

  v_has_class_details =
    p_assigned_teacher_profile_id is not null
    or p_lesson_type is not null
    or nullif(trim(coalesce(p_class_level_id, '')), '') is not null
    or p_lesson_day is not null
    or p_lesson_time is not null;

  if v_has_class_details then
    if p_lesson_type is null
      or nullif(trim(coalesce(p_class_level_id, '')), '') is null
      or p_lesson_day is null
      or p_lesson_time is null
    then
      raise exception 'Lesson type, level, lesson day, and lesson time are required for class details.';
    end if;

    select cl.label into v_level_label
    from public.class_levels cl
    where cl.id = p_class_level_id
      and cl.status = 'active';

    if v_level_label is null then
      raise exception 'Class level % was not found or is not active.', p_class_level_id;
    end if;
  end if;

  insert into public.students (
    organization_id,
    school_id,
    first_name,
    last_name,
    preferred_name,
    status,
    start_date,
    date_of_birth
  )
  values (
    v_organization_id,
    p_school_id,
    trim(p_first_name),
    trim(p_last_name),
    nullif(trim(coalesce(p_preferred_name, '')), ''),
    p_status,
    p_start_date,
    p_date_of_birth
  )
  returning id into v_student_id;

  if v_has_class_details then
    insert into public.classes (
      organization_id,
      school_id,
      assigned_teacher_profile_id,
      lesson_type,
      level_id,
      lesson_day,
      lesson_time
    )
    values (
      v_organization_id,
      p_school_id,
      p_assigned_teacher_profile_id,
      p_lesson_type,
      p_class_level_id,
      p_lesson_day,
      p_lesson_time
    )
    returning id into v_class_id;

    v_enrollment_status = case
      when p_status in ('active', 'pending', 'paused', 'withdrawn') then p_status::text::public.enrollment_status
      else 'active'::public.enrollment_status
    end;

    insert into public.student_enrollments (
      organization_id,
      school_id,
      student_id,
      class_id,
      status,
      level,
      start_date
    )
    values (
      v_organization_id,
      p_school_id,
      v_student_id,
      v_class_id,
      v_enrollment_status,
      v_level_label,
      p_start_date
    );
  end if;

  for v_contact in
    select value
    from jsonb_array_elements(coalesce(p_contacts, '[]'::jsonb)) as contact_row(value)
  loop
    if jsonb_typeof(v_contact) <> 'object' then
      raise exception 'Each contact must be an object.';
    end if;

    v_value = nullif(trim(coalesce(v_contact ->> 'value', '')), '');
    continue when v_value is null;

    v_contact_type_text = lower(nullif(trim(coalesce(v_contact ->> 'contact_type', '')), ''));
    if v_contact_type_text not in ('email', 'phone') then
      raise exception 'Unsupported contact type %. Use email or phone.', v_contact_type_text;
    end if;

    v_contact_type = v_contact_type_text::public.contact_type;
    v_label = coalesce(nullif(trim(coalesce(v_contact ->> 'label', '')), ''), 'Other');
    v_is_primary = coalesce((v_contact ->> 'is_primary')::boolean, false);

    if v_contact_type = 'email' then
      v_email_count = v_email_count + 1;
      if v_is_primary and not v_email_primary_used then
        v_email_primary_used = true;
      else
        v_is_primary = false;
      end if;
    else
      v_phone_count = v_phone_count + 1;
      if v_is_primary and not v_phone_primary_used then
        v_phone_primary_used = true;
      else
        v_is_primary = false;
      end if;
    end if;

    insert into public.student_contacts (student_id, contact_type, label, value, is_primary)
    values (v_student_id, v_contact_type, v_label, v_value, v_is_primary);
  end loop;

  if v_email_count > 0 and not v_email_primary_used then
    update public.student_contacts sc
    set is_primary = true
    where sc.id = (
      select first_email.id
      from public.student_contacts first_email
      where first_email.student_id = v_student_id
        and first_email.contact_type = 'email'
      order by first_email.created_at, first_email.id
      limit 1
    );
  end if;

  if v_phone_count > 0 and not v_phone_primary_used then
    update public.student_contacts sc
    set is_primary = true
    where sc.id = (
      select first_phone.id
      from public.student_contacts first_phone
      where first_phone.student_id = v_student_id
        and first_phone.contact_type = 'phone'
      order by first_phone.created_at, first_phone.id
      limit 1
    );
  end if;

  if nullif(trim(coalesce(p_guardian_full_name, '')), '') is not null then
    insert into public.student_guardians (
      student_id,
      full_name,
      relationship,
      email,
      phone
    )
    values (
      v_student_id,
      trim(p_guardian_full_name),
      nullif(trim(coalesce(p_guardian_relationship, '')), ''),
      nullif(trim(coalesce(p_guardian_email::text, '')), '')::citext,
      nullif(trim(coalesce(p_guardian_phone, '')), '')
    );
  end if;

  if nullif(trim(coalesce(p_internal_note, '')), '') is not null then
    insert into public.student_notes (
      organization_id,
      school_id,
      student_id,
      author_profile_id,
      visibility,
      note
    )
    values (
      v_organization_id,
      p_school_id,
      v_student_id,
      (select auth.uid()),
      'admin',
      trim(p_internal_note)
    );
  end if;

  return v_student_id;
end;
$$;

revoke all on function public.create_student_mvp(
  uuid,
  text,
  text,
  text,
  public.student_status,
  date,
  date,
  jsonb,
  uuid,
  public.class_lesson_type,
  text,
  public.class_lesson_day,
  time,
  text,
  text,
  citext,
  text,
  text
) from public, anon;

grant execute on function public.create_student_mvp(
  uuid,
  text,
  text,
  text,
  public.student_status,
  date,
  date,
  jsonb,
  uuid,
  public.class_lesson_type,
  text,
  public.class_lesson_day,
  time,
  text,
  text,
  citext,
  text,
  text
) to authenticated;
