create or replace function public.is_service_role()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(current_setting('request.jwt.claim.role', true), '') = 'service_role'
    or current_user = 'service_role';
$$;

revoke all on function public.is_service_role() from public, anon;
grant execute on function public.is_service_role() to authenticated, service_role;

create or replace function public.can_manage_expenses_org(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_service_role() or public.is_super_admin();
$$;

revoke all on function public.can_manage_expenses_org(uuid) from public, anon;
grant execute on function public.can_manage_expenses_org(uuid) to authenticated, service_role;

create table if not exists public.recurring_expense_templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  school_id uuid not null,
  category_id uuid not null,
  name text not null,
  vendor text,
  amount numeric(12, 2) not null,
  currency char(3) not null default 'JPY',
  tax_amount numeric(12, 2),
  payment_method text not null default 'bank_transfer',
  recurrence text not null default 'monthly',
  start_date date not null,
  end_date date,
  notes text,
  status text not null default 'active',
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  constraint recurring_expense_templates_organization_id_fkey
    foreign key (organization_id)
    references public.organizations (id)
    on delete restrict,
  constraint recurring_expense_templates_school_id_organization_id_fkey
    foreign key (school_id, organization_id)
    references public.schools (id, organization_id)
    on delete restrict,
  constraint recurring_expense_templates_category_id_organization_id_fkey
    foreign key (category_id, organization_id)
    references public.expense_categories (id, organization_id)
    on delete restrict,
  constraint recurring_expense_templates_amount_check
    check (amount > 0),
  constraint recurring_expense_templates_tax_amount_check
    check (tax_amount is null or (tax_amount >= 0 and tax_amount <= amount)),
  constraint recurring_expense_templates_currency_check
    check (currency ~ '^[A-Z]{3}$'),
  constraint recurring_expense_templates_payment_method_check
    check (payment_method in ('cash', 'bank_transfer', 'bank_debit', 'card', 'other')),
  constraint recurring_expense_templates_recurrence_check
    check (recurrence in ('one_time', 'monthly')),
  constraint recurring_expense_templates_status_check
    check (status in ('active', 'inactive')),
  constraint recurring_expense_templates_date_check
    check (end_date is null or end_date >= start_date)
);

create index if not exists recurring_expense_templates_school_status_idx
on public.recurring_expense_templates (school_id, status, recurrence, start_date);

create index if not exists recurring_expense_templates_org_status_idx
on public.recurring_expense_templates (organization_id, status, recurrence, start_date);

comment on table public.recurring_expense_templates is
'Templates for operating expenses that can generate one persisted expense per month.';

alter table public.expenses
add column if not exists recurring_template_id uuid,
add column if not exists recurring_period_start date,
add column if not exists source_type text not null default 'manual',
add column if not exists source_reference text,
add column if not exists financial_document_id uuid;

alter table public.expenses
drop constraint if exists expenses_recurring_template_id_org_fkey;

alter table public.expenses
add constraint expenses_recurring_template_id_org_fkey
foreign key (recurring_template_id, organization_id)
references public.recurring_expense_templates (id, organization_id)
on delete restrict;

alter table public.expenses
drop constraint if exists expenses_source_type_check;

alter table public.expenses
add constraint expenses_source_type_check
check (source_type in ('manual', 'recurring_template', 'financial_document'));

create unique index if not exists expenses_id_organization_school_uidx
on public.expenses (id, organization_id, school_id);

create unique index if not exists expenses_recurring_template_period_uidx
on public.expenses (recurring_template_id, recurring_period_start);

create unique index if not exists expenses_financial_document_id_uidx
on public.expenses (financial_document_id)
where financial_document_id is not null;

create or replace function public.validate_recurring_expense_template_row()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_category public.expense_categories%rowtype;
  v_school public.schools%rowtype;
begin
  select * into v_school
  from public.schools s
  where s.id = new.school_id;

  if not found then
    raise exception 'School % was not found.', new.school_id;
  end if;

  new.organization_id = v_school.organization_id;

  if not public.can_manage_expenses_org(new.organization_id) then
    raise exception 'You do not have permission to manage recurring expenses for this organization.';
  end if;

  select * into v_category
  from public.expense_categories ec
  where ec.id = new.category_id
    and ec.organization_id = new.organization_id;

  if not found then
    raise exception 'Expense category % was not found for this organization.', new.category_id;
  end if;

  if v_category.school_id is not null and v_category.school_id <> new.school_id then
    raise exception 'Expense category does not belong to this school.';
  end if;

  if v_category.status <> 'active' and new.status = 'active' then
    raise exception 'Inactive expense categories cannot be used for active recurring templates.';
  end if;

  if nullif(trim(coalesce(new.name, '')), '') is null then
    raise exception 'Expense template name is required.';
  end if;

  new.name = trim(new.name);
  new.vendor = nullif(trim(coalesce(new.vendor, '')), '');
  new.currency = upper(new.currency)::char(3);
  new.notes = nullif(trim(coalesce(new.notes, '')), '');

  if tg_op = 'INSERT' then
    new.created_by = coalesce(new.created_by, (select auth.uid()));
  else
    new.created_by = old.created_by;
    new.created_at = old.created_at;
  end if;

  return new;
end;
$$;

revoke all on function public.validate_recurring_expense_template_row() from public, anon, authenticated;

drop trigger if exists recurring_expense_templates_validate_row on public.recurring_expense_templates;
create trigger recurring_expense_templates_validate_row
before insert or update on public.recurring_expense_templates
for each row execute function public.validate_recurring_expense_template_row();

drop trigger if exists recurring_expense_templates_set_updated_at on public.recurring_expense_templates;
create trigger recurring_expense_templates_set_updated_at
before update on public.recurring_expense_templates
for each row execute function public.set_updated_at();

