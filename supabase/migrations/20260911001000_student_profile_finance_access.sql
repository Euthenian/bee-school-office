create or replace function public.get_student_finance_mvp(p_student_id uuid)
returns table (
  student_id uuid,
  organization_id uuid,
  school_id uuid,
  monthly_fee_yen integer,
  currency char(3),
  postal_address text,
  bank_name text,
  branch_name text,
  account_type text,
  account_number_last4 text,
  has_bank_account boolean,
  can_view_full_bank_details boolean,
  can_edit_finance boolean,
  can_edit_bank_details boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_address public.student_addresses%rowtype;
  v_bank public.student_bank_accounts%rowtype;
  v_billing public.student_billing_profiles%rowtype;
  v_can_bank boolean;
  v_can_finance boolean;
  v_student public.students%rowtype;
begin
  select * into v_student
  from public.students st
  where st.id = p_student_id;

  if not found then
    raise exception 'Student finance details are not available.';
  end if;

  v_can_finance = public.can_manage_student_finance_org(v_student.organization_id, v_student.school_id);
  if not v_can_finance then
    raise exception 'You do not have permission to view student finance details.';
  end if;

  v_can_bank = public.can_manage_student_bank_accounts_org(v_student.organization_id, v_student.school_id);

  select * into v_billing
  from public.student_billing_profiles sbp
  where sbp.student_id = p_student_id
    and sbp.organization_id = v_student.organization_id
    and sbp.school_id = v_student.school_id
  order by sbp.updated_at desc, sbp.created_at desc
  limit 1;

  select * into v_address
  from public.student_addresses sa
  where sa.student_id = p_student_id
    and sa.organization_id = v_student.organization_id
    and sa.school_id = v_student.school_id
  order by sa.updated_at desc, sa.created_at desc
  limit 1;

  select * into v_bank
  from public.student_bank_accounts sba
  where sba.student_id = p_student_id
    and sba.organization_id = v_student.organization_id
    and sba.school_id = v_student.school_id
  order by sba.updated_at desc, sba.created_at desc
  limit 1;

  return query
  select
    v_student.id,
    v_student.organization_id,
    v_student.school_id,
    v_billing.monthly_fee_yen,
    coalesce(v_billing.currency, 'JPY'::char(3)),
    v_address.postal_address,
    v_bank.bank_name,
    v_bank.branch_name,
    v_bank.account_type,
    case
      when nullif(trim(coalesce(v_bank.account_number, '')), '') is null then null
      else right(v_bank.account_number, 4)
    end,
    v_bank.id is not null,
    v_can_bank,
    v_can_finance,
    v_can_bank;
end;
$$;

comment on function public.get_student_finance_mvp(uuid) is
'Student Profile finance summary. Returns billing/address and only masked bank-number material; full account values require get_student_bank_details_mvp.';

revoke all on function public.get_student_finance_mvp(uuid) from public, anon;
grant execute on function public.get_student_finance_mvp(uuid) to authenticated;

create or replace function public.get_student_bank_details_mvp(p_student_id uuid)
returns table (
  student_id uuid,
  organization_id uuid,
  school_id uuid,
  bank_name text,
  bank_code text,
  branch_name text,
  branch_name_yomigana text,
  branch_code text,
  account_type text,
  account_number text,
  account_holder_katakana text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_student public.students%rowtype;
begin
  select * into v_student
  from public.students st
  where st.id = p_student_id;

  if not found then
    raise exception 'Bank details are not available.';
  end if;

  if not public.can_manage_student_bank_accounts_org(v_student.organization_id, v_student.school_id) then
    raise exception 'You do not have permission to view bank details.';
  end if;

  return query
  select
    sba.student_id,
    sba.organization_id,
    sba.school_id,
    sba.bank_name,
    sba.bank_code,
    sba.branch_name,
    sba.branch_name_yomigana,
    sba.branch_code,
    sba.account_type,
    sba.account_number,
    sba.account_holder_katakana
  from public.student_bank_accounts sba
  where sba.student_id = p_student_id
    and sba.organization_id = v_student.organization_id
    and sba.school_id = v_student.school_id
  order by sba.updated_at desc, sba.created_at desc
  limit 1;
end;
$$;

comment on function public.get_student_bank_details_mvp(uuid) is
'Explicit full bank detail read for authorized finance administrators only. Office staff, teachers, anon, and cross-tenant users are denied by role and tenant checks.';

revoke all on function public.get_student_bank_details_mvp(uuid) from public, anon;
grant execute on function public.get_student_bank_details_mvp(uuid) to authenticated;

create or replace function public.update_student_finance_mvp(
  p_student_id uuid,
  p_monthly_fee_yen integer default null,
  p_postal_address text default null,
  p_replace_bank boolean default false,
  p_bank_name text default null,
  p_bank_code text default null,
  p_branch_name text default null,
  p_branch_name_yomigana text default null,
  p_branch_code text default null,
  p_account_type text default null,
  p_account_number text default null,
  p_account_holder_katakana text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_holder_katakana text;
  v_account_number text;
  v_account_type text;
  v_address_id uuid;
  v_bank_code text;
  v_bank_id uuid;
  v_bank_name text;
  v_billing_id uuid;
  v_branch_code text;
  v_branch_name text;
  v_branch_name_yomigana text;
  v_has_bank_payload boolean;
  v_postal_address text;
  v_student public.students%rowtype;
begin
  select * into v_student
  from public.students st
  where st.id = p_student_id
  for update;

  if not found then
    raise exception 'Student finance details are not available.';
  end if;

  if not public.can_manage_student_finance_org(v_student.organization_id, v_student.school_id) then
    raise exception 'You do not have permission to update student finance details.';
  end if;

  if p_monthly_fee_yen is not null and (p_monthly_fee_yen < 0 or p_monthly_fee_yen > 100000) then
    raise exception 'Monthly fee must be between 0 and 100000.';
  end if;

  v_postal_address = nullif(trim(coalesce(p_postal_address, '')), '');

  select sbp.id into v_billing_id
  from public.student_billing_profiles sbp
  where sbp.student_id = p_student_id
    and sbp.organization_id = v_student.organization_id
    and sbp.school_id = v_student.school_id
  order by sbp.updated_at desc, sbp.created_at desc
  limit 1
  for update;

  if v_billing_id is not null then
    update public.student_billing_profiles
    set monthly_fee_yen = p_monthly_fee_yen,
        currency = 'JPY'
    where id = v_billing_id;
  elsif p_monthly_fee_yen is not null then
    insert into public.student_billing_profiles (
      organization_id,
      school_id,
      student_id,
      monthly_fee_yen,
      currency,
      source_type
    )
    values (
      v_student.organization_id,
      v_student.school_id,
      p_student_id,
      p_monthly_fee_yen,
      'JPY',
      'manual'
    );
  end if;

  select sa.id into v_address_id
  from public.student_addresses sa
  where sa.student_id = p_student_id
    and sa.organization_id = v_student.organization_id
    and sa.school_id = v_student.school_id
  order by sa.updated_at desc, sa.created_at desc
  limit 1
  for update;

  if v_postal_address is null then
    if v_address_id is not null then
      delete from public.student_addresses
      where id = v_address_id;
    end if;
  elsif v_address_id is not null then
    update public.student_addresses
    set postal_address = v_postal_address
    where id = v_address_id;
  else
    insert into public.student_addresses (
      organization_id,
      school_id,
      student_id,
      postal_address,
      source_type
    )
    values (
      v_student.organization_id,
      v_student.school_id,
      p_student_id,
      v_postal_address,
      'manual'
    );
  end if;

  if p_replace_bank then
    if not public.can_manage_student_bank_accounts_org(v_student.organization_id, v_student.school_id) then
      raise exception 'You do not have permission to update bank details.';
    end if;

    v_bank_name = nullif(trim(coalesce(p_bank_name, '')), '');
    v_bank_code = nullif(trim(coalesce(p_bank_code, '')), '');
    v_branch_name = nullif(trim(coalesce(p_branch_name, '')), '');
    v_branch_name_yomigana = nullif(trim(coalesce(p_branch_name_yomigana, '')), '');
    v_branch_code = nullif(trim(coalesce(p_branch_code, '')), '');
    v_account_type = nullif(trim(coalesce(p_account_type, '')), '');
    v_account_number = nullif(trim(coalesce(p_account_number, '')), '');
    v_account_holder_katakana = nullif(trim(coalesce(p_account_holder_katakana, '')), '');
    v_has_bank_payload = v_bank_name is not null
      or v_bank_code is not null
      or v_branch_name is not null
      or v_branch_name_yomigana is not null
      or v_branch_code is not null
      or v_account_type is not null
      or v_account_number is not null
      or v_account_holder_katakana is not null;

    if v_account_type is not null and v_account_type not in ('ordinary', 'current') then
      raise exception 'Unsupported account type.';
    end if;

    if v_bank_code is not null and v_bank_code !~ '^[0-9]{4}$' then
      raise exception 'Bank code must be four digits.';
    end if;

    if v_branch_code is not null and v_branch_code !~ '^[0-9]{3}$' then
      raise exception 'Branch code must be three digits.';
    end if;

    if v_account_number is not null and v_account_number !~ '^[0-9]{7}$' then
      raise exception 'Account number must be seven digits.';
    end if;

    select sba.id into v_bank_id
    from public.student_bank_accounts sba
    where sba.student_id = p_student_id
      and sba.organization_id = v_student.organization_id
      and sba.school_id = v_student.school_id
    order by sba.updated_at desc, sba.created_at desc
    limit 1
    for update;

    if not v_has_bank_payload then
      if v_bank_id is not null then
        delete from public.student_bank_accounts
        where id = v_bank_id;
      end if;
    elsif v_bank_id is not null then
      update public.student_bank_accounts
      set bank_name = v_bank_name,
          bank_code = v_bank_code,
          branch_name = v_branch_name,
          branch_name_yomigana = v_branch_name_yomigana,
          branch_code = v_branch_code,
          account_type = v_account_type,
          account_number = v_account_number,
          account_holder_katakana = v_account_holder_katakana
      where id = v_bank_id;
    else
      insert into public.student_bank_accounts (
        organization_id,
        school_id,
        student_id,
        bank_name,
        bank_code,
        branch_name,
        branch_name_yomigana,
        branch_code,
        account_type,
        account_number,
        account_holder_katakana,
        source_type
      )
      values (
        v_student.organization_id,
        v_student.school_id,
        p_student_id,
        v_bank_name,
        v_bank_code,
        v_branch_name,
        v_branch_name_yomigana,
        v_branch_code,
        v_account_type,
        v_account_number,
        v_account_holder_katakana,
        'manual'
      );
    end if;
  end if;

  return p_student_id;
end;
$$;

comment on function public.update_student_finance_mvp(uuid, integer, text, boolean, text, text, text, text, text, text, text, text) is
'Atomic Student Profile finance update. Billing/address writes require finance access; bank writes additionally require the restricted bank-account role helper.';

revoke all on function public.update_student_finance_mvp(uuid, integer, text, boolean, text, text, text, text, text, text, text, text) from public, anon;
grant execute on function public.update_student_finance_mvp(uuid, integer, text, boolean, text, text, text, text, text, text, text, text) to authenticated;

notify pgrst, 'reload schema';
