-- Keep the existing converted package with a missing student untouched until staff
-- identify the right person. NOT VALID enforces the rule for future writes while
-- allowing that legacy row to be repaired through the conversion RPC below.
alter table public.trial_packages
  add constraint trial_packages_converted_student_required
  check (status <> 'converted' or converted_student_id is not null) not valid;

create or replace function public.convert_trial_package_to_student_mvp(
  p_trial_package_id uuid,
  p_existing_student_id uuid default null,
  p_first_name text default null,
  p_last_name text default null,
  p_preferred_name text default null,
  p_activate_existing boolean default false
)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_first_name text := nullif(trim(coalesce(p_first_name, '')), '');
  v_last_name text := nullif(trim(coalesce(p_last_name, '')), '');
  v_preferred_name text := nullif(trim(coalesce(p_preferred_name, '')), '');
  v_package public.trial_packages%rowtype;
  v_prospect public.prospects%rowtype;
  v_student_id uuid;
  v_student_status public.student_status;
begin
  if p_trial_package_id is null then
    raise exception 'Trial package is required.';
  end if;

  select * into v_package
  from public.trial_packages tp
  where tp.id = p_trial_package_id
  for update;

  if not found then
    raise exception 'Trial package % was not found.', p_trial_package_id;
  end if;

  if not public.can_manage_school(v_package.school_id) then
    raise exception 'You do not have permission to convert this trial package.';
  end if;

  -- Serializes conversions of separate packages for the same prospect.
  select * into v_prospect
  from public.prospects pr
  where pr.id = v_package.prospect_id
    and pr.organization_id = v_package.organization_id
    and pr.school_id = v_package.school_id
  for update;

  if not found then
    raise exception 'The package prospect is not in the same organization and school.';
  end if;

  if v_package.converted_student_id is not null then
    if p_existing_student_id is not null and p_existing_student_id <> v_package.converted_student_id then
      raise exception 'This package is already linked to another student.';
    end if;

    update public.trial_packages
    set status = 'converted', updated_at = now()
    where id = v_package.id and status <> 'converted';
    return v_package.converted_student_id;
  end if;

  -- A prospect may represent siblings. Staff must identify the student for
  -- each package; another package's link is not enough to choose a child.
  if p_existing_student_id is not null then
    v_student_id := p_existing_student_id;
  else
    if v_first_name is null or v_last_name is null then
      raise exception 'Student first name and last name are required to create a student.';
    end if;

    if exists (
      select 1
      from public.students st
      where st.organization_id = v_package.organization_id
        and st.school_id = v_package.school_id
        and (
          (lower(trim(st.first_name)) = lower(v_first_name)
            and lower(trim(st.last_name)) = lower(v_last_name))
          or (v_preferred_name is not null and (
            lower(trim(coalesce(st.preferred_name, ''))) = lower(v_preferred_name)
            or lower(trim(coalesce(st.legacy_japanese_name, ''))) = lower(v_preferred_name)
          ))
        )
    ) then
      raise exception 'A student with this name already exists in this school. Select the existing student instead.';
    end if;

    insert into public.students (
      organization_id, school_id, first_name, last_name, preferred_name, status
    ) values (
      v_package.organization_id, v_package.school_id,
      v_first_name, v_last_name, v_preferred_name, 'active'
    ) returning id into v_student_id;

    insert into public.student_contacts (student_id, contact_type, label, value, is_primary)
    select v_student_id, pc.contact_type, pc.label, pc.value, pc.is_primary
    from public.prospect_contacts pc
    where pc.prospect_id = v_prospect.id;
  end if;

  if p_existing_student_id is not null then
    select st.status into v_student_status
    from public.students st
    where st.id = v_student_id
      and st.organization_id = v_package.organization_id
      and st.school_id = v_package.school_id
    for update;

    if not found then
      raise exception 'The selected student must belong to this package school.';
    end if;

    if v_student_status in ('withdrawn', 'graduated') then
      raise exception 'A withdrawn or graduated student needs a separate re-enrollment review.';
    end if;

    if v_student_status <> 'active' then
      if not p_activate_existing then
        raise exception 'Confirm that the existing student should become Active before conversion.';
      end if;
      update public.students set status = 'active', updated_at = now() where id = v_student_id;
    end if;
  end if;

  update public.trial_packages
  set status = 'converted', converted_student_id = v_student_id, updated_at = now()
  where id = v_package.id;

  return v_student_id;
end;
$$;

revoke all on function public.convert_trial_package_to_student_mvp(uuid, uuid, text, text, text, boolean) from public, anon;
grant execute on function public.convert_trial_package_to_student_mvp(uuid, uuid, text, text, text, boolean) to authenticated;

-- Retain this RPC for ordinary status edits, but route conversion through the
-- atomic conversion RPC. Repeating a status edit must never erase its link.
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

  if p_converted_student_id is not null
     and p_converted_student_id is distinct from v_package.converted_student_id then
    raise exception 'Use trial package conversion to link a student.';
  end if;

  if p_status = 'converted' and v_package.converted_student_id is null then
    raise exception 'Convert the package to a student before marking it Converted.';
  end if;

  update public.trial_packages
  set status = p_status, updated_at = now()
  where id = v_package.id;

  return v_package.id;
end;
$$;

notify pgrst, 'reload schema';
