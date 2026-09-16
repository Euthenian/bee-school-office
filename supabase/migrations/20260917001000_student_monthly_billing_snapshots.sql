alter table public.student_billing_profiles
  add column if not exists billing_start_date date,
  add column if not exists billing_end_date date;

alter table public.student_billing_profiles
  drop constraint if exists student_billing_profiles_billing_dates_check;

alter table public.student_billing_profiles
  add constraint student_billing_profiles_billing_dates_check
  check (billing_end_date is null or billing_start_date is null or billing_end_date >= billing_start_date);

comment on column public.student_billing_profiles.monthly_fee_yen is
'Canonical default monthly fee copied into monthly billing snapshots when a month is generated.';

comment on column public.student_billing_profiles.billing_end_date is
'Effective final billable date. Months starting after this date must generate as zero-yen snapshots.';

create table if not exists public.student_monthly_billing_snapshots (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  school_id uuid not null,
  student_id uuid not null,
  billing_month date not null,
  source_billing_profile_id uuid,
  default_monthly_fee_yen integer,
  billing_start_date date,
  billing_end_date date,
  base_amount numeric(12, 2) not null default 0,
  final_amount numeric(12, 2) not null default 0,
  refund_amount numeric(12, 2) not null default 0,
  currency char(3) not null default 'JPY',
  comment text,
  manual_override boolean not null default false,
  override_reason text,
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (student_id, billing_month),
  unique (id, organization_id, school_id, student_id),
  foreign key (student_id, organization_id, school_id)
    references public.students (id, organization_id, school_id)
    on delete restrict,
  constraint student_monthly_billing_snapshots_profile_fkey
    foreign key (source_billing_profile_id, organization_id, school_id, student_id)
    references public.student_billing_profiles (id, organization_id, school_id, student_id)
    on delete restrict,
  constraint student_monthly_billing_snapshots_month_start_check
    check (billing_month = date_trunc('month', billing_month)::date),
  constraint student_monthly_billing_snapshots_amount_check
    check (base_amount >= 0 and final_amount >= 0 and refund_amount >= 0),
  constraint student_monthly_billing_snapshots_currency_check
    check (currency ~ '^[A-Z]{3}$')
);

create index if not exists student_monthly_billing_snapshots_school_month_idx
on public.student_monthly_billing_snapshots (school_id, billing_month);

create index if not exists student_monthly_billing_snapshots_student_month_idx
on public.student_monthly_billing_snapshots (student_id, billing_month desc);

comment on table public.student_monthly_billing_snapshots is
'Per-student monthly billing snapshots. The default monthly fee is copied at generation time and later profile changes do not rewrite historical months.';

drop trigger if exists student_monthly_billing_snapshots_set_updated_at on public.student_monthly_billing_snapshots;
create trigger student_monthly_billing_snapshots_set_updated_at
before update on public.student_monthly_billing_snapshots
for each row execute function public.set_updated_at();

alter table public.student_monthly_billing_snapshots enable row level security;

revoke all on public.student_monthly_billing_snapshots from anon, authenticated;
grant select, insert, update on public.student_monthly_billing_snapshots to authenticated;
grant all on public.student_monthly_billing_snapshots to service_role;

drop policy if exists "student_monthly_billing_snapshots_billing_access" on public.student_monthly_billing_snapshots;
create policy "student_monthly_billing_snapshots_billing_access"
on public.student_monthly_billing_snapshots
for all
to authenticated
using (public.can_manage_student_billing_org(organization_id))
with check (public.can_manage_student_billing_org(organization_id));

create or replace function public.get_monthly_billing_month_start(p_billing_month date)
returns date
language sql
immutable
set search_path = public
as $$
  select date_trunc('month', coalesce(p_billing_month, current_date))::date;
$$;

revoke all on function public.get_monthly_billing_month_start(date) from public, anon, authenticated;

create or replace function public.get_student_monthly_billing_stop_alerts_mvp(
  p_organization_id uuid,
  p_school_id uuid default null,
  p_reference_month date default current_date
)
returns table (
  student_id uuid,
  school_id uuid,
  student_name text,
  student_status public.student_status,
  default_monthly_fee_yen integer,
  billing_end_date date,
  alert_timing text
)
language plpgsql
stable
set search_path = public
as $$
declare
  v_month_start date := public.get_monthly_billing_month_start(p_reference_month);
  v_next_month_start date := (public.get_monthly_billing_month_start(p_reference_month) + interval '1 month')::date;
  v_following_month_start date := (public.get_monthly_billing_month_start(p_reference_month) + interval '2 months')::date;