create or replace function public.create_recurring_expense_template_mvp(
  p_school_id uuid,
  p_category_id uuid,
  p_name text,
  p_vendor text default null,
  p_amount numeric default null,
  p_currency text default 'JPY',
  p_tax_amount numeric default null,
  p_payment_method text default 'bank_transfer',
  p_recurrence text default 'monthly',
  p_start_date date default null,
  p_end_date date default null,
  p_notes text default null
)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_template_id uuid;
begin
  insert into public.recurring_expense_templates (
    organization_id,
    school_id,
    category_id,
    name,
    vendor,
    amount,
    currency,
    tax_amount,
    payment_method,
    recurrence,
    start_date,
    end_date,
    notes
  )
  values (
    (select s.organization_id from public.schools s where s.id = p_school_id),
    p_school_id,
    p_category_id,
    p_name,
    p_vendor,
    coalesce(p_amount, 0),
    upper(coalesce(nullif(trim(coalesce(p_currency, '')), ''), 'JPY'))::char(3),
    p_tax_amount,
    coalesce(nullif(trim(coalesce(p_payment_method, '')), ''), 'bank_transfer'),
    coalesce(nullif(trim(coalesce(p_recurrence, '')), ''), 'monthly'),
    p_start_date,
    p_end_date,
    p_notes
  )
  returning id into v_template_id;

  return v_template_id;
end;
$$;

revoke all on function public.create_recurring_expense_template_mvp(
  uuid, uuid, text, text, numeric, text, numeric, text, text, date, date, text
) from public, anon;
grant execute on function public.create_recurring_expense_template_mvp(
  uuid, uuid, text, text, numeric, text, numeric, text, text, date, date, text
) to authenticated;

create or replace function public.update_recurring_expense_template_mvp(
  p_template_id uuid,
  p_school_id uuid,
  p_category_id uuid,
  p_name text,
  p_vendor text default null,
  p_amount numeric default null,
  p_currency text default 'JPY',
  p_tax_amount numeric default null,
  p_payment_method text default 'bank_transfer',
  p_recurrence text default 'monthly',
  p_start_date date default null,
  p_end_date date default null,
  p_notes text default null,
  p_status text default 'active'
)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_template public.recurring_expense_templates%rowtype;
begin
  select * into v_template
  from public.recurring_expense_templates ret
  where ret.id = p_template_id
  for update;

  if not found then
    raise exception 'Recurring expense template % was not found.', p_template_id;
  end if;

  if not public.can_manage_expenses_org(v_template.organization_id) then
    raise exception 'You do not have permission to update recurring expenses for this organization.';
  end if;

  update public.recurring_expense_templates
  set school_id = p_school_id,
      category_id = p_category_id,
      name = p_name,
      vendor = p_vendor,
      amount = coalesce(p_amount, 0),
      currency = upper(coalesce(nullif(trim(coalesce(p_currency, '')), ''), 'JPY'))::char(3),
      tax_amount = p_tax_amount,
      payment_method = coalesce(nullif(trim(coalesce(p_payment_method, '')), ''), 'bank_transfer'),
      recurrence = coalesce(nullif(trim(coalesce(p_recurrence, '')), ''), 'monthly'),
      start_date = p_start_date,
      end_date = p_end_date,
      notes = p_notes,
      status = coalesce(nullif(trim(coalesce(p_status, '')), ''), 'active')
  where id = p_template_id;

  return p_template_id;
end;
$$;

revoke all on function public.update_recurring_expense_template_mvp(
  uuid, uuid, uuid, text, text, numeric, text, numeric, text, text, date, date, text, text
) from public, anon;
grant execute on function public.update_recurring_expense_template_mvp(
  uuid, uuid, uuid, text, text, numeric, text, numeric, text, text, date, date, text, text
) to authenticated;

create or replace function public.generate_recurring_expenses_mvp(p_target_month date default current_date)
returns table (
  template_id uuid,
  expense_id uuid,
  generation_status text
)
language plpgsql
set search_path = public
as $$
declare
  v_month_end date;
  v_month_start date;
begin
  v_month_start = date_trunc('month', coalesce(p_target_month, current_date))::date;
  v_month_end = (v_month_start + interval '1 month - 1 day')::date;

  return query
  with due_templates as (
    select ret.*
    from public.recurring_expense_templates ret
    where ret.status = 'active'
      and ret.recurrence = 'monthly'
      and ret.start_date <= v_month_end
      and (ret.end_date is null or ret.end_date >= v_month_start)
      and public.can_manage_expenses_org(ret.organization_id)
  ),
  inserted as (
    insert into public.expenses (
      organization_id,
      school_id,
      expense_date,
      category_id,
      vendor,
      description,
      amount,
      currency,
      tax_amount,
      payment_method,
      reference,
      notes,
      status,
      recurring_template_id,
      recurring_period_start,
      source_type,
      source_reference,
      created_by
    )
    select
      due_templates.organization_id,
      due_templates.school_id,
      greatest(due_templates.start_date, v_month_start),
      due_templates.category_id,
      due_templates.vendor,
      due_templates.name,
      due_templates.amount,
      due_templates.currency,
      due_templates.tax_amount,
      due_templates.payment_method,
      'Recurring ' || to_char(v_month_start, 'YYYY-MM'),
      due_templates.notes,
      'active',
      due_templates.id,
      v_month_start,
      'recurring_template',
      due_templates.id::text || ':' || to_char(v_month_start, 'YYYY-MM'),
      (select auth.uid())
    from due_templates
    on conflict (recurring_template_id, recurring_period_start) do nothing
    returning expenses.recurring_template_id, expenses.id
  )
  select
    dt.id,
    coalesce(ins.id, e.id),
    case when ins.id is not null then 'generated' else 'existing' end
  from due_templates dt
  left join inserted ins on ins.recurring_template_id = dt.id
  left join public.expenses e
    on e.recurring_template_id = dt.id
   and e.recurring_period_start = v_month_start
  order by dt.name, dt.id;
end;
$$;

