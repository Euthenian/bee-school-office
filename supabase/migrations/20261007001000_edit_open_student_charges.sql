create or replace function public.guard_student_charge_content_update()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_has_allocation boolean;
begin
  if new.amount is not distinct from old.amount
    and new.description is not distinct from old.description
    and new.due_date is not distinct from old.due_date
    and new.charge_type is not distinct from old.charge_type
    and new.collection_treatment is not distinct from old.collection_treatment
    and new.billing_period_start is not distinct from old.billing_period_start
    and new.billing_period_end is not distinct from old.billing_period_end
    and new.currency is not distinct from old.currency
    and new.notes is not distinct from old.notes then
    return new;
  end if;

  select exists (
    select 1 from public.student_payment_allocations spa
    where spa.student_charge_id = old.id
  ) into v_has_allocation;

  -- The existing create wrapper classifies a newly created draft in a second
  -- statement. Draft charges are still excluded from collection.
  if old.status = 'draft' and new.status = 'draft'
    and old.collection_treatment is null
    and new.collection_treatment in ('additional', 'separate')
    and new.amount is not distinct from old.amount
    and new.description is not distinct from old.description
    and new.due_date is not distinct from old.due_date
    and new.charge_type is not distinct from old.charge_type
    and new.billing_period_start is not distinct from old.billing_period_start
    and new.billing_period_end is not distinct from old.billing_period_end
    and new.currency is not distinct from old.currency
    and new.notes is not distinct from old.notes then
    return new;
  end if;

  -- Preserve the existing void RPC, which may update notes while voiding an
  -- unallocated charge.
  if new.status = 'void' and not v_has_allocation
    and new.amount is not distinct from old.amount
    and new.description is not distinct from old.description
    and new.due_date is not distinct from old.due_date
    and new.charge_type is not distinct from old.charge_type
    and new.collection_treatment is not distinct from old.collection_treatment
    and new.billing_period_start is not distinct from old.billing_period_start
    and new.billing_period_end is not distinct from old.billing_period_end
    and new.currency is not distinct from old.currency then
    return new;
  end if;

  if old.status <> 'open' or new.status <> 'open' or v_has_allocation then
    raise exception 'Only open charges without payment allocations can be edited.';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_student_charge_content_update() from public, anon, authenticated;

create trigger student_charges_guard_content_update
before update of amount, description, due_date, charge_type, collection_treatment,
  billing_period_start, billing_period_end, currency, notes
on public.student_charges
for each row execute function public.guard_student_charge_content_update();

create or replace function public.update_open_student_charge_mvp(
  p_charge_id uuid,
  p_amount numeric,
  p_description text,
  p_due_date date,
  p_charge_type text,
  p_collection_treatment text,
  p_billing_period_start date,
  p_billing_period_end date,
  p_notes text
)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_charge public.student_charges%rowtype;
begin
  select * into v_charge
  from public.student_charges sc
  where sc.id = p_charge_id
  for update;

  if not found then
    raise exception 'Charge % was not found.', p_charge_id;
  end if;
  if not public.can_manage_student_billing_org(v_charge.organization_id) then
    raise exception 'You do not have permission to edit this charge.';
  end if;
  if v_charge.status <> 'open' or exists (
    select 1 from public.student_payment_allocations spa
    where spa.student_charge_id = p_charge_id
  ) then
    raise exception 'Only open charges without payment allocations can be edited.';
  end if;
  if nullif(trim(coalesce(p_description, '')), '') is null then
    raise exception 'Charge description is required.';
  end if;
  if p_charge_type not in ('tuition', 'entrance_fee', 'materials', 'trial_lesson', 'private_lesson', 'deposit', 'adjustment', 'other')
    or p_charge_type is null then
    raise exception 'Unsupported charge type.';
  end if;
  if p_amount is null or (p_amount < 0 and p_charge_type <> 'adjustment') then
    raise exception 'Charge amount is invalid.';
  end if;
  if p_billing_period_start is not null and p_billing_period_end is not null
    and p_billing_period_end < p_billing_period_start then
    raise exception 'Billing period end cannot be before billing period start.';
  end if;
  if p_collection_treatment not in ('additional', 'separate') or p_collection_treatment is null then
    raise exception 'Choose an explicit collection treatment.';
  end if;
  if p_collection_treatment = 'additional' and
    (v_charge.currency <> 'JPY' or p_amount < 0 or
      (p_due_date is null and p_billing_period_start is null and p_billing_period_end is null)) then
    raise exception 'Additional RICO charges require a nonnegative JPY amount and a billing period or due date.';
  end if;

  update public.student_charges sc
  set amount = p_amount,
      description = trim(p_description),
      due_date = p_due_date,
      charge_type = p_charge_type,
      collection_treatment = p_collection_treatment,
      billing_period_start = p_billing_period_start,
      billing_period_end = p_billing_period_end,
      notes = nullif(trim(coalesce(p_notes, '')), '')
  where sc.id = p_charge_id;

  return p_charge_id;
end;
$$;

revoke all on function public.update_open_student_charge_mvp(uuid, numeric, text, date, text, text, date, date, text) from public, anon;
grant execute on function public.update_open_student_charge_mvp(uuid, numeric, text, date, text, text, date, date, text) to authenticated;

notify pgrst, 'reload schema';
