alter table public.students
  add column if not exists last_lesson_date date;

comment on column public.students.last_lesson_date is
'Student lifecycle source of truth for the final lesson date. The containing month remains billable; later months should not expect normal monthly tuition.';

with latest_billing as (
  select distinct on (sbp.student_id, sbp.organization_id, sbp.school_id)
    sbp.student_id,
    sbp.organization_id,
    sbp.school_id,
    sbp.billing_end_date
  from public.student_billing_profiles sbp
  where sbp.billing_end_date is not null
  order by sbp.student_id, sbp.organization_id, sbp.school_id, sbp.updated_at desc, sbp.created_at desc
)
update public.students st
set last_lesson_date = latest_billing.billing_end_date
from latest_billing
where st.id = latest_billing.student_id
  and st.organization_id = latest_billing.organization_id
  and st.school_id = latest_billing.school_id
  and st.last_lesson_date is null;

drop function if exists public.create_student_with_class_assignment_mvp(uuid, text, text, text, public.student_status, date, date, smallint, jsonb, uuid, integer, uuid, public.class_lesson_type, text, boolean, uuid, public.class_lesson_day, time, text, text, citext, text, text, uuid);

create or replace function public.create_student_with_class_assignment_mvp(
  p_school_id uuid,
  p_first_name text,
  p_last_name text,
  p_preferred_name text default null,
  p_status public.student_status default 'active',
  p_start_date date default null,
  p_last_lesson_date date default null,
  p_legacy_customer_id text default null,
  p_date_of_birth date default null,
  p_age_override smallint default null,
  p_contacts jsonb default '[]'::jsonb,
  p_billing_plan_id uuid default null,
  p_monthly_fee_yen integer default null,
  p_assigned_teacher_profile_id uuid default null,
  p_lesson_type public.class_lesson_type default null,
  p_class_level_id text default null,
  p_create_new_class boolean default false,
  p_existing_class_id uuid default null,
  p_lesson_day public.class_lesson_day default null,
  p_lesson_time time default null,
  p_guardian_full_name text default null,
  p_guardian_relationship text default null,
  p_guardian_email citext default null,
  p_guardian_phone text default null,
  p_internal_note text default null,
  p_assigned_teacher_staff_id uuid default null
)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_organization_id uuid;
  v_student_id uuid;
begin
  v_student_id = public.create_student_mvp(
    p_school_id,
    p_first_name,
    p_last_name,
    p_preferred_name,
    p_status,
    p_start_date,
    p_date_of_birth,
    p_age_override,
    p_contacts,
    null,
    null,
    null,
    null,
    null,
    p_guardian_full_name,
    p_guardian_relationship,
    p_guardian_email,
    p_guardian_phone,
    p_internal_note
  );

  update public.students st
  set last_lesson_date = p_last_lesson_date,
      legacy_customer_id = nullif(trim(coalesce(p_legacy_customer_id, '')), '')
  where st.id = v_student_id
  returning st.organization_id into v_organization_id;

  perform public.assign_student_to_class_mvp(
    v_student_id,
    p_school_id,
    p_status,
    p_start_date,
    p_existing_class_id,
    p_create_new_class,
    p_assigned_teacher_profile_id,
    p_lesson_type,
    p_class_level_id,
    p_lesson_day,
    p_lesson_time,
    p_billing_plan_id,
    p_assigned_teacher_staff_id
  );

  perform public.update_student_class_assignment_billing_mvp(
    v_student_id,
    p_billing_plan_id,
    p_monthly_fee_yen
  );

  update public.student_billing_profiles sbp
  set billing_end_date = p_last_lesson_date
  where sbp.student_id = v_student_id
    and sbp.organization_id = v_organization_id
    and sbp.school_id = p_school_id;

  return v_student_id;
end;
$$;

revoke all on function public.create_student_with_class_assignment_mvp(
  uuid,
  text,
  text,
  text,
  public.student_status,
  date,
  date,
  text,
  date,
  smallint,
  jsonb,
  uuid,
  integer,
  uuid,
  public.class_lesson_type,
  text,
  boolean,
  uuid,
  public.class_lesson_day,
  time,
  text,
  text,
  citext,
  text,
  text,
  uuid
) from public, anon;