begin
  if p_organization_id is null then
    raise exception 'Organization is required.';
  end if;

  if not public.can_manage_student_billing_org(p_organization_id) then
    raise exception 'You do not have permission to manage billing for this organization.';
  end if;

  return query
  select
    st.id,
    st.school_id,
    trim(concat_ws(' ', st.last_name, st.first_name, nullif(st.preferred_name, ''))),
    st.status,
    sbp.monthly_fee_yen,
    sbp.billing_end_date,
    case
      when sbp.billing_end_date >= v_month_start and sbp.billing_end_date < v_next_month_start then 'this_month'
      when sbp.billing_end_date >= v_next_month_start and sbp.billing_end_date < v_following_month_start then 'next_month'
      else ''
    end
  from public.student_billing_profiles sbp
  join public.students st on st.id = sbp.student_id
    and st.organization_id = sbp.organization_id
    and st.school_id = sbp.school_id
  where sbp.organization_id = p_organization_id
    and (p_school_id is null or sbp.school_id = p_school_id)
    and sbp.billing_end_date is not null
    and sbp.billing_end_date >= v_month_start
    and sbp.billing_end_date < v_following_month_start
  order by sbp.billing_end_date, st.last_name, st.first_name;
end;
$$;

revoke all on function public.get_student_monthly_billing_stop_alerts_mvp(uuid, uuid, date) from public, anon;
grant execute on function public.get_student_monthly_billing_stop_alerts_mvp(uuid, uuid, date) to authenticated;

create or replace function public.create_student_monthly_billing_snapshots_mvp(
  p_organization_id uuid,
  p_school_id uuid default null,
  p_billing_month date default current_date
)
returns table (
  billing_month date,
  inserted_count integer,
  existing_count integer,
  zero_amount_count integer,
  upcoming_billing_change_count integer
)
language plpgsql
set search_path = public
as $$
declare
  v_inserted_count integer := 0;
  v_month_start date := public.get_monthly_billing_month_start(p_billing_month);
  v_upcoming_count integer := 0;
  v_zero_count integer := 0;
begin
  if p_organization_id is null then
    raise exception 'Organization is required.';
  end if;

  if not public.can_manage_student_billing_org(p_organization_id) then
    raise exception 'You do not have permission to manage billing for this organization.';
  end if;

  with latest_profiles as (
    select distinct on (sbp.student_id)
      sbp.*
    from public.student_billing_profiles sbp
    where sbp.organization_id = p_organization_id
      and (p_school_id is null or sbp.school_id = p_school_id)
    order by sbp.student_id, sbp.updated_at desc, sbp.created_at desc
  ),
  candidates as (
    select
      st.organization_id,
      st.school_id,
      st.id as student_id,
      lp.id as source_billing_profile_id,
      lp.monthly_fee_yen,
      lp.billing_start_date,
      lp.billing_end_date,
      coalesce(lp.currency, 'JPY'::char(3)) as currency,
      case
        when lp.billing_end_date is not null and lp.billing_end_date < v_month_start then 0::numeric
        else coalesce(lp.monthly_fee_yen, 0)::numeric
      end as snapshot_amount
    from public.students st
    left join latest_profiles lp on lp.student_id = st.id
      and lp.organization_id = st.organization_id
      and lp.school_id = st.school_id
    where st.organization_id = p_organization_id
      and (p_school_id is null or st.school_id = p_school_id)
      and (
        lp.id is not null
        or st.status in ('active', 'pending', 'paused')
      )
      and (lp.billing_start_date is null or lp.billing_start_date < (v_month_start + interval '1 month')::date)
  ),
  inserted as (
    insert into public.student_monthly_billing_snapshots (
      organization_id,
      school_id,
      student_id,
      billing_month,
      source_billing_profile_id,
      default_monthly_fee_yen,
      billing_start_date,
      billing_end_date,
      base_amount,
      final_amount,
      refund_amount,
      currency,
      created_by,
      updated_by
    )
    select
      c.organization_id,
      c.school_id,
      c.student_id,
      v_month_start,
      c.source_billing_profile_id,
      c.monthly_fee_yen,
      c.billing_start_date,
      c.billing_end_date,
      c.snapshot_amount,
      c.snapshot_amount,
      0,
      c.currency,
      (select auth.uid()),
      (select auth.uid())
    from candidates c
    on conflict (student_id, billing_month) do nothing
    returning id, final_amount
  )
  select count(*)::integer, count(*) filter (where final_amount = 0)::integer
  into v_inserted_count, v_zero_count
  from inserted;

  select count(*)::integer into v_upcoming_count
  from public.get_student_monthly_billing_stop_alerts_mvp(p_organization_id, p_school_id, v_month_start);

  return query
  select
    v_month_start,
    v_inserted_count,
    (
      select count(*)::integer
      from public.student_monthly_billing_snapshots smbs
      where smbs.organization_id = p_organization_id
        and (p_school_id is null or smbs.school_id = p_school_id)
        and smbs.billing_month = v_month_start
    ) - v_inserted_count,
    v_zero_count,
    v_upcoming_count;
