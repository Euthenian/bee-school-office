do $$
begin
  create type public.trial_package_status as enum (
    'active',
    'completed',
    'converted',
    'cancelled'
  );
exception
  when duplicate_object then null;
end;
$$;

do $$
begin
  create type public.trial_package_lesson_status as enum (
    'not_scheduled',
    'scheduled',
    'completed',
    'cancelled',
    'no_show'
  );
exception
  when duplicate_object then null;
end;
$$;

create table if not exists public.trial_packages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  school_id uuid not null references public.schools (id) on delete restrict,
  prospect_id uuid not null references public.prospects (id) on delete cascade,
  converted_student_id uuid,
  package_type text not null default 'group_english',
  lesson_type public.class_lesson_type not null default 'group',
  level_id text references public.class_levels (id) on delete restrict,
  total_lessons smallint not null default 4 check (total_lessons between 1 and 24),
  status public.trial_package_status not null default 'active',
  customer_request text,
  internal_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id, school_id),
  constraint trial_packages_school_id_organization_id_fkey
    foreign key (school_id, organization_id)
    references public.schools (id, organization_id)
    on delete restrict,
  constraint trial_packages_prospect_id_organization_id_school_id_fkey
    foreign key (prospect_id, organization_id, school_id)
    references public.prospects (id, organization_id, school_id)
    on delete cascade,
  constraint trial_packages_converted_student_id_organization_id_school_id_fkey
    foreign key (converted_student_id, organization_id, school_id)
    references public.students (id, organization_id, school_id)
    on delete restrict
);

create table if not exists public.trial_package_lessons (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  school_id uuid not null,
  trial_package_id uuid not null references public.trial_packages (id) on delete cascade,
  lesson_number smallint not null check (lesson_number between 1 and 24),
  lesson_date date,
  lesson_time time,
  assigned_teacher_staff_id uuid,
  status public.trial_package_lesson_status not null default 'not_scheduled',
  completed_at timestamptz,
  cancelled_at timestamptz,
  no_show_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (trial_package_id, lesson_number),
  unique (id, organization_id, school_id),
  constraint trial_package_lessons_package_id_organization_id_school_id_fkey
    foreign key (trial_package_id, organization_id, school_id)
    references public.trial_packages (id, organization_id, school_id)
    on delete cascade,
  constraint trial_package_lessons_teacher_staff_id_organization_id_fkey
    foreign key (assigned_teacher_staff_id, organization_id)
    references public.staff (id, organization_id)
    on delete restrict,
  constraint trial_package_lessons_schedule_check
    check (
      status <> 'scheduled'
      or (lesson_date is not null and lesson_time is not null)
    )
);

create index if not exists trial_packages_school_status_idx
on public.trial_packages (school_id, status, created_at desc);

create index if not exists trial_packages_prospect_id_idx
on public.trial_packages (prospect_id);

create index if not exists trial_package_lessons_package_idx
on public.trial_package_lessons (trial_package_id, lesson_number);

create index if not exists trial_package_lessons_schedule_idx
on public.trial_package_lessons (school_id, lesson_date, lesson_time)
where lesson_date is not null;

create index if not exists trial_package_lessons_teacher_staff_idx
on public.trial_package_lessons (assigned_teacher_staff_id)
where assigned_teacher_staff_id is not null;

drop trigger if exists trial_packages_set_updated_at on public.trial_packages;
create trigger trial_packages_set_updated_at
before update on public.trial_packages
for each row execute function public.set_updated_at();

drop trigger if exists trial_package_lessons_set_updated_at on public.trial_package_lessons;
create trigger trial_package_lessons_set_updated_at
before update on public.trial_package_lessons
for each row execute function public.set_updated_at();

create or replace function public.can_manage_trial_package(p_trial_package_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.trial_packages tp
    where tp.id = p_trial_package_id
      and public.can_manage_school(tp.school_id)
  );
$$;

create or replace function public.can_view_trial_package(p_trial_package_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.trial_packages tp
    where tp.id = p_trial_package_id
      and (
        public.can_manage_school(tp.school_id)
        or exists (
          select 1
          from public.trial_package_lessons tpl
          join public.staff st
            on st.id = tpl.assigned_teacher_staff_id
            and st.organization_id = tpl.organization_id
          where tpl.trial_package_id = tp.id
            and st.profile_id = (select auth.uid())
        )
      )
  );