grant execute on function public.create_student_with_class_assignment_mvp(
  uuid,
  text,
  text,
  text,
  public.student_status,
  date,
  date,
  text,
  date,
  smallint,
  jsonb,
  uuid,
  integer,
  uuid,
  public.class_lesson_type,
  text,
  boolean,
  uuid,
  public.class_lesson_day,
  time,
  text,
  text,
  citext,
  text,
  text,
  uuid
) to authenticated;

drop function if exists public.update_student_with_class_assignment_mvp(uuid, uuid, text, text, text, public.student_status, date, date, smallint, jsonb, uuid, integer, uuid, public.class_lesson_type, text, boolean, uuid, public.class_lesson_day, time, jsonb, jsonb, uuid);

create or replace function public.update_student_with_class_assignment_mvp(
  p_student_id uuid,
  p_school_id uuid,
  p_first_name text,
  p_last_name text,
  p_preferred_name text default null,
  p_status public.student_status default 'active',
  p_start_date date default null,
  p_last_lesson_date date default null,
  p_legacy_customer_id text default null,
  p_date_of_birth date default null,
  p_age_override smallint default null,
  p_contacts jsonb default '[]'::jsonb,
  p_billing_plan_id uuid default null,
  p_monthly_fee_yen integer default null,
  p_assigned_teacher_profile_id uuid default null,
  p_lesson_type public.class_lesson_type default null,
  p_class_level_id text default null,
  p_create_new_class boolean default false,
  p_existing_class_id uuid default null,
  p_lesson_day public.class_lesson_day default null,
  p_lesson_time time default null,
  p_guardians jsonb default '[]'::jsonb,
  p_notes jsonb default '[]'::jsonb,
  p_assigned_teacher_staff_id uuid default null
)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_organization_id uuid;
  v_student_id uuid;
  v_student_school_id uuid;
begin
  v_student_id = public.update_student_mvp(
    p_student_id,
    p_school_id,
    p_first_name,
    p_last_name,
    p_preferred_name,
    p_status,
    p_start_date,
    p_date_of_birth,
    p_age_override,
    p_contacts,
    null,
    null,
    null,
    null,
    null,
    p_guardians,
    p_notes
  );

  update public.students st
  set last_lesson_date = p_last_lesson_date,
      legacy_customer_id = nullif(trim(coalesce(p_legacy_customer_id, '')), '')
  where st.id = p_student_id
  returning st.organization_id, st.school_id into v_organization_id, v_student_school_id;

  perform public.assign_student_to_class_mvp(
    p_student_id,
    p_school_id,
    p_status,
    p_start_date,
    p_existing_class_id,
    p_create_new_class,
    p_assigned_teacher_profile_id,
    p_lesson_type,
    p_class_level_id,
    p_lesson_day,
    p_lesson_time,
    p_billing_plan_id,
    p_assigned_teacher_staff_id
  );

  perform public.update_student_class_assignment_billing_mvp(
    p_student_id,
    p_billing_plan_id,
    p_monthly_fee_yen
  );

  update public.student_billing_profiles sbp
  set billing_end_date = p_last_lesson_date
  where sbp.student_id = p_student_id
    and sbp.organization_id = v_organization_id
    and sbp.school_id = v_student_school_id;

  return v_student_id;
end;
$$;

revoke all on function public.update_student_with_class_assignment_mvp(
  uuid,
  uuid,
  text,
  text,
  text,
  public.student_status,
  date,
  date,
  text,
  date,
  smallint,
  jsonb,
  uuid,
  integer,
  uuid,
  public.class_lesson_type,
  text,
  boolean,
  uuid,
  public.class_lesson_day,
  time,
  jsonb,
  jsonb,
  uuid
) from public, anon;

grant execute on function public.update_student_with_class_assignment_mvp(
  uuid,
  uuid,
  text,
  text,
  text,
  public.student_status,
  date,
  date,
  text,
  date,
  smallint,
  jsonb,
  uuid,
  integer,
  uuid,
  public.class_lesson_type,
  text,
  boolean,
  uuid,
  public.class_lesson_day,
  time,
  jsonb,
  jsonb,
  uuid
) to authenticated;

notify pgrst, 'reload schema';