revoke all on function public.generate_recurring_expenses_mvp(date) from public, anon;
grant execute on function public.generate_recurring_expenses_mvp(date) to authenticated, service_role;

create table if not exists public.financial_documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  school_id uuid not null,
  source text not null default 'manual',
  source_mailbox text,
  gmail_message_id text,
  gmail_thread_id text,
  received_at timestamptz,
  sender text,
  recipient text,
  subject text,
  title text,
  vendor text,
  document_filename text,
  document_mime_type text,
  document_file_path text,
  detected_amount numeric(12, 2),
  detected_currency char(3),
  category_id uuid,
  status text not null default 'pending',
  is_read boolean not null default false,
  linked_expense_id uuid,
  processed_at timestamptz,
  processed_by uuid references public.profiles (id) on delete set null,
  raw_body text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id, school_id),
  unique (source_mailbox, gmail_message_id),
  constraint financial_documents_organization_id_fkey
    foreign key (organization_id)
    references public.organizations (id)
    on delete restrict,
  constraint financial_documents_school_id_organization_id_fkey
    foreign key (school_id, organization_id)
    references public.schools (id, organization_id)
    on delete restrict,
  constraint financial_documents_category_id_organization_id_fkey
    foreign key (category_id, organization_id)
    references public.expense_categories (id, organization_id)
    on delete restrict,
  constraint financial_documents_linked_expense_id_org_school_fkey
    foreign key (linked_expense_id, organization_id, school_id)
    references public.expenses (id, organization_id, school_id)
    on delete restrict,
  constraint financial_documents_source_check
    check (source in ('manual', 'gmail', 'email', 'upload')),
  constraint financial_documents_status_check
    check (status in ('pending', 'converted_to_expense', 'dismissed')),
  constraint financial_documents_detected_currency_check
    check (detected_currency is null or detected_currency ~ '^[A-Z]{3}$'),
  constraint financial_documents_detected_amount_check
    check (detected_amount is null or detected_amount >= 0),
  constraint financial_documents_gmail_source_check
    check (source <> 'gmail' or (source_mailbox is not null and gmail_message_id is not null))
);

alter table public.expenses
drop constraint if exists expenses_financial_document_id_org_school_fkey;

alter table public.expenses
add constraint expenses_financial_document_id_org_school_fkey
foreign key (financial_document_id, organization_id, school_id)
references public.financial_documents (id, organization_id, school_id)
on delete restrict;

create index if not exists financial_documents_school_status_unread_idx
on public.financial_documents (school_id, status, is_read, received_at desc);

create index if not exists financial_documents_org_status_idx
on public.financial_documents (organization_id, status, created_at desc);

create index if not exists financial_documents_sender_idx
on public.financial_documents (sender);

comment on table public.financial_documents is
'Bills, receipts, invoices, and payment notices that need finance review or have been retained as expense source evidence.';

create table if not exists public.financial_document_rules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  school_id uuid,
  sender_domain text,
  subject_contains text,
  vendor text not null,
  category_id uuid,
  expected_amount numeric(12, 2),
  currency char(3) not null default 'JPY',
  processing_mode text not null default 'manual_review',
  status text not null default 'active',
  notes text,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint financial_document_rules_organization_id_fkey
    foreign key (organization_id)
    references public.organizations (id)
    on delete restrict,
  constraint financial_document_rules_school_id_organization_id_fkey
    foreign key (school_id, organization_id)
    references public.schools (id, organization_id)
    on delete restrict,
  constraint financial_document_rules_category_id_organization_id_fkey
    foreign key (category_id, organization_id)
    references public.expense_categories (id, organization_id)
    on delete restrict,
  constraint financial_document_rules_expected_amount_check
    check (expected_amount is null or expected_amount > 0),
  constraint financial_document_rules_currency_check
    check (currency ~ '^[A-Z]{3}$'),
  constraint financial_document_rules_processing_mode_check
    check (processing_mode in ('manual_review', 'auto_expense')),
  constraint financial_document_rules_status_check
    check (status in ('active', 'inactive')),
  constraint financial_document_rules_matcher_check
    check (
      nullif(trim(coalesce(sender_domain, '')), '') is not null
      or nullif(trim(coalesce(subject_contains, '')), '') is not null
    )
);

create index if not exists financial_document_rules_org_status_idx
on public.financial_document_rules (organization_id, status, processing_mode);

comment on table public.financial_document_rules is
'Conservative vendor rules for routing financial emails to manual review or trusted auto-expense creation.';

create table if not exists public.office_todo_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  school_id uuid not null,
  title text not null,
  description text,
  status text not null default 'open',
  due_date date,
  source_type text not null default 'manual',
  source_reference text,
  assigned_profile_id uuid references public.profiles (id) on delete set null,
  created_by uuid references public.profiles (id) on delete set null,
  completed_at timestamptz,
  completed_by uuid references public.profiles (id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id, school_id),
  constraint office_todo_items_organization_id_fkey
    foreign key (organization_id)
    references public.organizations (id)
    on delete restrict,
  constraint office_todo_items_school_id_organization_id_fkey
    foreign key (school_id, organization_id)
    references public.schools (id, organization_id)
    on delete restrict,
  constraint office_todo_items_status_check
    check (status in ('open', 'completed')),
  constraint office_todo_items_source_type_check
    check (source_type in ('manual', 'financial_document')),
  constraint office_todo_items_title_check
    check (length(btrim(title)) > 0)
);

create unique index if not exists office_todo_items_source_reference_uidx
on public.office_todo_items (organization_id, source_type, source_reference)
where source_reference is not null;

create index if not exists office_todo_items_school_status_due_idx
on public.office_todo_items (school_id, status, due_date nulls first, created_at desc);

comment on table public.office_todo_items is
'General office To Do items. Financial-document tasks retain their source reference instead of duplicating source files.';

drop trigger if exists financial_documents_set_updated_at on public.financial_documents;
create trigger financial_documents_set_updated_at
before update on public.financial_documents
for each row execute function public.set_updated_at();

