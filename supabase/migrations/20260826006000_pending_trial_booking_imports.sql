create table if not exists public.pending_trial_booking_imports (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  school_id uuid not null references public.schools (id) on delete restrict,
  source_type text not null default 'gmail',
  source_mailbox text not null,
  gmail_message_id text not null,
  gmail_thread_id text,
  received_at timestamptz,
  sender text,
  recipient text,
  subject text,
  booking_source text,
  trial_type text,
  student_name text,
  email text,
  phone text,
  student_age smallint,
  lesson_type text,
  first_preferred_date date,
  first_preferred_time time,
  second_preferred_date date,
  second_preferred_time time,
  customer_message text,
  raw_body text,
  parse_status text not null default 'parsed',
  parse_error text,
  review_status text not null default 'pending_review',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pending_trial_booking_imports_school_id_organization_id_fkey
    foreign key (school_id, organization_id)
    references public.schools (id, organization_id)
    on delete restrict,
  constraint pending_trial_booking_imports_source_type_check
    check (source_type in ('gmail')),
  constraint pending_trial_booking_imports_source_mailbox_required
    check (length(btrim(source_mailbox)) > 0),
  constraint pending_trial_booking_imports_gmail_message_id_required
    check (length(btrim(gmail_message_id)) > 0),
  constraint pending_trial_booking_imports_student_age_range
    check (student_age is null or student_age between 0 and 120),
  constraint pending_trial_booking_imports_parse_status_check
    check (parse_status in ('parsed', 'parse_error', 'ignored')),
  constraint pending_trial_booking_imports_review_status_check
    check (review_status in ('pending_review', 'reviewed', 'dismissed')),
  constraint pending_trial_booking_imports_source_mailbox_gmail_message_id_k
    unique (source_mailbox, gmail_message_id)
);

create index if not exists pending_trial_booking_imports_school_review_idx
on public.pending_trial_booking_imports (school_id, review_status, received_at desc);

create index if not exists pending_trial_booking_imports_received_at_idx
on public.pending_trial_booking_imports (received_at desc)
where received_at is not null;

drop trigger if exists pending_trial_booking_imports_set_updated_at on public.pending_trial_booking_imports;
create trigger pending_trial_booking_imports_set_updated_at
before update on public.pending_trial_booking_imports
for each row execute function public.set_updated_at();

alter table public.pending_trial_booking_imports enable row level security;

revoke all on public.pending_trial_booking_imports from anon, authenticated;

grant select, insert, update, delete on public.pending_trial_booking_imports to authenticated;
grant all on public.pending_trial_booking_imports to service_role;

drop policy if exists "pending_trial_booking_imports_select_staff" on public.pending_trial_booking_imports;
create policy "pending_trial_booking_imports_select_staff"
on public.pending_trial_booking_imports
for select
to authenticated
using (public.can_manage_school(school_id));

drop policy if exists "pending_trial_booking_imports_insert_staff" on public.pending_trial_booking_imports;
create policy "pending_trial_booking_imports_insert_staff"
on public.pending_trial_booking_imports
for insert
to authenticated
with check (
  public.can_access_org(organization_id)
  and public.can_manage_school(school_id)
);

drop policy if exists "pending_trial_booking_imports_update_staff" on public.pending_trial_booking_imports;
create policy "pending_trial_booking_imports_update_staff"
on public.pending_trial_booking_imports
for update
to authenticated
using (public.can_manage_school(school_id))
with check (
  public.can_access_org(organization_id)
  and public.can_manage_school(school_id)
);

drop policy if exists "pending_trial_booking_imports_delete_staff" on public.pending_trial_booking_imports;
create policy "pending_trial_booking_imports_delete_staff"
on public.pending_trial_booking_imports
for delete
to authenticated
using (public.can_manage_school(school_id));
