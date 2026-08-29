create extension if not exists "pgcrypto";
create extension if not exists "citext";

create type public.organization_type as enum ('hq', 'franchise');
create type public.organization_status as enum ('active', 'inactive');
create type public.school_status as enum ('active', 'inactive');
create type public.profile_status as enum ('active', 'inactive');
create type public.membership_role as enum (
  'super_admin',
  'franchise_owner',
  'school_manager',
  'office_staff',
  'teacher'
);
create type public.student_status as enum (
  'active',
  'pending',
  'paused',
  'withdrawn',
  'graduated',
  'inactive'
);
create type public.enrollment_status as enum (
  'active',
  'pending',
  'paused',
  'completed',
  'withdrawn'
);
create type public.contact_type as enum ('email', 'phone', 'line', 'address', 'other');
create type public.note_visibility as enum ('admin', 'education');

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  type public.organization_type not null default 'franchise',
  status public.organization_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (name)
);

create table public.schools (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  name text not null,
  code text,
  status public.school_status not null default 'active',
  timezone text not null default 'Asia/Tokyo',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, name),
  unique (id, organization_id)
);

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email citext,
  full_name text,
  status public.profile_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.organization_memberships (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  role public.membership_role not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, profile_id)
);

create table public.school_memberships (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  role public.membership_role not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (school_id, profile_id)
);

create table public.courses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  school_id uuid references public.schools (id) on delete cascade,
  name text not null,
  level text,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  foreign key (school_id, organization_id) references public.schools (id, organization_id) on delete cascade
);

create table public.students (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  school_id uuid not null references public.schools (id) on delete restrict,
  first_name text not null,
  last_name text not null,
  preferred_name text,
  status public.student_status not null default 'active',
  date_of_birth date,
  start_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  unique (id, school_id),
  unique (id, organization_id, school_id),
  foreign key (school_id, organization_id) references public.schools (id, organization_id) on delete restrict
);

create table public.student_contacts (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students (id) on delete cascade,
  contact_type public.contact_type not null,
  label text,
  value text not null,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.student_guardians (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students (id) on delete cascade,
  full_name text not null,
  relationship text,
  email citext,
  phone text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.student_enrollments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  school_id uuid not null references public.schools (id) on delete restrict,
  student_id uuid not null references public.students (id) on delete cascade,
  course_id uuid references public.courses (id) on delete set null,
  status public.enrollment_status not null default 'active',
  level text,
  class_name text,
  start_date date,
  end_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (student_id, organization_id, school_id) references public.students (id, organization_id, school_id) on delete cascade
);

create table public.student_notes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  school_id uuid not null references public.schools (id) on delete restrict,
  student_id uuid not null references public.students (id) on delete cascade,
  author_profile_id uuid references public.profiles (id) on delete set null,
  visibility public.note_visibility not null default 'admin',
  note text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (student_id, organization_id, school_id) references public.students (id, organization_id, school_id) on delete cascade
);

create index organizations_type_idx on public.organizations (type);
create index schools_organization_id_idx on public.schools (organization_id);
create index profiles_email_idx on public.profiles (email);
create index organization_memberships_profile_id_idx on public.organization_memberships (profile_id);
create index organization_memberships_organization_id_role_idx on public.organization_memberships (organization_id, role);
create index school_memberships_profile_id_idx on public.school_memberships (profile_id);
create index school_memberships_school_id_role_idx on public.school_memberships (school_id, role);
create index courses_organization_school_idx on public.courses (organization_id, school_id);
create index students_organization_school_status_idx on public.students (organization_id, school_id, status);
create index students_name_idx on public.students (last_name, first_name);
create index student_contacts_student_id_idx on public.student_contacts (student_id);
create index student_guardians_student_id_idx on public.student_guardians (student_id);
create index student_enrollments_student_id_idx on public.student_enrollments (student_id);
create index student_enrollments_school_id_idx on public.student_enrollments (school_id);
create index student_notes_student_id_visibility_idx on public.student_notes (student_id, visibility);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger organizations_set_updated_at
before update on public.organizations
for each row execute function public.set_updated_at();

