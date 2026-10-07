alter table public.student_charges
  add column collection_treatment text;

alter table public.student_charges
  add constraint student_charges_collection_treatment_check
  check (collection_treatment in ('additional', 'separate'));

comment on column public.student_charges.collection_treatment is
'Explicit RICO collection treatment. NULL is legacy/unclassified and is never automatically added to a monthly snapshot.';

create or replace function public.create_student_charge_for_collection_mvp(
  p_collection_treatment text,
  p_student_id uuid,
  p_billing_period_start date default null,
  p_billing_period_end date default null,
  p_charge_type text default 'other',
  p_description text default null,
  p_amount numeric default 0,
  p_currency text default 'JPY',
  p_due_date date default null,
  p_status text default 'open',
  p_source_type text default null,
  p_source_id uuid default null,
  p_notes text default null
)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_charge_id uuid;
begin
  if p_collection_treatment not in ('additional', 'separate') or p_collection_treatment is null then
    raise exception 'Choose an explicit collection treatment.';
  end if;
  if p_collection_treatment = 'additional' and
    (upper(coalesce(p_currency, 'JPY')) <> 'JPY' or
      p_amount < 0 or
      (p_billing_period_start is null and p_billing_period_end is null and p_due_date is null)) then
    raise exception 'Additional RICO charges require a nonnegative JPY amount and a billing period or due date.';
  end if;

  v_charge_id := public.create_student_charge_mvp(
    p_student_id, p_billing_period_start, p_billing_period_end, p_charge_type,
    p_description, p_amount, p_currency, p_due_date, p_status,
    p_source_type, p_source_id, p_notes
  );
  update public.student_charges
  set collection_treatment = p_collection_treatment
  where id = v_charge_id;
  return v_charge_id;
end;
$$;

revoke all on function public.create_student_charge_for_collection_mvp(text, uuid, date, date, text, text, numeric, text, date, text, text, uuid, text) from public, anon;
grant execute on function public.create_student_charge_for_collection_mvp(text, uuid, date, date, text, text, numeric, text, date, text, text, uuid, text) to authenticated;

create or replace function public.get_student_monthly_collection_charges_mvp(
  p_organization_id uuid,
  p_school_id uuid default null,
  p_billing_month date default current_date
)
returns table (
  student_id uuid,
  charge_id uuid,
  description text,
  charge_type text,
  collection_treatment text,
  amount numeric,
  allocated_amount numeric,
  balance numeric
)
language plpgsql
stable
set search_path = public
as $$
declare
  v_month_start date := public.get_monthly_billing_month_start(p_billing_month);
  v_month_end date := (public.get_monthly_billing_month_start(p_billing_month) + interval '1 month - 1 day')::date;
begin
  if p_organization_id is null or not public.can_manage_student_billing_org(p_organization_id) then
    raise exception 'You do not have permission to view monthly collection charges.';
  end if;

  return query
  select sc.student_id, sc.id, sc.description, sc.charge_type,
    sc.collection_treatment, sc.amount,
    coalesce(a.allocated_amount, 0),
    sc.amount - coalesce(a.allocated_amount, 0)
  from public.student_charges sc
  left join lateral (
    select sum(spa.amount) as allocated_amount
    from public.student_payment_allocations spa
    join public.student_payments sp on sp.id = spa.student_payment_id
    where spa.student_charge_id = sc.id and sp.status <> 'void'
  ) a on true
  where sc.organization_id = p_organization_id
    and (p_school_id is null or sc.school_id = p_school_id)
    and sc.currency = 'JPY'
    and (sc.collection_treatment = 'additional' or sc.collection_treatment is null)
    and sc.status in ('open', 'partially_paid')
    and coalesce(sc.due_date, sc.billing_period_start, sc.billing_period_end)
      between v_month_start and v_month_end
  order by sc.student_id, sc.created_at, sc.id;
end;
$$;

revoke all on function public.get_student_monthly_collection_charges_mvp(uuid, uuid, date) from public, anon;
grant execute on function public.get_student_monthly_collection_charges_mvp(uuid, uuid, date) to authenticated;

notify pgrst, 'reload schema';
