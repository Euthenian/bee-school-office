create or replace function public.can_manage_finance_org(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.organization_memberships om
    where om.profile_id = (select auth.uid())
      and om.organization_id = p_organization_id
      and om.role = 'super_admin'
  );
$$;

revoke all on function public.can_manage_finance_org(uuid) from public, anon;
grant execute on function public.can_manage_finance_org(uuid) to authenticated;

create or replace function public.get_finance_dashboard_mvp(
  p_organization_id uuid,
  p_date_from date default null,
  p_date_to date default null,
  p_school_id uuid default null,
  p_as_of_date date default current_date
)
returns table (
  organization_id uuid,
  school_id uuid,
  school_name text,
  date_from date,
  date_to date,
  as_of_date date,
  currency char(3),
  student_cash_received numeric,
  student_refunds numeric,
  net_student_cash_revenue numeric,
  student_charges_created numeric,
  student_service_period_charges numeric,
  outstanding_receivables numeric,
  overdue_receivables numeric,
  unallocated_student_payments numeric,
  payroll_accrued_net_payable numeric,
  payroll_paid numeric,
  operating_expenses numeric,
  operating_expense_tax numeric,
  cash_operating_result numeric,
  accrual_operating_result numeric,
  student_payment_count bigint,
  student_refund_count bigint,
  student_charge_count bigint,
  payroll_entry_count bigint,
  payroll_payment_count bigint,
  expense_count bigint,
  expense_category_totals jsonb
)
language plpgsql
stable
set search_path = public
as $$
declare
  v_as_of_date date := coalesce(p_as_of_date, current_date);
  v_date_from date := coalesce(p_date_from, date_trunc('month', current_date)::date);
  v_date_to date := coalesce(
    p_date_to,
    (date_trunc('month', current_date) + interval '1 month - 1 day')::date
  );
  v_school public.schools%rowtype;