create trigger schools_set_updated_at
before update on public.schools
for each row execute function public.set_updated_at();

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

create trigger organization_memberships_set_updated_at
before update on public.organization_memberships
for each row execute function public.set_updated_at();

create trigger school_memberships_set_updated_at
before update on public.school_memberships
for each row execute function public.set_updated_at();

create trigger courses_set_updated_at
before update on public.courses
for each row execute function public.set_updated_at();

create trigger students_set_updated_at
before update on public.students
for each row execute function public.set_updated_at();

create trigger student_contacts_set_updated_at
before update on public.student_contacts
for each row execute function public.set_updated_at();

create trigger student_guardians_set_updated_at
before update on public.student_guardians
for each row execute function public.set_updated_at();

create trigger student_enrollments_set_updated_at
before update on public.student_enrollments
for each row execute function public.set_updated_at();

create trigger student_notes_set_updated_at
before update on public.student_notes
for each row execute function public.set_updated_at();

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.email)
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_auth_user();

create or replace function public.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.organization_memberships om
    where om.profile_id = (select auth.uid())
      and om.role = 'super_admin'
  );
$$;

create or replace function public.has_org_role(
  p_organization_id uuid,
  p_roles public.membership_role[]
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.organization_memberships om
    where om.profile_id = (select auth.uid())
      and om.organization_id = p_organization_id
      and om.role = any (p_roles)
  );
$$;

create or replace function public.has_school_role(
  p_school_id uuid,
  p_roles public.membership_role[]
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.school_memberships sm
    where sm.profile_id = (select auth.uid())
      and sm.school_id = p_school_id
      and sm.role = any (p_roles)
  );
$$;