drop trigger if exists financial_document_rules_set_updated_at on public.financial_document_rules;
create trigger financial_document_rules_set_updated_at
before update on public.financial_document_rules
for each row execute function public.set_updated_at();

drop trigger if exists office_todo_items_set_updated_at on public.office_todo_items;
create trigger office_todo_items_set_updated_at
before update on public.office_todo_items
for each row execute function public.set_updated_at();

alter table public.communications
add column if not exists financial_document_id uuid,
add column if not exists office_todo_item_id uuid;

alter table public.communications
drop constraint if exists communications_financial_document_id_org_school_fkey;

alter table public.communications
add constraint communications_financial_document_id_org_school_fkey
foreign key (financial_document_id, organization_id, school_id)
references public.financial_documents (id, organization_id, school_id)
on delete restrict;

alter table public.communications
drop constraint if exists communications_office_todo_item_id_org_school_fkey;

alter table public.communications
add constraint communications_office_todo_item_id_org_school_fkey
foreign key (office_todo_item_id, organization_id, school_id)
references public.office_todo_items (id, organization_id, school_id)
on delete restrict;

alter table public.communications
drop constraint if exists communications_context_check;

alter table public.communications
add constraint communications_context_check
check (
  student_id is not null
  or prospect_id is not null
  or trial_lesson_id is not null
  or financial_document_id is not null
  or office_todo_item_id is not null
);

create or replace function public.get_office_notification_recipients(
  p_organization_id uuid,
  p_school_id uuid
)
returns table (
  profile_id uuid,
  email text
)
language sql
stable
security definer
set search_path = public
as $$
  select distinct p.id, p.email::text
  from public.profiles p
  where p.status = 'active'
    and nullif(trim(coalesce(p.email::text, '')), '') is not null
    and (
      exists (
        select 1
        from public.organization_memberships om
        where om.profile_id = p.id
          and om.organization_id = p_organization_id
          and om.role in ('super_admin', 'franchise_owner', 'office_staff')
      )
      or exists (
        select 1
        from public.school_memberships sm
        where sm.profile_id = p.id
          and sm.school_id = p_school_id
          and sm.role in ('school_manager', 'office_staff')
      )
    )
  order by p.email::text;
$$;

revoke all on function public.get_office_notification_recipients(uuid, uuid) from public, anon;
grant execute on function public.get_office_notification_recipients(uuid, uuid) to authenticated, service_role;

