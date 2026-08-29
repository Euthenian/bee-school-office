do $$
begin
  create type public.trial_lesson_status as enum (
    'inquiry',
    'booked',
    'completed',
    'no_show',
    'cancelled',
    'joined',
    'did_not_join'
  );
exception
  when duplicate_object then null;
end;
$$;

create table if not exists public.inquiry_methods (
  id text primary key,
  label text not null unique,
  sort_order integer not null unique,
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.acquisition_sources (
  id text primary key,
  label text not null unique,
  sort_order integer not null unique,
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.inquiry_methods (id, label, sort_order)
values
  ('website_form', 'Website form', 10),
  ('email', 'Email', 20),
  ('phone', 'Phone', 30),
  ('walk_in', 'Walk-in', 40),
  ('line', 'LINE', 50),
  ('other', 'Other', 60)
on conflict (id) do update
set label = excluded.label,
    sort_order = excluded.sort_order,
    status = 'active',
    updated_at = now();

insert into public.acquisition_sources (id, label, sort_order)
values
  ('bee_school_website', 'Bee School website', 10),
  ('google_search', 'Google Search', 20),
  ('google_maps', 'Google Maps', 30),
  ('referral', 'Referral', 40),
  ('flyer', 'Flyer', 50),
  ('instagram_social', 'Instagram / social media', 60),
  ('existing_student_family', 'Existing student/family', 70),
  ('other', 'Other', 80)
on conflict (id) do update
set label = excluded.label,
    sort_order = excluded.sort_order,
    status = 'active',
    updated_at = now();

create table if not exists public.prospects (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  school_id uuid not null references public.schools (id) on delete restrict,
  japanese_name text not null,
  furigana text,
  alphabet_name text,
  inquiry_method_id text references public.inquiry_methods (id) on delete restrict,
  acquisition_source_id text references public.acquisition_sources (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id, school_id),
  constraint prospects_school_id_organization_id_fkey
    foreign key (school_id, organization_id)
    references public.schools (id, organization_id)
    on delete restrict
);

create table if not exists public.prospect_contacts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  school_id uuid not null,
  prospect_id uuid not null references public.prospects (id) on delete cascade,
  contact_type public.contact_type not null,
  label text,
  value text not null,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint prospect_contacts_contact_type_check
    check (contact_type in ('email', 'phone')),
  constraint prospect_contacts_prospect_id_organization_id_school_id_fkey
    foreign key (prospect_id, organization_id, school_id)
    references public.prospects (id, organization_id, school_id)
    on delete cascade
);

create table if not exists public.trial_lessons (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  school_id uuid not null references public.schools (id) on delete restrict,
  prospect_id uuid not null references public.prospects (id) on delete cascade,
  trial_date date not null,
  trial_time time not null,
  assigned_teacher_profile_id uuid,
  lesson_type public.class_lesson_type not null,
  level_id text not null references public.class_levels (id) on delete restrict,
  customer_request text,
  internal_notes text,
  status public.trial_lesson_status not null default 'booked',
  converted_student_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id, school_id),
  constraint trial_lessons_school_id_organization_id_fkey
    foreign key (school_id, organization_id)
    references public.schools (id, organization_id)
    on delete restrict,
  constraint trial_lessons_prospect_id_organization_id_school_id_fkey
    foreign key (prospect_id, organization_id, school_id)
    references public.prospects (id, organization_id, school_id)
    on delete cascade,
  constraint trial_lessons_assigned_teacher_profile_id_fkey
    foreign key (assigned_teacher_profile_id)
    references public.profiles (id)
    on delete restrict,
  constraint trial_lessons_assigned_teacher_membership_fkey
    foreign key (school_id, assigned_teacher_profile_id)
    references public.school_memberships (school_id, profile_id)
    on delete restrict,
  constraint trial_lessons_converted_student_id_organization_id_school_id_fkey
    foreign key (converted_student_id, organization_id, school_id)
    references public.students (id, organization_id, school_id)
    on delete restrict
);

