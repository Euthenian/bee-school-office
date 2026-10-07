alter table public.student_questions
  add column source_type text;

alter table public.student_questions
  add constraint student_questions_source_type_check
  check (source_type is null or source_type = 'entrance_fee_unpaid');

comment on column public.student_questions.source_type is
'NULL identifies a manual question. entrance_fee_unpaid identifies the system reminder derived from collectible entrance-fee debt.';

create unique index student_questions_student_source_uidx
on public.student_questions (student_id, source_type)
where source_type is not null;

-- Staff may continue to manage manual questions, but financial reminders are
-- changed only by the billing synchronization trigger below.
drop policy "student_questions_insert_school_management" on public.student_questions;
create policy "student_questions_insert_school_management"
on public.student_questions for insert to authenticated
with check (
  source_type is null
  and public.can_access_org(organization_id)
  and public.can_manage_school(school_id)
  and created_by = (select auth.uid())
);

drop policy "student_questions_update_school_management" on public.student_questions;
create policy "student_questions_update_school_management"
on public.student_questions for update to authenticated
using (source_type is null and public.can_manage_school(school_id))
with check (
  source_type is null
  and public.can_access_org(organization_id)
  and public.can_manage_school(school_id)
);

drop policy "student_questions_delete_school_management" on public.student_questions;
create policy "student_questions_delete_school_management"
on public.student_questions for delete to authenticated
using (source_type is null and public.can_manage_school(school_id));

create function public.sync_entrance_fee_question(p_student_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_student public.students%rowtype;
  v_remaining numeric;
begin
  -- Serialize syncs for the same student, including concurrent charge and
  -- allocation changes, before checking the student's complete balance.
  select * into v_student
  from public.students
  where id = p_student_id
  for update;

  if not found then
    return;
  end if;

  select coalesce(sum(greatest(sc.amount - coalesce(allocations.amount, 0), 0)), 0)
  into v_remaining
  from public.student_charges sc
  left join lateral (
    select sum(spa.amount) as amount
    from public.student_payment_allocations spa
    join public.student_payments sp on sp.id = spa.student_payment_id
    where spa.student_charge_id = sc.id
      and sp.status <> 'void'
  ) allocations on true
  where sc.student_id = p_student_id
    and sc.charge_type = 'entrance_fee'
    and sc.status in ('open', 'partially_paid', 'paid')
    and sc.amount > 0;

  if v_remaining > 0 then
    insert into public.student_questions (
      organization_id, school_id, student_id, question, reminder_date,
      status, source_type, created_by
    ) values (
      v_student.organization_id, v_student.school_id, p_student_id,
      'Registration fee unpaid', current_date, 'open',
      'entrance_fee_unpaid', null
    )
    on conflict (student_id, source_type) where source_type is not null
    do update set
      status = 'open',
      completed_at = null,
      reminder_date = case
        when student_questions.status = 'done' then current_date
        else least(student_questions.reminder_date, current_date)
      end
    where student_questions.status = 'done'
      or student_questions.reminder_date > current_date;
  else
    update public.student_questions
    set status = 'done', completed_at = now()
    where student_id = p_student_id
      and source_type = 'entrance_fee_unpaid'
      and status = 'open';
  end if;
end;
$$;

revoke all on function public.sync_entrance_fee_question(uuid) from public, anon, authenticated;

create function public.sync_entrance_fee_question_from_billing()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    perform public.sync_entrance_fee_question(new.student_id);
  elsif tg_op = 'DELETE' then
    perform public.sync_entrance_fee_question(old.student_id);
  else
    perform public.sync_entrance_fee_question(old.student_id);
    if new.student_id is distinct from old.student_id then
      perform public.sync_entrance_fee_question(new.student_id);
    end if;
  end if;
  return null;
end;
$$;

revoke all on function public.sync_entrance_fee_question_from_billing() from public, anon, authenticated;

create trigger student_charges_sync_entrance_fee_question
after insert or update or delete on public.student_charges
for each row execute function public.sync_entrance_fee_question_from_billing();

create trigger student_payments_sync_entrance_fee_question
after insert or update or delete on public.student_payments
for each row execute function public.sync_entrance_fee_question_from_billing();

create trigger student_payment_allocations_sync_entrance_fee_question
after insert or update or delete on public.student_payment_allocations
for each row execute function public.sync_entrance_fee_question_from_billing();

-- Seed reminders for already outstanding fees without changing billing rows.
do $$
declare
  v_student_id uuid;
begin
  for v_student_id in
    select distinct student_id
    from public.student_charges
    where charge_type = 'entrance_fee'
  loop
    perform public.sync_entrance_fee_question(v_student_id);
  end loop;
end;
$$;

notify pgrst, 'reload schema';