begin
  if p_organization_id is null then
    raise exception 'Organization is required for finance dashboard aggregation.';
  end if;

  if v_date_to < v_date_from then
    raise exception 'Date to cannot be before date from.';
  end if;

  if not public.can_manage_finance_org(p_organization_id) then
    raise exception 'You do not have permission to view finance for this organization.';
  end if;

  if p_school_id is not null then
    select * into v_school
    from public.schools s
    where s.id = p_school_id
      and s.organization_id = p_organization_id;

    if not found then
      raise exception 'School % was not found for this organization.', p_school_id;
    end if;
  end if;

  return query
  with period_student_payments as (
    select
      sp.*,
      coalesce(allocations.allocated_amount, 0) as allocated_amount,
      coalesce(refunds.refunded_amount, 0) as refunded_amount
    from public.student_payments sp
    left join lateral (
      select coalesce(sum(spa.amount), 0) as allocated_amount
      from public.student_payment_allocations spa
      where spa.student_payment_id = sp.id
    ) allocations on true
    left join lateral (
      select coalesce(sum(sr.amount), 0) as refunded_amount
      from public.student_refunds sr
      where sr.student_payment_id = sp.id
        and sr.status <> 'void'
    ) refunds on true
    where sp.organization_id = p_organization_id
      and (p_school_id is null or sp.school_id = p_school_id)
      and sp.status <> 'void'
      and sp.payment_date between v_date_from and v_date_to
  ),
  period_student_refunds as (
    select sr.*
    from public.student_refunds sr
    where sr.organization_id = p_organization_id
      and (p_school_id is null or sr.school_id = p_school_id)
      and sr.status <> 'void'
      and sr.refund_date between v_date_from and v_date_to
  ),
  period_created_charges as (
    select sc.*
    from public.student_charges sc
    where sc.organization_id = p_organization_id
      and (p_school_id is null or sc.school_id = p_school_id)
      and sc.status not in ('void', 'cancelled')
      and sc.created_at::date between v_date_from and v_date_to
  ),
  period_service_charges as (
    select
      sc.*,
      coalesce(allocations.allocated_amount, 0) as allocated_amount
    from public.student_charges sc
    left join lateral (
      select coalesce(sum(spa.amount), 0) as allocated_amount
      from public.student_payment_allocations spa
      join public.student_payments sp on sp.id = spa.student_payment_id
      where spa.student_charge_id = sc.id
        and sp.status <> 'void'
    ) allocations on true
    where sc.organization_id = p_organization_id
      and (p_school_id is null or sc.school_id = p_school_id)
      and sc.status not in ('void', 'cancelled')
      and (
        (
          (sc.billing_period_start is not null or sc.billing_period_end is not null)
          and coalesce(sc.billing_period_start, sc.billing_period_end) <= v_date_to
          and coalesce(sc.billing_period_end, sc.billing_period_start) >= v_date_from
        )
        or (
          sc.billing_period_start is null
          and sc.billing_period_end is null
          and sc.due_date between v_date_from and v_date_to
        )
        or (
          sc.billing_period_start is null
          and sc.billing_period_end is null
          and sc.due_date is null
          and sc.created_at::date between v_date_from and v_date_to
        )
      )
  ),
  period_payroll_entries as (
    select pe.*
    from public.payroll_entries pe
    join public.payroll_periods pp on pp.id = pe.payroll_period_id
    where pe.organization_id = p_organization_id
      and pe.status <> 'void'
      and pp.period_start <= v_date_to
      and pp.period_end >= v_date_from
      and (p_school_id is null or coalesce(pe.school_id, pp.school_id) = p_school_id)
  ),
  period_payroll_payments as (
    select ppmt.*
    from public.payroll_payments ppmt
    join public.payroll_entries pe on pe.id = ppmt.payroll_entry_id
    join public.payroll_periods pp on pp.id = pe.payroll_period_id
    where ppmt.organization_id = p_organization_id
      and pe.status <> 'void'
      and ppmt.payment_date between v_date_from and v_date_to
      and (p_school_id is null or coalesce(pe.school_id, pp.school_id) = p_school_id)
  ),
  period_expenses as (
    select e.*
    from public.expenses e
    where e.organization_id = p_organization_id
      and (p_school_id is null or e.school_id = p_school_id)
      and e.status = 'active'
      and e.expense_date between v_date_from and v_date_to
  ),
  currencies as (
    select distinct psp.currency as currency_code from period_student_payments psp
    union
    select distinct psr.currency from period_student_refunds psr
    union
    select distinct pcc.currency from period_created_charges pcc
    union
    select distinct psc.currency from period_service_charges psc
    union
    select distinct ppe.currency from period_payroll_entries ppe
    union
    select distinct ppp.currency from period_payroll_payments ppp
    union
    select distinct pe.currency from period_expenses pe
    union
    select 'JPY'::char(3)
    where not exists (select 1 from period_student_payments)
      and not exists (select 1 from period_student_refunds)
      and not exists (select 1 from period_created_charges)
      and not exists (select 1 from period_service_charges)
      and not exists (select 1 from period_payroll_entries)
      and not exists (select 1 from period_payroll_payments)
      and not exists (select 1 from period_expenses)
  ),
  metric_rows as (
    select
      c.currency_code,
      coalesce((select sum(psp.amount) from period_student_payments psp where psp.currency = c.currency_code), 0) as student_cash_received,
      coalesce((select sum(psr.amount) from period_student_refunds psr where psr.currency = c.currency_code), 0) as student_refunds,
      coalesce((select sum(pcc.amount) from period_created_charges pcc where pcc.currency = c.currency_code), 0) as student_charges_created,
      coalesce((select sum(psc.amount) from period_service_charges psc where psc.currency = c.currency_code), 0) as student_service_period_charges,
      coalesce((
        select sum(greatest(psc.amount - psc.allocated_amount, 0))
        from period_service_charges psc
        where psc.currency = c.currency_code
      ), 0) as outstanding_receivables,
      coalesce((
        select sum(greatest(psc.amount - psc.allocated_amount, 0))
        from period_service_charges psc
        where psc.currency = c.currency_code
          and psc.amount > 0
          and psc.due_date is not null
          and psc.due_date < v_as_of_date
      ), 0) as overdue_receivables,
      coalesce((
        select sum(psp.amount - psp.allocated_amount - psp.refunded_amount)
        from period_student_payments psp
        where psp.currency = c.currency_code
      ), 0) as unallocated_student_payments,
      coalesce((select sum(ppe.net_payable) from period_payroll_entries ppe where ppe.currency = c.currency_code), 0) as payroll_accrued_net_payable,
      coalesce((select sum(ppp.amount) from period_payroll_payments ppp where ppp.currency = c.currency_code), 0) as payroll_paid,
      coalesce((select sum(pe.amount) from period_expenses pe where pe.currency = c.currency_code), 0) as operating_expenses,
      coalesce((select sum(pe.tax_amount) from period_expenses pe where pe.currency = c.currency_code), 0) as operating_expense_tax,
      coalesce((select count(*) from period_student_payments psp where psp.currency = c.currency_code), 0) as student_payment_count,
      coalesce((select count(*) from period_student_refunds psr where psr.currency = c.currency_code), 0) as student_refund_count,
      coalesce((select count(*) from period_service_charges psc where psc.currency = c.currency_code), 0) as student_charge_count,
      coalesce((select count(*) from period_payroll_entries ppe where ppe.currency = c.currency_code), 0) as payroll_entry_count,
      coalesce((select count(*) from period_payroll_payments ppp where ppp.currency = c.currency_code), 0) as payroll_payment_count,
      coalesce((select count(*) from period_expenses pe where pe.currency = c.currency_code), 0) as expense_count,
      coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'category_id', category_rows.category_id,
            'category_code', category_rows.category_code,
            'category_name', category_rows.category_name,
            'amount', category_rows.amount,
            'tax_amount', category_rows.tax_amount,
            'expense_count', category_rows.expense_count
          )
          order by category_rows.amount desc, category_rows.category_name
        )
        from (
          select
            ec.id as category_id,
            ec.code as category_code,
            ec.name as category_name,
            sum(pe.amount) as amount,
            coalesce(sum(pe.tax_amount), 0) as tax_amount,
            count(*) as expense_count
          from period_expenses pe
          join public.expense_categories ec
            on ec.id = pe.category_id
           and ec.organization_id = pe.organization_id
          where pe.currency = c.currency_code
          group by ec.id, ec.code, ec.name
        ) category_rows
      ), '[]'::jsonb) as expense_category_totals
    from currencies c
  )
  select
    p_organization_id,
    p_school_id,
    coalesce(v_school.name, 'All schools'),
    v_date_from,
    v_date_to,
    v_as_of_date,
    mr.currency_code,
    mr.student_cash_received,
    mr.student_refunds,
    mr.student_cash_received - mr.student_refunds,
    mr.student_charges_created,
    mr.student_service_period_charges,
    mr.outstanding_receivables,
    mr.overdue_receivables,
    mr.unallocated_student_payments,
    mr.payroll_accrued_net_payable,
    mr.payroll_paid,
    mr.operating_expenses,
    mr.operating_expense_tax,
    mr.student_cash_received - mr.student_refunds - mr.payroll_paid - mr.operating_expenses,
    mr.student_service_period_charges - mr.payroll_accrued_net_payable - mr.operating_expenses,
    mr.student_payment_count,
    mr.student_refund_count,
    mr.student_charge_count,
    mr.payroll_entry_count,
    mr.payroll_payment_count,
    mr.expense_count,
    mr.expense_category_totals
  from metric_rows mr
  order by mr.currency_code;
end;
$$;

comment on function public.get_finance_dashboard_mvp(uuid, date, date, uuid, date) is
'Aggregates Finance Dashboard metrics from Student Billing, Payroll, and Expense foundations without creating a separate ledger.';

revoke all on function public.get_finance_dashboard_mvp(uuid, date, date, uuid, date) from public, anon, authenticated;
grant execute on function public.get_finance_dashboard_mvp(uuid, date, date, uuid, date) to authenticated;

notify pgrst, 'reload schema';