create table if not exists public.trial_lesson_participants (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  school_id uuid not null,
  trial_lesson_id uuid not null references public.trial_lessons (id) on delete cascade,
  japanese_name text not null,
  furigana text,
  alphabet_name text,
  date_of_birth date,
  age_override smallint,
  age_group_level_id text,
  requested_level_id text,
  converted_student_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint trial_lesson_participants_age_override_range
    check (age_override is null or (age_override between 0 and 120)),
  constraint trial_lesson_participants_trial_lesson_id_organization_id_school_id_fkey
    foreign key (trial_lesson_id, organization_id, school_id)
    references public.trial_lessons (id, organization_id, school_id)
    on delete cascade,
  constraint trial_lesson_participants_age_group_level_id_fkey
    foreign key (age_group_level_id)
    references public.class_levels (id)
    on delete restrict,
  constraint trial_lesson_participants_requested_level_id_fkey
    foreign key (requested_level_id)
    references public.class_levels (id)
    on delete restrict,
  constraint trial_lesson_participants_converted_student_id_organization_id_school_id_fkey
    foreign key (converted_student_id, organization_id, school_id)
    references public.students (id, organization_id, school_id)
    on delete restrict
);

create index if not exists prospects_organization_school_idx
on public.prospects (organization_id, school_id);

create index if not exists prospects_inquiry_source_idx
on public.prospects (inquiry_method_id, acquisition_source_id);

create index if not exists prospect_contacts_prospect_id_idx
on public.prospect_contacts (prospect_id);

create unique index if not exists prospect_contacts_one_primary_per_type_idx
on public.prospect_contacts (prospect_id, contact_type)
where is_primary;

create index if not exists trial_lessons_school_date_idx
on public.trial_lessons (school_id, trial_date, trial_time);

create index if not exists trial_lessons_status_idx
on public.trial_lessons (status);

create index if not exists trial_lessons_teacher_idx
on public.trial_lessons (assigned_teacher_profile_id)
where assigned_teacher_profile_id is not null;

create index if not exists trial_lessons_prospect_id_idx
on public.trial_lessons (prospect_id);

create index if not exists trial_lesson_participants_trial_lesson_id_idx
on public.trial_lesson_participants (trial_lesson_id);

drop trigger if exists inquiry_methods_set_updated_at on public.inquiry_methods;
create trigger inquiry_methods_set_updated_at
before update on public.inquiry_methods
for each row execute function public.set_updated_at();

drop trigger if exists acquisition_sources_set_updated_at on public.acquisition_sources;
create trigger acquisition_sources_set_updated_at
before update on public.acquisition_sources
for each row execute function public.set_updated_at();

drop trigger if exists prospects_set_updated_at on public.prospects;
create trigger prospects_set_updated_at
before update on public.prospects
for each row execute function public.set_updated_at();

drop trigger if exists prospect_contacts_set_updated_at on public.prospect_contacts;
create trigger prospect_contacts_set_updated_at
before update on public.prospect_contacts
for each row execute function public.set_updated_at();

drop trigger if exists trial_lessons_set_updated_at on public.trial_lessons;
create trigger trial_lessons_set_updated_at
before update on public.trial_lessons
for each row execute function public.set_updated_at();

drop trigger if exists trial_lesson_participants_set_updated_at on public.trial_lesson_participants;
create trigger trial_lesson_participants_set_updated_at
before update on public.trial_lesson_participants
for each row execute function public.set_updated_at();

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

revoke all on function public.ensure_trial_lesson_teacher_membership() from public, anon, authenticated;

drop trigger if exists trial_lessons_teacher_membership_check on public.trial_lessons;
create trigger trial_lessons_teacher_membership_check
before insert or update of school_id, assigned_teacher_profile_id on public.trial_lessons
for each row execute function public.ensure_trial_lesson_teacher_membership();

create or replace function public.can_manage_prospect(p_prospect_id uuid)
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
      and public.can_manage_school(pr.school_id)
  );