create or replace function public.queue_office_notification_email(
  p_organization_id uuid,
  p_school_id uuid,
  p_recipient text,
  p_communication_type text,
  p_subject text,
  p_body text,
  p_idempotency_key text,
  p_financial_document_id uuid default null,
  p_office_todo_item_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_action_idempotency_key text;
  v_communication_id uuid;
  v_delivery_status public.communication_delivery_status;
begin
  if nullif(trim(coalesce(p_recipient, '')), '') is null then
    raise exception 'Recipient is required for office notification email.';
  end if;

  v_action_idempotency_key = p_idempotency_key || ':resend_send';

  insert into public.communications as c (
    organization_id,
    school_id,
    financial_document_id,
    office_todo_item_id,
    communication_type,
    channel,
    recipient,
    subject,
    body,
    source,
    delivery_status,
    external_provider,
    idempotency_key,
    metadata
  )
  values (
    p_organization_id,
    p_school_id,
    p_financial_document_id,
    p_office_todo_item_id,
    coalesce(nullif(trim(p_communication_type), ''), 'office_notification'),
    'email',
    lower(trim(p_recipient)),
    nullif(trim(coalesce(p_subject, '')), ''),
    trim(coalesce(p_body, '')),
    'automated',
    'queued'::public.communication_delivery_status,
    'resend',
    p_idempotency_key,
    jsonb_build_object('queued_from', 'office_notification')
  )
  on conflict (idempotency_key) do update
  set recipient = case when c.delivery_status = 'sent' then c.recipient else excluded.recipient end,
      subject = case when c.delivery_status = 'sent' then c.subject else excluded.subject end,
      body = case when c.delivery_status = 'sent' then c.body else excluded.body end,
      delivery_status = case when c.delivery_status = 'sent' then c.delivery_status else excluded.delivery_status end,
      external_provider = case when c.delivery_status = 'sent' then c.external_provider else excluded.external_provider end,
      metadata = case when c.delivery_status = 'sent' then c.metadata else excluded.metadata end,
      updated_at = now()
  returning id, delivery_status into v_communication_id, v_delivery_status;

  insert into public.communication_integration_actions as cia (
    organization_id,
    school_id,
    communication_id,
    provider,
    action_type,
    idempotency_key,
    status,
    request_payload
  )
  values (
    p_organization_id,
    p_school_id,
    v_communication_id,
    'resend',
    'send_email',
    v_action_idempotency_key,
    case when v_delivery_status = 'failed' then 'failed'::public.integration_action_status else 'pending'::public.integration_action_status end,
    jsonb_build_object(
      'recipient', lower(trim(p_recipient)),
      'subject', nullif(trim(coalesce(p_subject, '')), ''),
      'body', trim(coalesce(p_body, '')),
      'communication_type', coalesce(nullif(trim(p_communication_type), ''), 'office_notification')
    )
  )
  on conflict (idempotency_key) do update
  set communication_id = excluded.communication_id,
      request_payload = case
        when cia.status = 'succeeded' then cia.request_payload
        else excluded.request_payload
      end,
      status = case
        when cia.status = 'succeeded' then cia.status
        else excluded.status
      end,
      updated_at = now();

  return v_communication_id;
end;
$$;

revoke all on function public.queue_office_notification_email(
  uuid, uuid, text, text, text, text, text, uuid, uuid
) from public, anon, authenticated;
grant execute on function public.queue_office_notification_email(
  uuid, uuid, text, text, text, text, text, uuid, uuid
) to service_role;

create or replace function public.queue_financial_document_notification_mvp(p_financial_document_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_body text;
  v_document public.financial_documents%rowtype;
  v_queued integer := 0;
  v_recipient record;
  v_subject text;
begin
  select * into v_document
  from public.financial_documents fd
  where fd.id = p_financial_document_id;

  if not found then
    raise exception 'Financial document % was not found.', p_financial_document_id;
  end if;

  v_subject = '[Bee School Office] Financial doc to check';
  v_body = concat_ws(
    E'\n',
    'A financial document needs review.',
    '',
    'Title: ' || coalesce(v_document.title, v_document.subject, v_document.document_filename, 'Untitled document'),
    'Vendor/sender: ' || coalesce(v_document.vendor, v_document.sender, 'Not detected'),
    'Received: ' || coalesce(v_document.received_at::text, 'Not set'),
    'Financial document ID: ' || v_document.id::text
  );

  for v_recipient in
    select * from public.get_office_notification_recipients(v_document.organization_id, v_document.school_id)
  loop
    perform public.queue_office_notification_email(
      v_document.organization_id,
      v_document.school_id,
      v_recipient.email,
      'financial_document_to_check',
      v_subject,
      v_body,
      'financial_document:' || v_document.id::text || ':recipient:' || lower(v_recipient.email),
      v_document.id,
      null
    );
    v_queued = v_queued + 1;
  end loop;

  return v_queued;
end;
$$;

revoke all on function public.queue_financial_document_notification_mvp(uuid) from public, anon;
grant execute on function public.queue_financial_document_notification_mvp(uuid) to authenticated, service_role;

create or replace function public.queue_office_todo_notification_mvp(p_todo_item_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_body text;
  v_queued integer := 0;
  v_recipient record;
  v_subject text;
  v_todo public.office_todo_items%rowtype;
begin
  select * into v_todo
  from public.office_todo_items oti
  where oti.id = p_todo_item_id;

  if not found then
    raise exception 'To Do item % was not found.', p_todo_item_id;
  end if;

  v_subject = '[Bee School Office] New To Do item';
  v_body = concat_ws(
    E'\n',
    'A new To Do item was created.',
    '',
    'Title: ' || v_todo.title,
    'Due date: ' || coalesce(v_todo.due_date::text, 'Not set'),
    'Source: ' || coalesce(v_todo.source_type, 'manual'),
    'To Do ID: ' || v_todo.id::text
  );

  for v_recipient in
    select * from public.get_office_notification_recipients(v_todo.organization_id, v_todo.school_id)
  loop
    perform public.queue_office_notification_email(
      v_todo.organization_id,
      v_todo.school_id,
      v_recipient.email,
      'office_todo_created',
      v_subject,
      v_body,
      'office_todo:' || v_todo.id::text || ':recipient:' || lower(v_recipient.email),
      null,
      v_todo.id
    );
    v_queued = v_queued + 1;
  end loop;

  return v_queued;
end;
$$;

revoke all on function public.queue_office_todo_notification_mvp(uuid) from public, anon;
grant execute on function public.queue_office_todo_notification_mvp(uuid) to authenticated, service_role;

create or replace function public.ingest_financial_document_mvp(
  p_organization_id uuid,
  p_school_id uuid,
  p_source text default 'gmail',
  p_source_mailbox text default null,
  p_gmail_message_id text default null,
  p_gmail_thread_id text default null,
  p_received_at timestamptz default null,
  p_sender text default null,
  p_recipient text default null,
  p_subject text default null,
  p_title text default null,
  p_vendor text default null,
  p_document_filename text default null,
  p_document_mime_type text default null,
  p_document_file_path text default null,
  p_detected_amount numeric default null,
  p_detected_currency text default null,
  p_category_id uuid default null,
  p_raw_body text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_document_id uuid;
  v_school public.schools%rowtype;
begin
  select * into v_school
  from public.schools s
  where s.id = p_school_id
    and s.organization_id = p_organization_id;

  if not found then
    raise exception 'School % does not belong to organization %.', p_school_id, p_organization_id;
  end if;

  if not (public.can_manage_expenses_org(p_organization_id) or public.is_service_role()) then
    raise exception 'You do not have permission to create financial documents for this organization.';
  end if;

  insert into public.financial_documents as fd (
    organization_id,
    school_id,
    source,
    source_mailbox,
    gmail_message_id,
    gmail_thread_id,
    received_at,
    sender,
    recipient,
    subject,
    title,
    vendor,
    document_filename,
    document_mime_type,
    document_file_path,
    detected_amount,
    detected_currency,
    category_id,
    raw_body,
    metadata
  )
  values (
    p_organization_id,
    p_school_id,
    coalesce(nullif(trim(coalesce(p_source, '')), ''), 'gmail'),
    nullif(trim(coalesce(p_source_mailbox, '')), ''),
    nullif(trim(coalesce(p_gmail_message_id, '')), ''),
    nullif(trim(coalesce(p_gmail_thread_id, '')), ''),
    p_received_at,
    nullif(trim(coalesce(p_sender, '')), ''),
    nullif(trim(coalesce(p_recipient, '')), ''),
    nullif(trim(coalesce(p_subject, '')), ''),
    nullif(trim(coalesce(p_title, '')), ''),
    nullif(trim(coalesce(p_vendor, '')), ''),
    nullif(trim(coalesce(p_document_filename, '')), ''),
    nullif(trim(coalesce(p_document_mime_type, '')), ''),
    nullif(trim(coalesce(p_document_file_path, '')), ''),
    p_detected_amount,
    case
      when nullif(trim(coalesce(p_detected_currency, '')), '') is null then null
      else upper(trim(p_detected_currency))::char(3)
    end,
    p_category_id,
    nullif(trim(coalesce(p_raw_body, '')), ''),
    coalesce(p_metadata, '{}'::jsonb)
  )
  on conflict (source_mailbox, gmail_message_id) do update
  set gmail_thread_id = coalesce(excluded.gmail_thread_id, fd.gmail_thread_id),
      received_at = coalesce(excluded.received_at, fd.received_at),
      sender = coalesce(excluded.sender, fd.sender),
      recipient = coalesce(excluded.recipient, fd.recipient),
      subject = coalesce(excluded.subject, fd.subject),
      title = coalesce(excluded.title, fd.title),
      vendor = coalesce(excluded.vendor, fd.vendor),
      document_filename = coalesce(excluded.document_filename, fd.document_filename),
      document_mime_type = coalesce(excluded.document_mime_type, fd.document_mime_type),
      detected_amount = coalesce(excluded.detected_amount, fd.detected_amount),
      detected_currency = coalesce(excluded.detected_currency, fd.detected_currency),
      category_id = coalesce(excluded.category_id, fd.category_id),
      raw_body = coalesce(excluded.raw_body, fd.raw_body),
      metadata = fd.metadata || excluded.metadata,
      updated_at = now()
  returning id into v_document_id;

  perform public.queue_financial_document_notification_mvp(v_document_id);

  return v_document_id;
end;
$$;

revoke all on function public.ingest_financial_document_mvp(
  uuid, uuid, text, text, text, text, timestamptz, text, text, text, text, text,
  text, text, text, numeric, text, uuid, text, jsonb
) from public, anon;
grant execute on function public.ingest_financial_document_mvp(
  uuid, uuid, text, text, text, text, timestamptz, text, text, text, text, text,
  text, text, text, numeric, text, uuid, text, jsonb
) to authenticated, service_role;

create or replace function public.mark_financial_document_read_mvp(p_financial_document_id uuid)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_document public.financial_documents%rowtype;
begin
  select * into v_document
  from public.financial_documents fd
  where fd.id = p_financial_document_id
  for update;

  if not found then
    raise exception 'Financial document % was not found.', p_financial_document_id;
  end if;

  if not public.can_manage_expenses_org(v_document.organization_id) then
    raise exception 'You do not have permission to update this financial document.';
  end if;

  update public.financial_documents
  set is_read = true
  where id = p_financial_document_id;

  return p_financial_document_id;
end;
$$;

revoke all on function public.mark_financial_document_read_mvp(uuid) from public, anon;
grant execute on function public.mark_financial_document_read_mvp(uuid) to authenticated;

create or replace function public.dismiss_financial_document_mvp(p_financial_document_id uuid)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_document public.financial_documents%rowtype;
begin
  select * into v_document
  from public.financial_documents fd
  where fd.id = p_financial_document_id
  for update;

  if not found then
    raise exception 'Financial document % was not found.', p_financial_document_id;
  end if;

  if not public.can_manage_expenses_org(v_document.organization_id) then
    raise exception 'You do not have permission to update this financial document.';
  end if;

  if v_document.status = 'converted_to_expense' then
    raise exception 'Converted financial documents cannot be dismissed.';
  end if;

  update public.financial_documents
  set status = 'dismissed',
      is_read = true,
      processed_at = coalesce(processed_at, now()),
      processed_by = coalesce(processed_by, (select auth.uid()))
  where id = p_financial_document_id;

  return p_financial_document_id;
end;
$$;

revoke all on function public.dismiss_financial_document_mvp(uuid) from public, anon;
grant execute on function public.dismiss_financial_document_mvp(uuid) to authenticated;

create or replace function public.create_expense_from_financial_document_mvp(
  p_financial_document_id uuid,
  p_school_id uuid,
  p_expense_date date,
  p_category_id uuid,
  p_vendor text default null,
  p_description text default null,
  p_amount numeric default null,
  p_currency text default 'JPY',
  p_tax_amount numeric default null,
  p_payment_method text default 'bank_transfer',
  p_reference text default null,
  p_receipt_reference text default null,
  p_notes text default null
)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_amount numeric(12, 2);
  v_category public.expense_categories%rowtype;
  v_currency char(3);
  v_document public.financial_documents%rowtype;
  v_expense_id uuid;
  v_method text;
  v_school public.schools%rowtype;
  v_tax_amount numeric(12, 2);
begin
  select * into v_document
  from public.financial_documents fd
  where fd.id = p_financial_document_id
  for update;

  if not found then
    raise exception 'Financial document % was not found.', p_financial_document_id;
  end if;

  if not public.can_manage_expenses_org(v_document.organization_id) then
    raise exception 'You do not have permission to create expenses for this financial document.';
  end if;

  if v_document.status = 'dismissed' then
    raise exception 'Dismissed financial documents cannot be converted to expenses.';
  end if;

  if v_document.linked_expense_id is not null then
    return v_document.linked_expense_id;
  end if;

  select * into v_school
  from public.schools s
  where s.id = p_school_id
    and s.organization_id = v_document.organization_id;

  if not found then
    raise exception 'School % does not belong to this financial document organization.', p_school_id;
  end if;

  select * into v_category
  from public.expense_categories ec
  where ec.id = p_category_id
    and ec.organization_id = v_document.organization_id;

  if not found then
    raise exception 'Expense category % was not found for this organization.', p_category_id;
  end if;

  if v_category.school_id is not null and v_category.school_id <> p_school_id then
    raise exception 'Expense category does not belong to this school.';
  end if;

  v_amount = coalesce(p_amount, v_document.detected_amount, 0);
  if v_amount <= 0 then
    raise exception 'Expense amount must be greater than zero.';
  end if;

  v_tax_amount = p_tax_amount;
  if v_tax_amount is not null and (v_tax_amount < 0 or v_tax_amount > v_amount) then
    raise exception 'Expense tax amount must be between zero and the expense amount.';
  end if;

  v_currency = upper(coalesce(nullif(trim(coalesce(p_currency, '')), ''), v_document.detected_currency::text, 'JPY'))::char(3);
  v_method = coalesce(nullif(trim(coalesce(p_payment_method, '')), ''), 'bank_transfer');

  insert into public.expenses (
    organization_id,
    school_id,
    expense_date,
    category_id,
    vendor,
    description,
    amount,
    currency,
    tax_amount,
    payment_method,
    reference,
    receipt_reference,
    receipt_file_path,
    receipt_original_name,
    notes,
    status,
    source_type,
    source_reference,
    financial_document_id,
    created_by
  )
  values (
    v_document.organization_id,
    p_school_id,
    p_expense_date,
    p_category_id,
    nullif(trim(coalesce(p_vendor, v_document.vendor, v_document.sender, '')), ''),
    trim(coalesce(nullif(p_description, ''), v_document.title, v_document.subject, v_document.document_filename, 'Financial document')),
    v_amount,
    v_currency,
    v_tax_amount,
    v_method,
    nullif(trim(coalesce(p_reference, v_document.gmail_message_id, v_document.id::text)), ''),
    nullif(trim(coalesce(p_receipt_reference, v_document.document_filename, v_document.id::text)), ''),
    v_document.document_file_path,
    v_document.document_filename,
    nullif(trim(coalesce(p_notes, '')), ''),
    'active',
    'financial_document',
    v_document.id::text,
    v_document.id,
    (select auth.uid())
  )
  returning id into v_expense_id;

  update public.financial_documents
  set status = 'converted_to_expense',
      is_read = true,
      linked_expense_id = v_expense_id,
      processed_at = now(),
      processed_by = coalesce((select auth.uid()), processed_by)
  where id = v_document.id;

  return v_expense_id;
exception
  when unique_violation then
    select e.id into v_expense_id
    from public.expenses e
    where e.financial_document_id = p_financial_document_id
    limit 1;

    if v_expense_id is not null then
      update public.financial_documents
      set status = 'converted_to_expense',
          is_read = true,
          linked_expense_id = v_expense_id,
          processed_at = coalesce(processed_at, now()),
          processed_by = coalesce(processed_by, (select auth.uid()))
      where id = p_financial_document_id;

      return v_expense_id;
    end if;

    raise;
end;
$$;

revoke all on function public.create_expense_from_financial_document_mvp(
  uuid, uuid, date, uuid, text, text, numeric, text, numeric, text, text, text, text
) from public, anon;
grant execute on function public.create_expense_from_financial_document_mvp(
  uuid, uuid, date, uuid, text, text, numeric, text, numeric, text, text, text, text
) to authenticated, service_role;

create or replace function public.create_office_todo_mvp(
  p_organization_id uuid,
  p_school_id uuid,
  p_title text,
  p_description text default null,
  p_due_date date default null,
  p_source_type text default 'manual',
  p_source_reference text default null,
  p_assigned_profile_id uuid default null
)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_todo_id uuid;
begin
  if not exists (
    select 1 from public.schools s
    where s.id = p_school_id
      and s.organization_id = p_organization_id
  ) then
    raise exception 'School % does not belong to organization %.', p_school_id, p_organization_id;
  end if;

  if coalesce(nullif(trim(coalesce(p_source_type, '')), ''), 'manual') = 'financial_document' then
    if not public.can_manage_expenses_org(p_organization_id) then
      raise exception 'You do not have permission to create financial To Do items for this organization.';
    end if;
  elsif not public.can_manage_school(p_school_id) then
    raise exception 'You do not have permission to create To Do items for this school.';
  end if;

  insert into public.office_todo_items as oti (
    organization_id,
    school_id,
    title,
    description,
    due_date,
    source_type,
    source_reference,
    assigned_profile_id,
    created_by
  )
  values (
    p_organization_id,
    p_school_id,
    trim(p_title),
    nullif(trim(coalesce(p_description, '')), ''),
    p_due_date,
    coalesce(nullif(trim(coalesce(p_source_type, '')), ''), 'manual'),
    nullif(trim(coalesce(p_source_reference, '')), ''),
    p_assigned_profile_id,
    (select auth.uid())
  )
  on conflict (organization_id, source_type, source_reference) where source_reference is not null
  do update
  set title = excluded.title,
      description = excluded.description,
      due_date = excluded.due_date,
      assigned_profile_id = excluded.assigned_profile_id,
      updated_at = now()
  returning id into v_todo_id;

  perform public.queue_office_todo_notification_mvp(v_todo_id);

  return v_todo_id;
end;
$$;

revoke all on function public.create_office_todo_mvp(uuid, uuid, text, text, date, text, text, uuid) from public, anon;
grant execute on function public.create_office_todo_mvp(uuid, uuid, text, text, date, text, text, uuid) to authenticated;

create or replace function public.create_office_todo_for_financial_document_mvp(
  p_financial_document_id uuid,
  p_due_date date default null,
  p_assigned_profile_id uuid default null
)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_document public.financial_documents%rowtype;
begin
  select * into v_document
  from public.financial_documents fd
  where fd.id = p_financial_document_id;

  if not found then
    raise exception 'Financial document % was not found.', p_financial_document_id;
  end if;

  if not public.can_manage_expenses_org(v_document.organization_id) then
    raise exception 'You do not have permission to create To Do items for this financial document.';
  end if;

  return public.create_office_todo_mvp(
    v_document.organization_id,
    v_document.school_id,
    'Check ' || coalesce(v_document.vendor, v_document.title, v_document.subject, v_document.document_filename, 'financial document'),
    'Review financial document ' || v_document.id::text || ' and create an expense or dismiss it.',
    p_due_date,
    'financial_document',
    v_document.id::text,
    p_assigned_profile_id
  );
end;
$$;

revoke all on function public.create_office_todo_for_financial_document_mvp(uuid, date, uuid) from public, anon;
grant execute on function public.create_office_todo_for_financial_document_mvp(uuid, date, uuid) to authenticated;

create or replace function public.mark_office_todo_completed_mvp(p_todo_item_id uuid)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_todo public.office_todo_items%rowtype;
begin
  select * into v_todo
  from public.office_todo_items oti
  where oti.id = p_todo_item_id
  for update;

  if not found then
    raise exception 'To Do item % was not found.', p_todo_item_id;
  end if;

  if v_todo.source_type = 'financial_document' then
    if not public.can_manage_expenses_org(v_todo.organization_id) then
      raise exception 'You do not have permission to update this financial To Do item.';
    end if;
  elsif not public.can_manage_school(v_todo.school_id) then
    raise exception 'You do not have permission to update this To Do item.';
  end if;

  update public.office_todo_items
  set status = 'completed',
      completed_at = coalesce(completed_at, now()),
      completed_by = coalesce(completed_by, (select auth.uid()))
  where id = p_todo_item_id;

  return p_todo_item_id;
end;
$$;

revoke all on function public.mark_office_todo_completed_mvp(uuid) from public, anon;
grant execute on function public.mark_office_todo_completed_mvp(uuid) to authenticated;

alter table public.recurring_expense_templates enable row level security;
alter table public.financial_documents enable row level security;
alter table public.financial_document_rules enable row level security;
alter table public.office_todo_items enable row level security;

revoke all on public.recurring_expense_templates from anon, authenticated;
revoke all on public.financial_documents from anon, authenticated;
revoke all on public.financial_document_rules from anon, authenticated;
revoke all on public.office_todo_items from anon, authenticated;

grant select, insert, update, delete on public.recurring_expense_templates to authenticated;
grant select, insert, update, delete on public.financial_documents to authenticated;
grant select, insert, update, delete on public.financial_document_rules to authenticated;
grant select, insert, update, delete on public.office_todo_items to authenticated;

grant all on public.recurring_expense_templates to service_role;
grant all on public.financial_documents to service_role;
grant all on public.financial_document_rules to service_role;
grant all on public.office_todo_items to service_role;

drop policy if exists "recurring_expense_templates_management_access" on public.recurring_expense_templates;
create policy "recurring_expense_templates_management_access"
on public.recurring_expense_templates
for all
to authenticated
using (public.can_manage_expenses_org(organization_id))
with check (public.can_manage_expenses_org(organization_id));

drop policy if exists "financial_documents_management_access" on public.financial_documents;
create policy "financial_documents_management_access"
on public.financial_documents
for all
to authenticated
using (public.can_manage_expenses_org(organization_id))
with check (public.can_manage_expenses_org(organization_id));

drop policy if exists "financial_document_rules_management_access" on public.financial_document_rules;
create policy "financial_document_rules_management_access"
on public.financial_document_rules
for all
to authenticated
using (public.can_manage_expenses_org(organization_id))
with check (public.can_manage_expenses_org(organization_id));

drop policy if exists "office_todo_items_select_access" on public.office_todo_items;
create policy "office_todo_items_select_access"
on public.office_todo_items
for select
to authenticated
using (
  case
    when source_type = 'financial_document' then public.can_manage_expenses_org(organization_id)
    else public.can_manage_school(school_id)
  end
);

drop policy if exists "office_todo_items_insert_access" on public.office_todo_items;
create policy "office_todo_items_insert_access"
on public.office_todo_items
for insert
to authenticated
with check (
  public.can_access_org(organization_id)
  and case
    when source_type = 'financial_document' then public.can_manage_expenses_org(organization_id)
    else public.can_manage_school(school_id)
  end
);

drop policy if exists "office_todo_items_update_access" on public.office_todo_items;
create policy "office_todo_items_update_access"
on public.office_todo_items
for update
to authenticated
using (
  case
    when source_type = 'financial_document' then public.can_manage_expenses_org(organization_id)
    else public.can_manage_school(school_id)
  end
)
with check (
  public.can_access_org(organization_id)
  and case
    when source_type = 'financial_document' then public.can_manage_expenses_org(organization_id)
    else public.can_manage_school(school_id)
  end
);

drop policy if exists "office_todo_items_delete_access" on public.office_todo_items;
create policy "office_todo_items_delete_access"
on public.office_todo_items
for delete
to authenticated
using (
  case
    when source_type = 'financial_document' then public.can_manage_expenses_org(organization_id)
    else public.can_manage_school(school_id)
  end
);

drop policy if exists "communications_select_school_management" on public.communications;
create policy "communications_select_school_management"
on public.communications
for select
to authenticated
using (
  public.can_manage_school(school_id)
  and (financial_document_id is null or public.can_manage_expenses_org(organization_id))
  and (
    office_todo_item_id is null
    or exists (
      select 1
      from public.office_todo_items oti
      where oti.id = office_todo_item_id
        and (
          oti.source_type <> 'financial_document'
          or public.can_manage_expenses_org(oti.organization_id)
        )
    )
  )
);

drop policy if exists "communications_insert_school_management" on public.communications;
create policy "communications_insert_school_management"
on public.communications
for insert
to authenticated
with check (
  public.can_access_org(organization_id)
  and public.can_manage_school(school_id)
  and (sent_by is null or sent_by = (select auth.uid()))
  and financial_document_id is null
  and office_todo_item_id is null
);

drop policy if exists "communications_update_school_management" on public.communications;
create policy "communications_update_school_management"
on public.communications
for update
to authenticated
using (
  public.can_manage_school(school_id)
  and (financial_document_id is null or public.can_manage_expenses_org(organization_id))
)
with check (
  public.can_access_org(organization_id)
  and public.can_manage_school(school_id)
  and (financial_document_id is null or public.can_manage_expenses_org(organization_id))
);

drop policy if exists "communication_integration_actions_select_school_management" on public.communication_integration_actions;
create policy "communication_integration_actions_select_school_management"
on public.communication_integration_actions
for select
to authenticated
using (
  public.can_manage_school(school_id)
  and (
    communication_id is null
    or exists (
      select 1
      from public.communications c
      where c.id = communication_id
        and (c.financial_document_id is null or public.can_manage_expenses_org(c.organization_id))
    )
  )
);

notify pgrst, 'reload schema';