end;
$$;

revoke all on function public.create_student_monthly_billing_snapshots_mvp(uuid, uuid, date) from public, anon;
grant execute on function public.create_student_monthly_billing_snapshots_mvp(uuid, uuid, date) to authenticated;

create or replace function public.update_student_monthly_billing_snapshot_mvp(
  p_snapshot_id uuid,
  p_final_amount numeric default null,
  p_comment text default null,
  p_refund_amount numeric default 0,
  p_override_reason text default null
)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_comment text;
  v_final_amount numeric(12, 2);
  v_refund_amount numeric(12, 2);
  v_snapshot public.student_monthly_billing_snapshots%rowtype;
begin
  select * into v_snapshot
  from public.student_monthly_billing_snapshots smbs
  where smbs.id = p_snapshot_id
  for update;

  if not found then
    raise exception 'Monthly billing snapshot % was not found.', p_snapshot_id;
  end if;

  if not public.can_manage_student_billing_org(v_snapshot.organization_id) then
    raise exception 'You do not have permission to manage billing for this organization.';
  end if;

  v_final_amount = coalesce(p_final_amount, v_snapshot.final_amount);
  v_refund_amount = coalesce(p_refund_amount, 0);
  v_comment = nullif(trim(coalesce(p_comment, '')), '');

  if v_final_amount < 0 then
    raise exception 'Monthly payment cannot be negative.';
  end if;

  if v_refund_amount < 0 then
    raise exception 'Refund amount cannot be negative.';
  end if;

  update public.student_monthly_billing_snapshots
  set final_amount = v_final_amount,
      refund_amount = v_refund_amount,
      comment = v_comment,
      override_reason = nullif(trim(coalesce(p_override_reason, '')), ''),
      manual_override = (
        v_final_amount <> base_amount
        or v_refund_amount <> 0
        or v_comment is not null
        or nullif(trim(coalesce(p_override_reason, '')), '') is not null
      ),
      updated_by = (select auth.uid())
  where id = p_snapshot_id;

  return p_snapshot_id;
end;
$$;

revoke all on function public.update_student_monthly_billing_snapshot_mvp(uuid, numeric, text, numeric, text) from public, anon;
grant execute on function public.update_student_monthly_billing_snapshot_mvp(uuid, numeric, text, numeric, text) to authenticated;