$$;

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
      )
  );
$$;

create or replace function public.can_manage_trial_lesson(p_trial_lesson_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.trial_lessons tl
    where tl.id = p_trial_lesson_id
      and public.can_manage_school(tl.school_id)
  );
$$;

create or replace function public.can_view_trial_lesson(p_trial_lesson_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.trial_lessons tl
    where tl.id = p_trial_lesson_id
      and (
        public.can_manage_school(tl.school_id)
        or tl.assigned_teacher_profile_id = (select auth.uid())
      )
  );
$$;

alter table public.inquiry_methods enable row level security;
alter table public.acquisition_sources enable row level security;
alter table public.prospects enable row level security;
alter table public.prospect_contacts enable row level security;
alter table public.trial_lessons enable row level security;
alter table public.trial_lesson_participants enable row level security;

revoke all on public.inquiry_methods from anon, authenticated;
revoke all on public.acquisition_sources from anon, authenticated;
revoke all on public.prospects from anon, authenticated;
revoke all on public.prospect_contacts from anon, authenticated;
revoke all on public.trial_lessons from anon, authenticated;
revoke all on public.trial_lesson_participants from anon, authenticated;

grant select on public.inquiry_methods to authenticated;
grant select on public.acquisition_sources to authenticated;
grant select, insert, update, delete on public.prospects to authenticated;
grant select, insert, update, delete on public.prospect_contacts to authenticated;
grant select, insert, update, delete on public.trial_lessons to authenticated;
grant select, insert, update, delete on public.trial_lesson_participants to authenticated;

grant all on public.inquiry_methods to service_role;
grant all on public.acquisition_sources to service_role;
grant all on public.prospects to service_role;
grant all on public.prospect_contacts to service_role;
grant all on public.trial_lessons to service_role;
grant all on public.trial_lesson_participants to service_role;

drop policy if exists "inquiry_methods_select_active" on public.inquiry_methods;
create policy "inquiry_methods_select_active"
on public.inquiry_methods
for select
to authenticated
using (status = 'active');

drop policy if exists "acquisition_sources_select_active" on public.acquisition_sources;
create policy "acquisition_sources_select_active"
on public.acquisition_sources
for select
to authenticated
using (status = 'active');

drop policy if exists "prospects_select_visible" on public.prospects;
create policy "prospects_select_visible"
on public.prospects
for select
to authenticated
using (public.can_view_prospect(id));

drop policy if exists "prospects_insert_staff" on public.prospects;
create policy "prospects_insert_staff"
on public.prospects
for insert
to authenticated
with check (
  public.can_access_org(organization_id)
  and public.can_manage_school(school_id)
);

drop policy if exists "prospects_update_staff" on public.prospects;
create policy "prospects_update_staff"
on public.prospects
for update
to authenticated
using (public.can_manage_school(school_id))
with check (
  public.can_access_org(organization_id)
  and public.can_manage_school(school_id)
);

drop policy if exists "prospects_delete_super_admin" on public.prospects;
create policy "prospects_delete_super_admin"
on public.prospects
for delete
to authenticated
using (public.is_super_admin());

drop policy if exists "prospect_contacts_select_visible" on public.prospect_contacts;
create policy "prospect_contacts_select_visible"
on public.prospect_contacts
for select
to authenticated
using (public.can_view_prospect(prospect_id));

drop policy if exists "prospect_contacts_insert_staff" on public.prospect_contacts;
create policy "prospect_contacts_insert_staff"
on public.prospect_contacts
for insert
to authenticated
with check (
  public.can_manage_prospect(prospect_id)
  and public.can_access_org(organization_id)
  and public.can_manage_school(school_id)
);

drop policy if exists "prospect_contacts_update_staff" on public.prospect_contacts;
create policy "prospect_contacts_update_staff"
on public.prospect_contacts
for update
to authenticated
using (public.can_manage_prospect(prospect_id))
with check (
  public.can_manage_prospect(prospect_id)
  and public.can_access_org(organization_id)
  and public.can_manage_school(school_id)
);

