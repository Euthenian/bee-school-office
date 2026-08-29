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
  if not exists (select 1 from auth.users au where au.id = p_admin_user_id) then
    raise exception 'Auth user % does not exist. Create the Supabase Auth user before bootstrapping.', p_admin_user_id;
  end if;

  select o.id into v_organization_id
  from public.organizations o
  where o.type = 'hq'
    and o.name = 'Bee School HQ'
  limit 1;

  if v_organization_id is null then
    insert into public.organizations (name, type, status)
    values ('Bee School HQ', 'hq', 'active')
    returning id into v_organization_id;
  end if;

  select s.id into v_school_id
  from public.schools s
  where s.organization_id = v_organization_id
    and s.name = 'Ohashi'
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

revoke all on function public.bootstrap_bee_school_hq(uuid, citext, text) from public, anon, authenticated;
grant execute on function public.bootstrap_bee_school_hq(uuid, citext, text) to service_role;