create or replace function public.can_access_org(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_super_admin()
    or exists (
      select 1
      from public.organization_memberships om
      where om.profile_id = (select auth.uid())
        and om.organization_id = p_organization_id
    )
    or exists (
      select 1
      from public.school_memberships sm
      join public.schools s on s.id = sm.school_id
      where sm.profile_id = (select auth.uid())
        and s.organization_id = p_organization_id
    );
$$;

create or replace function public.can_access_school(p_school_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_super_admin()
    or exists (
      select 1
      from public.school_memberships sm
      where sm.profile_id = (select auth.uid())
        and sm.school_id = p_school_id
    )
    or exists (
      select 1
      from public.schools s
      join public.organization_memberships om on om.organization_id = s.organization_id
      where s.id = p_school_id
        and om.profile_id = (select auth.uid())
        and om.role in ('franchise_owner', 'office_staff')
    );
$$;

create or replace function public.can_administer_school(p_school_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_super_admin()
    or exists (
      select 1
      from public.school_memberships sm
      where sm.profile_id = (select auth.uid())
        and sm.school_id = p_school_id
        and sm.role = 'school_manager'
    )
    or exists (
      select 1
      from public.schools s
      join public.organization_memberships om on om.organization_id = s.organization_id
      where s.id = p_school_id
        and om.profile_id = (select auth.uid())
        and om.role = 'franchise_owner'
    );
$$;

create or replace function public.can_manage_school(p_school_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_super_admin()
    or exists (
      select 1
      from public.school_memberships sm
      where sm.profile_id = (select auth.uid())
        and sm.school_id = p_school_id
        and sm.role in ('school_manager', 'office_staff')
    )
    or exists (
      select 1
      from public.schools s
      join public.organization_memberships om on om.organization_id = s.organization_id
      where s.id = p_school_id
        and om.profile_id = (select auth.uid())
        and om.role in ('franchise_owner', 'office_staff')
    );
$$;

create or replace function public.can_view_student(p_student_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_super_admin()
    or exists (
      select 1
      from public.students st
      where st.id = p_student_id
        and (
          public.has_org_role(st.organization_id, array['franchise_owner', 'office_staff']::public.membership_role[])
          or public.has_school_role(st.school_id, array['school_manager', 'office_staff', 'teacher']::public.membership_role[])
        )
    );
$$;

create or replace function public.can_manage_student(p_student_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_super_admin()
    or exists (
      select 1
      from public.students st
      where st.id = p_student_id
        and (
          public.has_org_role(st.organization_id, array['franchise_owner', 'office_staff']::public.membership_role[])
          or public.has_school_role(st.school_id, array['school_manager', 'office_staff']::public.membership_role[])
        )
    );
$$;

create or replace function public.bootstrap_bee_school_hq(
  p_admin_user_id uuid,
  p_admin_email citext,
  p_admin_full_name text default null
)
returns table (
  organization_id uuid,
  school_id uuid,
  profile_id uuid
)
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_organization_id uuid;
  v_school_id uuid;
begin
  if not exists (select 1 from auth.users where id = p_admin_user_id) then
    raise exception 'Auth user % does not exist. Create the Supabase Auth user before bootstrapping.', p_admin_user_id;
  end if;

  select id into v_organization_id
  from public.organizations
  where type = 'hq'
    and name = 'Bee School HQ'
  limit 1;

  if v_organization_id is null then
    insert into public.organizations (name, type, status)
    values ('Bee School HQ', 'hq', 'active')
    returning id into v_organization_id;
  end if;

  select id into v_school_id
  from public.schools
  where organization_id = v_organization_id
    and name = 'Ohashi'
  limit 1;

  if v_school_id is null then
    insert into public.schools (organization_id, name, code, status)
    values (v_organization_id, 'Ohashi', 'OHASHI', 'active')
    returning id into v_school_id;
  end if;

  insert into public.profiles (id, email, full_name, status)
  values (
    p_admin_user_id,
    p_admin_email,
    coalesce(nullif(trim(p_admin_full_name), ''), p_admin_email::text),
    'active'
  )
  on conflict (id) do update
  set email = excluded.email,
      full_name = excluded.full_name,
      status = 'active',
      updated_at = now();

  insert into public.organization_memberships (organization_id, profile_id, role)
  values (v_organization_id, p_admin_user_id, 'super_admin')
  on conflict (organization_id, profile_id) do update
  set role = 'super_admin',
      updated_at = now();

  insert into public.school_memberships (school_id, profile_id, role)
  values (v_school_id, p_admin_user_id, 'school_manager')
  on conflict (school_id, profile_id) do update
  set role = 'school_manager',
      updated_at = now();

  return query select v_organization_id, v_school_id, p_admin_user_id;
end;
$$;

alter table public.organizations enable row level security;
alter table public.schools enable row level security;
alter table public.profiles enable row level security;
alter table public.organization_memberships enable row level security;
alter table public.school_memberships enable row level security;
alter table public.courses enable row level security;
alter table public.students enable row level security;
alter table public.student_contacts enable row level security;
alter table public.student_guardians enable row level security;
alter table public.student_enrollments enable row level security;
alter table public.student_notes enable row level security;

revoke all on all tables in schema public from anon, authenticated;
grant usage on schema public to authenticated;
grant select, insert, update, delete on public.organizations to authenticated;
grant select, insert, update, delete on public.schools to authenticated;
grant select on public.profiles to authenticated;
grant select, insert, update, delete on public.organization_memberships to authenticated;
grant select, insert, update, delete on public.school_memberships to authenticated;
grant select, insert, update, delete on public.courses to authenticated;
grant select, insert, update, delete on public.students to authenticated;
grant select, insert, update, delete on public.student_contacts to authenticated;
grant select, insert, update, delete on public.student_guardians to authenticated;
grant select, insert, update, delete on public.student_enrollments to authenticated;
grant select, insert, update, delete on public.student_notes to authenticated;
grant all on all tables in schema public to service_role;

revoke all on function public.bootstrap_bee_school_hq(uuid, citext, text) from public, anon, authenticated;
grant execute on function public.bootstrap_bee_school_hq(uuid, citext, text) to service_role;

create policy "organizations_select_accessible"
on public.organizations
for select
to authenticated
using (public.can_access_org(id));

create policy "organizations_insert_super_admin"
on public.organizations
for insert
to authenticated
with check (public.is_super_admin());

create policy "organizations_update_super_admin"
on public.organizations
for update
to authenticated
using (public.is_super_admin())
with check (public.is_super_admin());

create policy "organizations_delete_super_admin"
on public.organizations
for delete
to authenticated
using (public.is_super_admin());

create policy "schools_select_accessible"
on public.schools
for select
to authenticated
using (public.can_access_school(id));

create policy "schools_insert_org_admin"
on public.schools
for insert
to authenticated
with check (
  public.is_super_admin()
  or public.has_org_role(organization_id, array['franchise_owner']::public.membership_role[])
);

create policy "schools_update_org_admin"
on public.schools
for update
to authenticated
using (
  public.is_super_admin()
  or public.has_org_role(organization_id, array['franchise_owner']::public.membership_role[])
)
with check (
  public.is_super_admin()
  or public.has_org_role(organization_id, array['franchise_owner']::public.membership_role[])
);

create policy "schools_delete_super_admin"
on public.schools
for delete
to authenticated
using (public.is_super_admin());

create policy "profiles_select_visible_people"
on public.profiles
for select
to authenticated
using (
  id = (select auth.uid())
  or public.is_super_admin()
  or exists (
    select 1
    from public.organization_memberships mine
    join public.organization_memberships theirs on theirs.organization_id = mine.organization_id
    where mine.profile_id = (select auth.uid())
      and theirs.profile_id = profiles.id
      and mine.role in ('franchise_owner', 'office_staff')
  )
  or exists (
    select 1
    from public.school_memberships mine
    join public.school_memberships theirs on theirs.school_id = mine.school_id
    where mine.profile_id = (select auth.uid())
      and theirs.profile_id = profiles.id
      and mine.role in ('school_manager')
  )
);

create policy "organization_memberships_select_visible"
on public.organization_memberships
for select
to authenticated
using (
  profile_id = (select auth.uid())
  or public.is_super_admin()
  or public.has_org_role(organization_id, array['franchise_owner']::public.membership_role[])
);

create policy "organization_memberships_insert_super_admin"
on public.organization_memberships
for insert
to authenticated
with check (public.is_super_admin());

create policy "organization_memberships_update_super_admin"
on public.organization_memberships
for update
to authenticated
using (public.is_super_admin())
with check (public.is_super_admin());

create policy "organization_memberships_delete_super_admin"
on public.organization_memberships
for delete
to authenticated
using (public.is_super_admin());

create policy "school_memberships_select_visible"
on public.school_memberships
for select
to authenticated
using (
  profile_id = (select auth.uid())
  or public.is_super_admin()
  or public.can_administer_school(school_id)
);

create policy "school_memberships_insert_admin"
on public.school_memberships
for insert
to authenticated
with check (public.is_super_admin() or public.can_administer_school(school_id));

create policy "school_memberships_update_admin"
on public.school_memberships
for update
to authenticated
using (public.is_super_admin() or public.can_administer_school(school_id))
with check (public.is_super_admin() or public.can_administer_school(school_id));

create policy "school_memberships_delete_admin"
on public.school_memberships
for delete
to authenticated
using (public.is_super_admin() or public.can_administer_school(school_id));

create policy "courses_select_accessible"
on public.courses
for select
to authenticated
using (
  public.can_access_org(organization_id)
  and (school_id is null or public.can_access_school(school_id))
);

create policy "courses_insert_staff"
on public.courses
for insert
to authenticated
with check (
  public.is_super_admin()
  or public.has_org_role(organization_id, array['franchise_owner', 'office_staff']::public.membership_role[])
  or (school_id is not null and public.can_manage_school(school_id))
);

create policy "courses_update_staff"
on public.courses
for update
to authenticated
using (
  public.is_super_admin()
  or public.has_org_role(organization_id, array['franchise_owner', 'office_staff']::public.membership_role[])
  or (school_id is not null and public.can_manage_school(school_id))
)
with check (
  public.is_super_admin()
  or public.has_org_role(organization_id, array['franchise_owner', 'office_staff']::public.membership_role[])
  or (school_id is not null and public.can_manage_school(school_id))
);

create policy "courses_delete_super_admin"
on public.courses
for delete
to authenticated
using (public.is_super_admin());

create policy "students_select_visible"
on public.students
for select
to authenticated
using (public.can_view_student(id));

create policy "students_insert_staff"
on public.students
for insert
to authenticated
with check (
  public.can_manage_school(school_id)
  and public.can_access_org(organization_id)
);

create policy "students_update_staff"
on public.students
for update
to authenticated
using (public.can_manage_student(id))
with check (
  public.can_manage_school(school_id)
  and public.can_access_org(organization_id)
);

create policy "students_delete_super_admin"
on public.students
for delete
to authenticated
using (public.is_super_admin());

create policy "student_contacts_select_visible"
on public.student_contacts
for select
to authenticated
using (public.can_view_student(student_id));

create policy "student_contacts_insert_staff"
on public.student_contacts
for insert
to authenticated
with check (public.can_manage_student(student_id));

create policy "student_contacts_update_staff"
on public.student_contacts
for update
to authenticated
using (public.can_manage_student(student_id))
with check (public.can_manage_student(student_id));

create policy "student_contacts_delete_staff"
on public.student_contacts
for delete
to authenticated
using (public.can_manage_student(student_id));

create policy "student_guardians_select_visible"
on public.student_guardians
for select
to authenticated
using (public.can_view_student(student_id));

create policy "student_guardians_insert_staff"
on public.student_guardians
for insert
to authenticated
with check (public.can_manage_student(student_id));

create policy "student_guardians_update_staff"
on public.student_guardians
for update
to authenticated
using (public.can_manage_student(student_id))
with check (public.can_manage_student(student_id));

create policy "student_guardians_delete_staff"
on public.student_guardians
for delete
to authenticated
using (public.can_manage_student(student_id));

create policy "student_enrollments_select_visible"
on public.student_enrollments
for select
to authenticated
using (public.can_view_student(student_id));

create policy "student_enrollments_insert_staff"
on public.student_enrollments
for insert
to authenticated
with check (
  public.can_manage_student(student_id)
  and public.can_manage_school(school_id)
);

create policy "student_enrollments_update_staff"
on public.student_enrollments
for update
to authenticated
using (public.can_manage_student(student_id))
with check (
  public.can_manage_student(student_id)
  and public.can_manage_school(school_id)
);

create policy "student_enrollments_delete_staff"
on public.student_enrollments
for delete
to authenticated
using (public.can_manage_student(student_id));

create policy "student_notes_select_visible"
on public.student_notes
for select
to authenticated
using (
  (visibility = 'education' and public.can_view_student(student_id))
  or (visibility = 'admin' and public.can_manage_student(student_id))
);

create policy "student_notes_insert_visible_scope"
on public.student_notes
for insert
to authenticated
with check (
  author_profile_id = (select auth.uid())
  and (
    public.can_manage_student(student_id)
    or (visibility = 'education' and public.can_view_student(student_id))
  )
);

create policy "student_notes_update_author_or_staff"
on public.student_notes
for update
to authenticated
using (
  public.can_manage_student(student_id)
  or (author_profile_id = (select auth.uid()) and visibility = 'education')
)
with check (
  public.can_manage_student(student_id)
  or (author_profile_id = (select auth.uid()) and visibility = 'education')
);

create policy "student_notes_delete_staff"
on public.student_notes
for delete
to authenticated
using (public.can_manage_student(student_id));