drop policy if exists "prospect_contacts_delete_staff" on public.prospect_contacts;
create policy "prospect_contacts_delete_staff"
on public.prospect_contacts
for delete
to authenticated
using (public.can_manage_prospect(prospect_id));

drop policy if exists "trial_lessons_select_visible" on public.trial_lessons;
create policy "trial_lessons_select_visible"
on public.trial_lessons
for select
to authenticated
using (public.can_view_trial_lesson(id));

drop policy if exists "trial_lessons_insert_staff" on public.trial_lessons;
create policy "trial_lessons_insert_staff"
on public.trial_lessons
for insert
to authenticated
with check (
  public.can_access_org(organization_id)
  and public.can_manage_school(school_id)
);

drop policy if exists "trial_lessons_update_staff" on public.trial_lessons;
create policy "trial_lessons_update_staff"
on public.trial_lessons
for update
to authenticated
using (public.can_manage_school(school_id))
with check (
  public.can_access_org(organization_id)
  and public.can_manage_school(school_id)
);

drop policy if exists "trial_lessons_delete_super_admin" on public.trial_lessons;
create policy "trial_lessons_delete_super_admin"
on public.trial_lessons
for delete
to authenticated
using (public.is_super_admin());

drop policy if exists "trial_lesson_participants_select_visible" on public.trial_lesson_participants;
create policy "trial_lesson_participants_select_visible"
on public.trial_lesson_participants
for select
to authenticated
using (public.can_view_trial_lesson(trial_lesson_id));

drop policy if exists "trial_lesson_participants_insert_staff" on public.trial_lesson_participants;
create policy "trial_lesson_participants_insert_staff"
on public.trial_lesson_participants
for insert
to authenticated
with check (
  public.can_manage_trial_lesson(trial_lesson_id)
  and public.can_access_org(organization_id)
  and public.can_manage_school(school_id)
);

drop policy if exists "trial_lesson_participants_update_staff" on public.trial_lesson_participants;
create policy "trial_lesson_participants_update_staff"
on public.trial_lesson_participants
for update
to authenticated
using (public.can_manage_trial_lesson(trial_lesson_id))
with check (
  public.can_manage_trial_lesson(trial_lesson_id)
  and public.can_access_org(organization_id)
  and public.can_manage_school(school_id)
);

drop policy if exists "trial_lesson_participants_delete_staff" on public.trial_lesson_participants;
create policy "trial_lesson_participants_delete_staff"
on public.trial_lesson_participants
for delete
to authenticated
using (public.can_manage_trial_lesson(trial_lesson_id));