$$;

revoke all on function public.can_manage_trial_package(uuid) from public, anon;
revoke all on function public.can_view_trial_package(uuid) from public, anon;
grant execute on function public.can_manage_trial_package(uuid) to authenticated;
grant execute on function public.can_view_trial_package(uuid) to authenticated;

create or replace function public.can_view_prospect(p_prospect_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.prospects pr
    where pr.id = p_prospect_id
      and (
        public.can_manage_school(pr.school_id)
        or exists (
          select 1
          from public.trial_lessons tl
          where tl.prospect_id = pr.id
            and tl.assigned_teacher_profile_id = (select auth.uid())
        )
        or exists (
          select 1
          from public.trial_packages tp
          join public.trial_package_lessons tpl
            on tpl.trial_package_id = tp.id
          join public.staff st
            on st.id = tpl.assigned_teacher_staff_id
            and st.organization_id = tpl.organization_id
          where tp.prospect_id = pr.id
            and st.profile_id = (select auth.uid())
        )
      )
  );
$$;

create or replace function public.ensure_trial_package_lesson_teacher_staff_assignment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.assigned_teacher_staff_id is null then
    return new;
  end if;

  if not public.has_active_staff_teacher_staff_assignment(new.school_id, new.assigned_teacher_staff_id) then
    raise exception 'Assigned teacher must be active teaching staff assigned to this school.';
  end if;

  return new;
end;
$$;

revoke all on function public.ensure_trial_package_lesson_teacher_staff_assignment() from public, anon, authenticated;

drop trigger if exists trial_package_lessons_teacher_staff_assignment_check on public.trial_package_lessons;
create trigger trial_package_lessons_teacher_staff_assignment_check
before insert or update of school_id, organization_id, assigned_teacher_staff_id on public.trial_package_lessons
for each row execute function public.ensure_trial_package_lesson_teacher_staff_assignment();