create or replace function public.get_student_monthly_billing_snapshots_mvp(
  p_organization_id uuid,
  p_school_id uuid default null,
  p_billing_month date default current_date
)
returns table (
  id uuid,
  organization_id uuid,
  school_id uuid,
  school_name text,
  student_id uuid,
  student_first_name text,
  student_last_name text,
  student_preferred_name text,
  student_status public.student_status,
  billing_month date,
  default_monthly_fee_yen integer,
  current_default_monthly_fee_yen integer,
  billing_start_date date,
  billing_end_date date,
  current_billing_end_date date,
  base_amount numeric,
  final_amount numeric,
  refund_amount numeric,
  currency char(3),
  comment text,
  manual_override boolean,
  override_reason text,
  billing_change_timing text,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
stable
set search_path = public
as $$
declare
  v_month_start date := public.get_monthly_billing_month_start(p_billing_month);
  v_next_month_start date := (public.get_monthly_billing_month_start(p_billing_month) + interval '1 month')::date;
  v_following_month_start date := (public.get_monthly_billing_month_start(p_billing_month) + interval '2 months')::date;
begin
  if p_organization_id is null then
    raise exception 'Organization is required.';
  end if;

  if not public.can_manage_student_billing_org(p_organization_id) then
    raise exception 'You do not have permission to manage billing for this organization.';
  end if;

  return query
  with latest_profiles as (
    select distinct on (sbp.student_id)
      sbp.student_id,
      sbp.monthly_fee_yen,
      sbp.billing_end_date
    from public.student_billing_profiles sbp
    where sbp.organization_id = p_organization_id
      and (p_school_id is null or sbp.school_id = p_school_id)
    order by sbp.student_id, sbp.updated_at desc, sbp.created_at desc
  )
  select
    smbs.id,
    smbs.organization_id,
    smbs.school_id,
    s.name,
    st.id,
    st.first_name,
    st.last_name,
    st.preferred_name,
    st.status,
    smbs.billing_month,
    smbs.default_monthly_fee_yen,
    lp.monthly_fee_yen,
    smbs.billing_start_date,
    smbs.billing_end_date,
    lp.billing_end_date,
    smbs.base_amount,
    smbs.final_amount,
    smbs.refund_amount,
    smbs.currency,
    smbs.comment,
    smbs.manual_override,
    smbs.override_reason,
    case
      when coalesce(lp.billing_end_date, smbs.billing_end_date) >= v_month_start
        and coalesce(lp.billing_end_date, smbs.billing_end_date) < v_next_month_start
        then 'this_month'
      when coalesce(lp.billing_end_date, smbs.billing_end_date) >= v_next_month_start
        and coalesce(lp.billing_end_date, smbs.billing_end_date) < v_following_month_start
        then 'next_month'
      else ''
    end,
    smbs.created_at,
    smbs.updated_at
  from public.student_monthly_billing_snapshots smbs
  join public.students st on st.id = smbs.student_id
    and st.organization_id = smbs.organization_id
    and st.school_id = smbs.school_id
  join public.schools s on s.id = smbs.school_id
    and s.organization_id = smbs.organization_id
  left join latest_profiles lp on lp.student_id = smbs.student_id
  where smbs.organization_id = p_organization_id
    and (p_school_id is null or smbs.school_id = p_school_id)
    and smbs.billing_month = v_month_start
  order by s.name, st.last_name, st.first_name;
end;
$$;

revoke all on function public.get_student_monthly_billing_snapshots_mvp(uuid, uuid, date) from public, anon;
grant execute on function public.get_student_monthly_billing_snapshots_mvp(uuid, uuid, date) to authenticated;

drop function if exists public.get_student_finance_mvp(uuid);

create or replace function public.get_student_finance_mvp(p_student_id uuid)
returns table (
  student_id uuid,
  organization_id uuid,
  school_id uuid,
  monthly_fee_yen integer,
  billing_start_date date,
  billing_end_date date,
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
    v_billing.billing_start_date,
    v_billing.billing_end_date,
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
'Student Profile finance summary. Returns billing profile start/end dates, address, and only masked bank-number material; full account values require get_student_bank_details_mvp.';

revoke all on function public.get_student_finance_mvp(uuid) from public, anon;
grant execute on function public.get_student_finance_mvp(uuid) to authenticated;

drop function if exists public.update_student_finance_mvp(uuid, integer, text, boolean, text, text, text, text, text, text, text, text);

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
  p_account_holder_katakana text default null,
  p_billing_start_date date default null,
  p_billing_end_date date default null
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
  v_has_billing_payload boolean;
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

  if p_billing_end_date is not null and p_billing_start_date is not null and p_billing_end_date < p_billing_start_date then
    raise exception 'Billing end date cannot be before billing start date.';
  end if;

  v_postal_address = nullif(trim(coalesce(p_postal_address, '')), '');
  v_has_billing_payload = p_monthly_fee_yen is not null
    or p_billing_start_date is not null
    or p_billing_end_date is not null;

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
        billing_start_date = p_billing_start_date,
        billing_end_date = p_billing_end_date,
        currency = 'JPY'
    where id = v_billing_id;
  elsif v_has_billing_payload then
    insert into public.student_billing_profiles (
      organization_id,
      school_id,
      student_id,
      monthly_fee_yen,
      billing_start_date,
      billing_end_date,
      currency,
      source_type
    )
    values (
      v_student.organization_id,
      v_student.school_id,
      p_student_id,
      p_monthly_fee_yen,
      p_billing_start_date,
      p_billing_end_date,
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

comment on function public.update_student_finance_mvp(uuid, integer, text, boolean, text, text, text, text, text, text, text, text, date, date) is
'Atomic Student Profile finance update. Billing profile writes now include default monthly fee plus billing start/end dates used by monthly billing snapshots.';

revoke all on function public.update_student_finance_mvp(uuid, integer, text, boolean, text, text, text, text, text, text, text, text, date, date) from public, anon;
grant execute on function public.update_student_finance_mvp(uuid, integer, text, boolean, text, text, text, text, text, text, text, text, date, date) to authenticated;

notify pgrst, 'reload schema';