create or replace function public.create_trial_lesson_mvp(
  p_school_id uuid,
  p_contact_japanese_name text,
  p_contact_furigana text default null,
  p_contact_alphabet_name text default null,
  p_contacts jsonb default '[]'::jsonb,
  p_inquiry_method_id text default null,
  p_acquisition_source_id text default null,
  p_trial_date date default null,
  p_trial_time time default null,
  p_assigned_teacher_profile_id uuid default null,
  p_lesson_type public.class_lesson_type default 'group',
  p_level_id text default null,
  p_status public.trial_lesson_status default 'booked',
  p_customer_request text default null,
  p_internal_notes text default null,
  p_participants jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_acquisition_source_id text;
  v_age_override smallint;
  v_contact jsonb;
  v_contact_type public.contact_type;
  v_contact_type_text text;
  v_date_of_birth date;
  v_email_count integer := 0;
  v_email_primary_used boolean := false;
  v_inquiry_method_id text;
  v_is_primary boolean;
  v_label text;
  v_organization_id uuid;
  v_participant jsonb;
  v_phone_count integer := 0;
  v_phone_primary_used boolean := false;
  v_prospect_id uuid;
  v_trial_lesson_id uuid;
  v_value text;
begin
  if nullif(trim(p_contact_japanese_name), '') is null then
    raise exception 'Contact name is required.';
  end if;

  if p_trial_date is null then
    raise exception 'Trial date is required.';
  end if;

  if p_trial_time is null then
    raise exception 'Trial time is required.';
  end if;

  if nullif(trim(coalesce(p_level_id, '')), '') is null then
    raise exception 'Level is required.';
  end if;

  if jsonb_typeof(coalesce(p_contacts, '[]'::jsonb)) <> 'array' then
    raise exception 'Contacts must be submitted as a JSON array.';
  end if;

  if jsonb_typeof(coalesce(p_participants, '[]'::jsonb)) <> 'array'
    or jsonb_array_length(coalesce(p_participants, '[]'::jsonb)) = 0
  then
    raise exception 'At least one trial participant is required.';
  end if;

  select s.organization_id into v_organization_id
  from public.schools s
  where s.id = p_school_id;

  if v_organization_id is null then
    raise exception 'School % was not found or is not accessible.', p_school_id;
  end if;

  if not public.can_manage_school(p_school_id) then
    raise exception 'You do not have permission to create trial lessons for this school.';
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

  insert into public.trial_lessons (
    organization_id,
    school_id,
    prospect_id,
    trial_date,
    trial_time,
    assigned_teacher_profile_id,
    lesson_type,
    level_id,
    customer_request,
    internal_notes,
    status
  )
  values (
    v_organization_id,
    p_school_id,
    v_prospect_id,
    p_trial_date,
    p_trial_time,
    p_assigned_teacher_profile_id,
    p_lesson_type,
    p_level_id,
    nullif(trim(coalesce(p_customer_request, '')), ''),
    nullif(trim(coalesce(p_internal_notes, '')), ''),
    coalesce(p_status, 'booked')
  )
  returning id into v_trial_lesson_id;

  for v_participant in
    select value
    from jsonb_array_elements(coalesce(p_participants, '[]'::jsonb)) as participant_row(value)
  loop
    if jsonb_typeof(v_participant) <> 'object' then
      raise exception 'Each participant must be an object.';
    end if;

    if nullif(trim(coalesce(v_participant ->> 'japanese_name', '')), '') is null then
      raise exception 'Each participant must have a Japanese name.';
    end if;

    v_date_of_birth = nullif(trim(coalesce(v_participant ->> 'date_of_birth', '')), '')::date;
    v_age_override = nullif(trim(coalesce(v_participant ->> 'age_override', '')), '')::smallint;

    if v_age_override is not null and (v_age_override < 0 or v_age_override > 120) then
      raise exception 'Participant age must be a whole number between 0 and 120.';
    end if;

    insert into public.trial_lesson_participants (
      organization_id,
      school_id,
      trial_lesson_id,
      japanese_name,
      furigana,
      alphabet_name,
      date_of_birth,
      age_override,
      age_group_level_id,
      requested_level_id
    )
    values (
      v_organization_id,
      p_school_id,
      v_trial_lesson_id,
      trim(v_participant ->> 'japanese_name'),
      nullif(trim(coalesce(v_participant ->> 'furigana', '')), ''),
      nullif(trim(coalesce(v_participant ->> 'alphabet_name', '')), ''),
      v_date_of_birth,
      case when v_date_of_birth is null then v_age_override else null end,
      nullif(trim(coalesce(v_participant ->> 'age_group_level_id', '')), ''),
      nullif(trim(coalesce(v_participant ->> 'requested_level_id', '')), '')
    );
  end loop;

  return v_trial_lesson_id;
end;
$$;

revoke all on function public.create_trial_lesson_mvp(
  uuid,
  text,
  text,
  text,
  jsonb,
  text,
  text,
  date,
  time,
  uuid,
  public.class_lesson_type,
  text,
  public.trial_lesson_status,
  text,
  text,
  jsonb
) from public, anon;

grant execute on function public.create_trial_lesson_mvp(
  uuid,
  text,
  text,
  text,
  jsonb,
  text,
  text,
  date,
  time,
  uuid,
  public.class_lesson_type,
  text,
  public.trial_lesson_status,
  text,
  text,
  jsonb
) to authenticated;

create or replace function public.convert_trial_lesson_participant_to_student(
  p_trial_lesson_id uuid,
  p_participant_id uuid,
  p_start_date date default current_date
)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_class_id uuid;
  v_first_name text;
  v_level_label text;
  v_name text;
  v_organization_id uuid;
  v_participant public.trial_lesson_participants%rowtype;
  v_prospect public.prospects%rowtype;
  v_school_id uuid;
  v_student_id uuid;
  v_trial public.trial_lessons%rowtype;
begin
  select * into v_trial
  from public.trial_lessons tl
  where tl.id = p_trial_lesson_id;

  if not found then
    raise exception 'Trial lesson % was not found or is not accessible.', p_trial_lesson_id;
  end if;

  if not public.can_manage_school(v_trial.school_id) then
    raise exception 'You do not have permission to convert this trial lesson.';
  end if;

  select * into v_participant
  from public.trial_lesson_participants tlp
  where tlp.id = p_participant_id
    and tlp.trial_lesson_id = p_trial_lesson_id;

  if not found then
    raise exception 'Trial participant % was not found or is not accessible.', p_participant_id;
  end if;

  if v_participant.converted_student_id is not null then
    return v_participant.converted_student_id;
  end if;

  select * into v_prospect
  from public.prospects pr
  where pr.id = v_trial.prospect_id;

  v_organization_id = v_trial.organization_id;
  v_school_id = v_trial.school_id;
  v_name = coalesce(nullif(trim(v_participant.alphabet_name), ''), nullif(trim(v_participant.japanese_name), ''));
  v_first_name = split_part(v_name, ' ', 1);

  insert into public.students (
    organization_id,
    school_id,
    first_name,
    last_name,
    preferred_name,
    status,
    date_of_birth,
    age_override,
    start_date
  )
  values (
    v_organization_id,
    v_school_id,
    v_first_name,
    coalesce(nullif(trim(substr(v_name, length(v_first_name) + 1)), ''), ''),
    v_participant.japanese_name,
    'active',
    v_participant.date_of_birth,
    case when v_participant.date_of_birth is null then v_participant.age_override else null end,
    coalesce(p_start_date, current_date)
  )
  returning id into v_student_id;

  insert into public.student_contacts (student_id, contact_type, label, value, is_primary)
  select v_student_id, pc.contact_type, pc.label, pc.value, pc.is_primary
  from public.prospect_contacts pc
  where pc.prospect_id = v_prospect.id;

  select cl.label into v_level_label
  from public.class_levels cl
  where cl.id = coalesce(v_participant.requested_level_id, v_trial.level_id);

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
    v_school_id,
    v_trial.assigned_teacher_profile_id,
    v_trial.lesson_type,
    coalesce(v_participant.requested_level_id, v_trial.level_id),
    case extract(isodow from v_trial.trial_date)::integer
      when 1 then 'monday'
      when 2 then 'tuesday'
      when 3 then 'wednesday'
      when 4 then 'thursday'
      when 5 then 'friday'
      when 6 then 'saturday'
      else 'sunday'
    end::public.class_lesson_day,
    v_trial.trial_time
  )
  returning id into v_class_id;

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
    v_school_id,
    v_student_id,
    v_class_id,
    'active',
    v_level_label,
    coalesce(p_start_date, current_date)
  );

  update public.trial_lesson_participants
  set converted_student_id = v_student_id,
      updated_at = now()
  where id = v_participant.id;

  update public.trial_lessons
  set status = 'joined',
      converted_student_id = coalesce(converted_student_id, v_student_id),
      updated_at = now()
  where id = v_trial.id;

  return v_student_id;
end;
$$;

revoke all on function public.convert_trial_lesson_participant_to_student(uuid, uuid, date) from public, anon;
grant execute on function public.convert_trial_lesson_participant_to_student(uuid, uuid, date) to authenticated;

notify pgrst, 'reload schema';