create or replace function public.refresh_trial_package_progress(p_trial_package_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_completed_count integer;
  v_package public.trial_packages%rowtype;
begin
  select * into v_package
  from public.trial_packages tp
  where tp.id = p_trial_package_id
  for update;

  if not found then
    return;
  end if;

  select count(*)::integer into v_completed_count
  from public.trial_package_lessons tpl
  where tpl.trial_package_id = p_trial_package_id
    and tpl.status = 'completed';

  if v_package.status in ('active', 'completed') then
    update public.trial_packages
    set status = case
          when v_completed_count >= v_package.total_lessons then 'completed'::public.trial_package_status
          else 'active'::public.trial_package_status
        end,
        updated_at = now()
    where id = p_trial_package_id;
  end if;
end;
$$;

revoke all on function public.refresh_trial_package_progress(uuid) from public, anon, authenticated;

create or replace function public.apply_trial_package_lesson_lifecycle()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status = 'completed' and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    new.completed_at = coalesce(new.completed_at, now());
  elsif new.status <> 'completed' then
    new.completed_at = null;
  end if;

  if new.status = 'cancelled' and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    new.cancelled_at = coalesce(new.cancelled_at, now());
  elsif new.status <> 'cancelled' then
    new.cancelled_at = null;
  end if;

  if new.status = 'no_show' and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    new.no_show_at = coalesce(new.no_show_at, now());
  elsif new.status <> 'no_show' then
    new.no_show_at = null;
  end if;

  if new.status = 'not_scheduled' then
    new.lesson_date = null;
    new.lesson_time = null;
  end if;

  return new;
end;
$$;

revoke all on function public.apply_trial_package_lesson_lifecycle() from public, anon, authenticated;

drop trigger if exists trial_package_lessons_lifecycle on public.trial_package_lessons;
create trigger trial_package_lessons_lifecycle
before insert or update of status, lesson_date, lesson_time, completed_at, cancelled_at, no_show_at
on public.trial_package_lessons
for each row execute function public.apply_trial_package_lesson_lifecycle();

create or replace function public.refresh_trial_package_progress_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.refresh_trial_package_progress(coalesce(new.trial_package_id, old.trial_package_id));
  return null;
end;
$$;

revoke all on function public.refresh_trial_package_progress_trigger() from public, anon, authenticated;

drop trigger if exists trial_package_lessons_refresh_package on public.trial_package_lessons;
create trigger trial_package_lessons_refresh_package
after insert or update of status or delete
on public.trial_package_lessons
for each row execute function public.refresh_trial_package_progress_trigger();

alter table public.trial_packages enable row level security;
alter table public.trial_package_lessons enable row level security;

revoke all on public.trial_packages from anon, authenticated;
revoke all on public.trial_package_lessons from anon, authenticated;

grant select, insert, update, delete on public.trial_packages to authenticated;
grant select, insert, update, delete on public.trial_package_lessons to authenticated;
grant all on public.trial_packages to service_role;
grant all on public.trial_package_lessons to service_role;

drop policy if exists "trial_packages_select_visible" on public.trial_packages;
create policy "trial_packages_select_visible"
on public.trial_packages
for select
to authenticated
using (public.can_view_trial_package(id));

drop policy if exists "trial_packages_insert_staff" on public.trial_packages;
create policy "trial_packages_insert_staff"
on public.trial_packages
for insert
to authenticated
with check (
  public.can_access_org(organization_id)
  and public.can_manage_school(school_id)
);

drop policy if exists "trial_packages_update_staff" on public.trial_packages;
create policy "trial_packages_update_staff"
on public.trial_packages
for update
to authenticated
using (public.can_manage_school(school_id))
with check (
  public.can_access_org(organization_id)
  and public.can_manage_school(school_id)
);

drop policy if exists "trial_packages_delete_super_admin" on public.trial_packages;
create policy "trial_packages_delete_super_admin"
on public.trial_packages
for delete
to authenticated
using (public.is_super_admin());

drop policy if exists "trial_package_lessons_select_visible" on public.trial_package_lessons;
create policy "trial_package_lessons_select_visible"
on public.trial_package_lessons
for select
to authenticated
using (public.can_view_trial_package(trial_package_id));

drop policy if exists "trial_package_lessons_insert_staff" on public.trial_package_lessons;
create policy "trial_package_lessons_insert_staff"
on public.trial_package_lessons
for insert
to authenticated
with check (
  public.can_manage_trial_package(trial_package_id)
  and public.can_access_org(organization_id)
  and public.can_manage_school(school_id)
);

drop policy if exists "trial_package_lessons_update_staff" on public.trial_package_lessons;
create policy "trial_package_lessons_update_staff"
on public.trial_package_lessons
for update
to authenticated
using (public.can_manage_trial_package(trial_package_id))
with check (
  public.can_manage_trial_package(trial_package_id)
  and public.can_access_org(organization_id)
  and public.can_manage_school(school_id)
);

drop policy if exists "trial_package_lessons_delete_super_admin" on public.trial_package_lessons;
create policy "trial_package_lessons_delete_super_admin"
on public.trial_package_lessons
for delete
to authenticated
using (public.is_super_admin());

create or replace function public.create_trial_package_mvp(
  p_school_id uuid,
  p_contact_japanese_name text,
  p_contact_furigana text default null,
  p_contact_alphabet_name text default null,
  p_contacts jsonb default '[]'::jsonb,
  p_inquiry_method_id text default null,
  p_acquisition_source_id text default null,
  p_package_type text default 'group_english',
  p_total_lessons smallint default 4,
  p_lesson_type public.class_lesson_type default 'group',
  p_level_id text default null,
  p_first_lesson_date date default null,
  p_first_lesson_time time default null,
  p_assigned_teacher_staff_id uuid default null,
  p_customer_request text default null,
  p_internal_notes text default null
)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_acquisition_source_id text;
  v_contact jsonb;
  v_contact_type public.contact_type;
  v_contact_type_text text;
  v_email_count integer := 0;
  v_email_primary_used boolean := false;
  v_inquiry_method_id text;
  v_is_primary boolean;
  v_label text;
  v_lesson_number integer;
  v_organization_id uuid;
  v_package_id uuid;
  v_phone_count integer := 0;
  v_phone_primary_used boolean := false;
  v_prospect_id uuid;
  v_value text;
begin
  if nullif(trim(p_contact_japanese_name), '') is null then
    raise exception 'Contact name is required.';
  end if;

  if coalesce(p_total_lessons, 4) < 1 or coalesce(p_total_lessons, 4) > 24 then
    raise exception 'Total lessons must be between 1 and 24.';
  end if;

  if (p_first_lesson_date is null) <> (p_first_lesson_time is null) then
    raise exception 'First lesson date and time must be set together.';
  end if;

  if nullif(trim(coalesce(p_level_id, '')), '') is null then
    raise exception 'Level is required.';
  end if;

  select s.organization_id into v_organization_id
  from public.schools s
  where s.id = p_school_id;

  if v_organization_id is null then
    raise exception 'School % was not found or is not accessible.', p_school_id;
  end if;

  if not public.can_manage_school(p_school_id) then
    raise exception 'You do not have permission to create trial packages for this school.';
  end if;

  v_inquiry_method_id = nullif(trim(coalesce(p_inquiry_method_id, '')), '');
  if v_inquiry_method_id is not null and not exists (
    select 1 from public.inquiry_methods im where im.id = v_inquiry_method_id and im.status = 'active'
  ) then
    raise exception 'Inquiry method % was not found or is not active.', v_inquiry_method_id;
  end if;

  v_acquisition_source_id = nullif(trim(coalesce(p_acquisition_source_id, '')), '');
  if v_acquisition_source_id is not null and not exists (
    select 1 from public.acquisition_sources src where src.id = v_acquisition_source_id and src.status = 'active'
  ) then
    raise exception 'Acquisition source % was not found or is not active.', v_acquisition_source_id;
  end if;

  if not exists (
    select 1 from public.class_levels cl where cl.id = p_level_id and cl.status = 'active'
  ) then
    raise exception 'Level % was not found or is not active.', p_level_id;
  end if;

  if p_assigned_teacher_staff_id is not null
    and not public.has_active_staff_teacher_staff_assignment(p_school_id, p_assigned_teacher_staff_id)
  then
    raise exception 'Assigned teacher is not active for this school.';
  end if;

  if jsonb_typeof(coalesce(p_contacts, '[]'::jsonb)) <> 'array' then
    raise exception 'Contacts must be submitted as a JSON array.';
  end if;

  insert into public.prospects (
    organization_id,
    school_id,
    japanese_name,
    furigana,
    alphabet_name,
    inquiry_method_id,
    acquisition_source_id
  )
  values (
    v_organization_id,
    p_school_id,
    trim(p_contact_japanese_name),
    nullif(trim(coalesce(p_contact_furigana, '')), ''),
    nullif(trim(coalesce(p_contact_alphabet_name, '')), ''),
    v_inquiry_method_id,
    v_acquisition_source_id
  )
  returning id into v_prospect_id;

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

    insert into public.prospect_contacts (
      organization_id,
      school_id,
      prospect_id,
      contact_type,
      label,
      value,
      is_primary
    )
    values (
      v_organization_id,
      p_school_id,
      v_prospect_id,
      v_contact_type,
      v_label,
      v_value,
      v_is_primary
    );
  end loop;

  if v_email_count > 0 and not v_email_primary_used then
    update public.prospect_contacts pc
    set is_primary = true
    where pc.id = (
      select first_email.id
      from public.prospect_contacts first_email
      where first_email.prospect_id = v_prospect_id
        and first_email.contact_type = 'email'
      order by first_email.created_at, first_email.id
      limit 1
    );
  end if;

  if v_phone_count > 0 and not v_phone_primary_used then
    update public.prospect_contacts pc
    set is_primary = true
    where pc.id = (
      select first_phone.id
      from public.prospect_contacts first_phone
      where first_phone.prospect_id = v_prospect_id
        and first_phone.contact_type = 'phone'
      order by first_phone.created_at, first_phone.id
      limit 1
    );
  end if;

  insert into public.trial_packages (
    organization_id,
    school_id,
    prospect_id,
    package_type,
    lesson_type,
    level_id,
    total_lessons,
    customer_request,
    internal_notes
  )
  values (
    v_organization_id,
    p_school_id,
    v_prospect_id,
    coalesce(nullif(trim(coalesce(p_package_type, '')), ''), 'group_english'),
    coalesce(p_lesson_type, 'group'),
    p_level_id,
    coalesce(p_total_lessons, 4),
    nullif(trim(coalesce(p_customer_request, '')), ''),
    nullif(trim(coalesce(p_internal_notes, '')), '')
  )
  returning id into v_package_id;

  for v_lesson_number in 1..coalesce(p_total_lessons, 4) loop
    insert into public.trial_package_lessons (
      organization_id,
      school_id,
      trial_package_id,
      lesson_number,
      lesson_date,
      lesson_time,
      assigned_teacher_staff_id,
      status
    )
    values (
      v_organization_id,
      p_school_id,
      v_package_id,
      v_lesson_number,
      case when v_lesson_number = 1 then p_first_lesson_date else null end,
      case when v_lesson_number = 1 then p_first_lesson_time else null end,
      case when v_lesson_number = 1 then p_assigned_teacher_staff_id else null end,
      case
        when v_lesson_number = 1 and p_first_lesson_date is not null then 'scheduled'::public.trial_package_lesson_status
        else 'not_scheduled'::public.trial_package_lesson_status
      end
    );
  end loop;

  return v_package_id;
end;
$$;

revoke all on function public.create_trial_package_mvp(
  uuid,
  text,
  text,
  text,
  jsonb,
  text,
  text,
  text,
  smallint,
  public.class_lesson_type,
  text,
  date,
  time,
  uuid,
  text,
  text
) from public, anon;

grant execute on function public.create_trial_package_mvp(
  uuid,
  text,
  text,
  text,
  jsonb,
  text,
  text,
  text,
  smallint,
  public.class_lesson_type,
  text,
  date,
  time,
  uuid,
  text,
  text
) to authenticated;

create or replace function public.update_trial_package_lesson_mvp(
  p_trial_package_lesson_id uuid,
  p_lesson_date date default null,
  p_lesson_time time default null,
  p_assigned_teacher_staff_id uuid default null,
  p_status public.trial_package_lesson_status default null,
  p_notes text default null
)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_lesson public.trial_package_lessons%rowtype;
  v_status public.trial_package_lesson_status;
begin
  select * into v_lesson
  from public.trial_package_lessons tpl
  where tpl.id = p_trial_package_lesson_id
  for update;

  if not found then
    raise exception 'Trial package lesson % was not found.', p_trial_package_lesson_id;
  end if;

  if not public.can_manage_trial_package(v_lesson.trial_package_id) then
    raise exception 'You do not have permission to update this trial package lesson.';
  end if;

  v_status = coalesce(p_status, v_lesson.status);

  if v_status = 'scheduled' and (p_lesson_date is null or p_lesson_time is null) then
    raise exception 'Scheduled package lessons require a date and time.';
  end if;

  update public.trial_package_lessons
  set lesson_date = p_lesson_date,
      lesson_time = p_lesson_time,
      assigned_teacher_staff_id = p_assigned_teacher_staff_id,
      status = v_status,
      notes = nullif(trim(coalesce(p_notes, '')), ''),
      updated_at = now()
  where id = v_lesson.id;

  return v_lesson.id;
end;
$$;

revoke all on function public.update_trial_package_lesson_mvp(
  uuid,
  date,
  time,
  uuid,
  public.trial_package_lesson_status,
  text
) from public, anon;

grant execute on function public.update_trial_package_lesson_mvp(
  uuid,
  date,
  time,
  uuid,
  public.trial_package_lesson_status,
  text
) to authenticated;

create or replace function public.update_trial_package_status_mvp(
  p_trial_package_id uuid,
  p_status public.trial_package_status,
  p_converted_student_id uuid default null
)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_package public.trial_packages%rowtype;
begin
  select * into v_package
  from public.trial_packages tp
  where tp.id = p_trial_package_id
  for update;

  if not found then
    raise exception 'Trial package % was not found.', p_trial_package_id;
  end if;

  if not public.can_manage_school(v_package.school_id) then
    raise exception 'You do not have permission to update this trial package.';
  end if;

  if p_status is null then
    raise exception 'Package status is required.';
  end if;

  if p_converted_student_id is not null and not exists (
    select 1
    from public.students st
    where st.id = p_converted_student_id
      and st.organization_id = v_package.organization_id
      and st.school_id = v_package.school_id
  ) then
    raise exception 'Converted student must belong to the same school.';
  end if;

  update public.trial_packages
  set status = p_status,
      converted_student_id = case
        when p_status = 'converted' then p_converted_student_id
        else converted_student_id
      end,
      updated_at = now()
  where id = v_package.id;

  return v_package.id;
end;
$$;

revoke all on function public.update_trial_package_status_mvp(uuid, public.trial_package_status, uuid) from public, anon;
grant execute on function public.update_trial_package_status_mvp(uuid, public.trial_package_status, uuid) to authenticated;

notify pgrst, 'reload schema';
