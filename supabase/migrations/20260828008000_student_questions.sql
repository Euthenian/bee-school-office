do $$
begin
  create type public.student_question_status as enum ('open', 'done');
exception
  when duplicate_object then null;
end;
$$;

create table if not exists public.student_questions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  school_id uuid not null references public.schools (id) on delete restrict,
  student_id uuid not null references public.students (id) on delete cascade,
  question text not null,
  reminder_date date not null,
  status public.student_question_status not null default 'open',
  created_by uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (id, organization_id, school_id),
  constraint student_questions_question_not_blank
    check (length(trim(question)) > 0),
  constraint student_questions_school_id_organization_id_fkey
    foreign key (school_id, organization_id)
    references public.schools (id, organization_id)
    on delete restrict,
  constraint student_questions_student_id_organization_id_school_id_fkey
    foreign key (student_id, organization_id, school_id)
    references public.students (id, organization_id, school_id)
    on delete cascade,
  constraint student_questions_completed_status_check
    check (
      (status = 'open' and completed_at is null)
      or (status = 'done' and completed_at is not null)
    )
);

create index if not exists student_questions_student_open_due_idx
on public.student_questions (student_id, status, reminder_date, created_at);

create index if not exists student_questions_school_open_due_idx
on public.student_questions (school_id, status, reminder_date, created_at);

create or replace function public.apply_student_question_completion()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.status = 'done' and new.completed_at is null then
    new.completed_at = now();
  end if;

  if new.status = 'open' then
    new.completed_at = null;
  end if;

  return new;
end;
$$;

revoke all on function public.apply_student_question_completion() from public, anon, authenticated;

drop trigger if exists student_questions_completion_state on public.student_questions;
create trigger student_questions_completion_state
before insert or update of status
on public.student_questions
for each row execute function public.apply_student_question_completion();

drop trigger if exists student_questions_set_updated_at on public.student_questions;
create trigger student_questions_set_updated_at
before update on public.student_questions
for each row execute function public.set_updated_at();

alter table public.student_questions enable row level security;

revoke all on public.student_questions from anon, authenticated;
grant select, insert, update, delete on public.student_questions to authenticated;
grant all on public.student_questions to service_role;

drop policy if exists "student_questions_select_school_management" on public.student_questions;
create policy "student_questions_select_school_management"
on public.student_questions
for select
to authenticated
using (public.can_manage_school(school_id));

drop policy if exists "student_questions_insert_school_management" on public.student_questions;
create policy "student_questions_insert_school_management"
on public.student_questions
for insert
to authenticated
with check (
  public.can_access_org(organization_id)
  and public.can_manage_school(school_id)
  and created_by = (select auth.uid())
);

drop policy if exists "student_questions_update_school_management" on public.student_questions;
create policy "student_questions_update_school_management"
on public.student_questions
for update
to authenticated
using (public.can_manage_school(school_id))
with check (
  public.can_access_org(organization_id)
  and public.can_manage_school(school_id)
);

drop policy if exists "student_questions_delete_school_management" on public.student_questions;
create policy "student_questions_delete_school_management"
on public.student_questions
for delete
to authenticated
using (public.can_manage_school(school_id));

notify pgrst, 'reload schema';
