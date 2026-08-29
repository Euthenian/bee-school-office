do $$
begin
  create type public.communication_channel as enum ('email', 'phone', 'calendar', 'system');
exception
  when duplicate_object then null;
end;
$$;

do $$
begin
  create type public.communication_source as enum ('manual', 'automated', 'system');
exception
  when duplicate_object then null;
end;
$$;

do $$
begin
  create type public.communication_delivery_status as enum ('draft', 'queued', 'sent', 'failed', 'partial_failed', 'skipped');
exception
  when duplicate_object then null;
end;
$$;

do $$
begin
  create type public.integration_action_status as enum ('pending', 'succeeded', 'failed', 'skipped');
exception
  when duplicate_object then null;
end;
$$;

do $$
begin
  create type public.trial_follow_up_state as enum (
    'none',
    'scheduled',
    'automated_email_queued',
    'automated_email_sent',
    'automated_email_failed',
    'phone_completed',
    'resolved',
    'rebooked',
    'cancelled'
  );
exception
  when duplicate_object then null;
end;
$$;

alter table public.trial_lessons
add column if not exists no_show_at timestamptz,
add column if not exists follow_up_due_at timestamptz,
add column if not exists automated_follow_up_sent_at timestamptz,
add column if not exists phone_follow_up_completed_at timestamptz,
add column if not exists follow_up_state public.trial_follow_up_state not null default 'none';

create table if not exists public.communication_templates (
  id uuid primary key default gen_random_uuid(),
  template_key text not null unique,
  name text not null,
  description text,
  communication_type text not null,
  channel public.communication_channel not null default 'email',
  subject_template text,
  body_template text not null,
  variable_keys text[] not null default '{}'::text[],
  is_system boolean not null default true,
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.communications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  school_id uuid not null references public.schools (id) on delete restrict,
  student_id uuid,
  prospect_id uuid,
  trial_lesson_id uuid,
  communication_type text not null,
  channel public.communication_channel not null,
  recipient text,
  subject text,
  body text,
  template_key text references public.communication_templates (template_key) on delete set null,
  sent_at timestamptz,
  sent_by uuid references public.profiles (id) on delete set null,
  source public.communication_source not null default 'manual',
  delivery_status public.communication_delivery_status not null default 'queued',
  external_provider text,
  external_message_id text,
  idempotency_key text unique,
  error_message text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id, school_id),
  constraint communications_context_check
    check (student_id is not null or prospect_id is not null or trial_lesson_id is not null),
  constraint communications_school_id_organization_id_fkey
    foreign key (school_id, organization_id)
    references public.schools (id, organization_id)
    on delete restrict,
  constraint communications_student_id_organization_id_school_id_fkey
    foreign key (student_id, organization_id, school_id)
    references public.students (id, organization_id, school_id)
    on delete restrict,
  constraint communications_prospect_id_organization_id_school_id_fkey
    foreign key (prospect_id, organization_id, school_id)
    references public.prospects (id, organization_id, school_id)
    on delete restrict,
  constraint communications_trial_lesson_id_organization_id_school_id_fkey
    foreign key (trial_lesson_id, organization_id, school_id)
    references public.trial_lessons (id, organization_id, school_id)
    on delete restrict
);

create table if not exists public.communication_integration_actions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  school_id uuid not null references public.schools (id) on delete restrict,
  communication_id uuid,
  trial_lesson_id uuid,
  provider text not null check (provider in ('gmail', 'google_calendar', 'internal')),
  action_type text not null check (action_type in ('send_email', 'create_calendar_event', 'update_calendar_event', 'cancel_calendar_event')),
  idempotency_key text not null unique,
  external_id text,
  status public.integration_action_status not null default 'pending',
  attempt_count integer not null default 0 check (attempt_count >= 0),
  last_attempt_at timestamptz,
  error_message text,
  request_payload jsonb not null default '{}'::jsonb,
  response_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint communication_integration_actions_school_id_organization_id_fkey
    foreign key (school_id, organization_id)
    references public.schools (id, organization_id)
    on delete restrict,
  constraint communication_integration_actions_communication_id_org_school_fkey
    foreign key (communication_id, organization_id, school_id)
    references public.communications (id, organization_id, school_id)
    on delete restrict,
  constraint communication_integration_actions_trial_lesson_id_org_school_fkey
    foreign key (trial_lesson_id, organization_id, school_id)
    references public.trial_lessons (id, organization_id, school_id)
    on delete restrict
);

create table if not exists public.communication_automation_settings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  school_id uuid references public.schools (id) on delete cascade,
  setting_key text not null,
  setting_value jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint communication_automation_settings_school_id_organization_id_fkey
    foreign key (school_id, organization_id)
    references public.schools (id, organization_id)
    on delete cascade,
  constraint communication_automation_settings_no_show_delay_check
    check (
      setting_key <> 'no_show_follow_up_delay_hours'
      or (
        jsonb_typeof(setting_value) = 'number'
        and (setting_value #>> '{}')::integer between 1 and 72
      )
    )
);

create unique index if not exists communication_automation_settings_school_key_idx
on public.communication_automation_settings (organization_id, school_id, setting_key)
where school_id is not null;

create unique index if not exists communication_automation_settings_org_key_idx
on public.communication_automation_settings (organization_id, setting_key)
where school_id is null;

create index if not exists communications_student_created_idx
on public.communications (student_id, created_at desc)
where student_id is not null;

create index if not exists communications_prospect_created_idx
on public.communications (prospect_id, created_at desc)
where prospect_id is not null;

create index if not exists communications_trial_lesson_created_idx
on public.communications (trial_lesson_id, created_at desc)
where trial_lesson_id is not null;

create index if not exists communications_school_created_idx
on public.communications (school_id, created_at desc);

create index if not exists communications_delivery_status_idx
on public.communications (delivery_status, created_at);

create index if not exists communication_integration_actions_pending_idx
on public.communication_integration_actions (status, provider, action_type, created_at)
where status = 'pending';

create index if not exists communication_integration_actions_trial_lesson_idx
on public.communication_integration_actions (trial_lesson_id)
where trial_lesson_id is not null;

create index if not exists trial_lessons_follow_up_due_idx
on public.trial_lessons (follow_up_due_at, follow_up_state)
where status = 'no_show' and phone_follow_up_completed_at is null;

drop trigger if exists communication_templates_set_updated_at on public.communication_templates;
create trigger communication_templates_set_updated_at
before update on public.communication_templates
for each row execute function public.set_updated_at();

drop trigger if exists communications_set_updated_at on public.communications;
create trigger communications_set_updated_at
before update on public.communications
for each row execute function public.set_updated_at();

drop trigger if exists communication_integration_actions_set_updated_at on public.communication_integration_actions;
create trigger communication_integration_actions_set_updated_at
before update on public.communication_integration_actions
for each row execute function public.set_updated_at();

drop trigger if exists communication_automation_settings_set_updated_at on public.communication_automation_settings;
create trigger communication_automation_settings_set_updated_at
before update on public.communication_automation_settings
for each row execute function public.set_updated_at();

insert into public.communication_templates (
  template_key,
  name,
  description,
  communication_type,
  channel,
  subject_template,
  body_template,
  variable_keys
)
values
  (
    'trial_lesson_confirmation',
    'Trial lesson confirmation',
    'Confirms the final trial lesson schedule and school details.',
    'trial_lesson_confirmation',
    'email',
    'Bee School trial lesson confirmation - {{confirmed_date}} {{confirmed_time}}',
    'Hello {{recipient_name}},

Your Bee School trial lesson is confirmed.

Student: {{student_name}}
Date: {{confirmed_date}}
Time: {{confirmed_time}}
School: {{school_name}}
Lesson type: {{lesson_type}}
Teacher: {{teacher}}

We look forward to seeing you.

Bee School',
    array['recipient_name', 'student_name', 'confirmed_date', 'confirmed_time', 'school_name', 'lesson_type', 'teacher']
  ),
  (
    'trial_reminder',
    'Trial reminder',
    'Reminder before a scheduled trial lesson.',
    'trial_reminder',
    'email',
    'Bee School trial lesson reminder - {{confirmed_date}} {{confirmed_time}}',
    'Hello {{recipient_name}},

This is a reminder for the upcoming Bee School trial lesson.

Student: {{student_name}}
Date: {{confirmed_date}}
Time: {{confirmed_time}}
School: {{school_name}}

Bee School',
    array['recipient_name', 'student_name', 'confirmed_date', 'confirmed_time', 'school_name']
  ),
  (
    'no_show_follow_up',
    'No-show follow-up',
    'Follow-up email after a missed trial lesson.',
    'no_show_follow_up',
    'email',
    'Bee School trial lesson follow-up',
    'Hello {{recipient_name}},

We missed you at the scheduled Bee School trial lesson.

Please reply when you would like to rebook, or call us if you prefer to arrange a new time by phone.

Bee School',
    array['recipient_name']
  ),
  (
    'schedule_change',
    'Schedule change',
    'Notifies a customer about a schedule adjustment.',
    'schedule_change',
    'email',
    'Bee School schedule update',
    'Hello {{recipient_name}},

We are writing with an update about your Bee School schedule.

Bee School',
    array['recipient_name']
  ),
  (
    'welcome_enrollment',
    'Welcome / enrollment',
    'Welcome message for a newly enrolled student.',
    'welcome_enrollment',
    'email',
    'Welcome to Bee School',
    'Hello {{recipient_name}},

Welcome to Bee School. We are happy to have {{student_name}} join us.

Bee School',
    array['recipient_name', 'student_name']
  ),
  (
    'payment_information',
    'Payment information',
    'Payment information message shell.',
    'payment_information',
    'email',
    'Bee School payment information',
    'Hello {{recipient_name}},

Here is the Bee School payment information you requested.

Bee School',
    array['recipient_name']
  ),
  (
    'general_message',
    'General message',
    'General reusable email shell.',
    'general_message',
    'email',
    'Bee School',
    'Hello {{recipient_name}},


Bee School',
    array['recipient_name']
  )
on conflict (template_key) do update
set name = excluded.name,
    description = excluded.description,
    communication_type = excluded.communication_type,
    channel = excluded.channel,
    subject_template = excluded.subject_template,
    body_template = excluded.body_template,
    variable_keys = excluded.variable_keys,
    is_system = true,
    status = 'active',
    updated_at = now();

create or replace function public.render_text_template(p_template text, p_context jsonb)
returns text
language plpgsql
stable
set search_path = public
as $$
declare
  v_key text;
  v_rendered text := coalesce(p_template, '');
  v_value text;
begin
  for v_key, v_value in
    select key, value
    from jsonb_each_text(coalesce(p_context, '{}'::jsonb))
  loop
    v_rendered = replace(v_rendered, '{{' || v_key || '}}', coalesce(v_value, ''));
  end loop;

  return v_rendered;
end;
$$;

revoke all on function public.render_text_template(text, jsonb) from public, anon;
grant execute on function public.render_text_template(text, jsonb) to authenticated, service_role;

create or replace function public.get_no_show_follow_up_delay(
  p_organization_id uuid,
  p_school_id uuid
)
returns interval
language sql
stable
security definer
set search_path = public
as $$
  with selected_setting as (
    select (setting_value #>> '{}')::integer as delay_hours
    from public.communication_automation_settings
    where organization_id = p_organization_id
      and setting_key = 'no_show_follow_up_delay_hours'
      and (school_id = p_school_id or school_id is null)
    order by case when school_id = p_school_id then 0 else 1 end
    limit 1
  )
  select make_interval(hours => coalesce((select delay_hours from selected_setting), 48));
$$;

revoke all on function public.get_no_show_follow_up_delay(uuid, uuid) from public, anon;
grant execute on function public.get_no_show_follow_up_delay(uuid, uuid) to authenticated, service_role;

create or replace function public.apply_trial_lesson_follow_up_state()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status = 'no_show' then
    if tg_op = 'INSERT' or old.status is distinct from new.status or new.no_show_at is null then
      new.no_show_at = coalesce(new.no_show_at, now());
      new.follow_up_due_at = coalesce(
        new.follow_up_due_at,
        new.no_show_at + public.get_no_show_follow_up_delay(new.organization_id, new.school_id)
      );

      if new.follow_up_state in ('none', 'resolved', 'rebooked', 'cancelled') then
        new.follow_up_state = 'scheduled';
      end if;
    end if;

    return new;
  end if;

  if tg_op = 'UPDATE' and old.status = 'no_show' then
    new.follow_up_due_at = null;
    new.follow_up_state = case
      when new.status = 'booked' then 'rebooked'::public.trial_follow_up_state
      when new.status = 'cancelled' then 'cancelled'::public.trial_follow_up_state
      else 'resolved'::public.trial_follow_up_state
    end;
  end if;

  return new;
end;
$$;

revoke all on function public.apply_trial_lesson_follow_up_state() from public, anon, authenticated;

drop trigger if exists trial_lessons_follow_up_state on public.trial_lessons;
create trigger trial_lessons_follow_up_state
before insert or update of status, no_show_at, follow_up_due_at
on public.trial_lessons
for each row execute function public.apply_trial_lesson_follow_up_state();

update public.trial_lessons tl
set no_show_at = coalesce(tl.no_show_at, tl.updated_at, now()),
    follow_up_due_at = coalesce(
      tl.follow_up_due_at,
      coalesce(tl.no_show_at, tl.updated_at, now()) + public.get_no_show_follow_up_delay(tl.organization_id, tl.school_id)
    ),
    follow_up_state = case
      when tl.phone_follow_up_completed_at is not null then 'phone_completed'::public.trial_follow_up_state
      when tl.follow_up_state = 'none' then 'scheduled'::public.trial_follow_up_state
      else tl.follow_up_state
    end
where tl.status = 'no_show';

create or replace function public.queue_communication_mvp(
  p_organization_id uuid,
  p_school_id uuid,
  p_student_id uuid default null,
  p_prospect_id uuid default null,
  p_trial_lesson_id uuid default null,
  p_communication_type text default 'custom',
  p_channel public.communication_channel default 'email',
  p_recipient text default null,
  p_subject text default null,
  p_body text default null,
  p_template_key text default null
)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_communication_id uuid;
begin
  if p_organization_id is null or p_school_id is null then
    raise exception 'Organization and school are required for communication records.';
  end if;

  if not exists (
    select 1
    from public.schools s
    where s.id = p_school_id
      and s.organization_id = p_organization_id
  ) then
    raise exception 'School % does not belong to organization %.', p_school_id, p_organization_id;
  end if;

  if not public.can_manage_school(p_school_id) then
    raise exception 'You do not have permission to send communications for this school.';
  end if;

  if p_student_id is null and p_prospect_id is null and p_trial_lesson_id is null then
    raise exception 'A student, prospect, or trial lesson context is required.';
  end if;

  if p_student_id is not null and not exists (
    select 1
    from public.students st
    where st.id = p_student_id
      and st.organization_id = p_organization_id
      and st.school_id = p_school_id
  ) then
    raise exception 'Student % does not belong to the selected tenant.', p_student_id;
  end if;

  if p_prospect_id is not null and not exists (
    select 1
    from public.prospects pr
    where pr.id = p_prospect_id
      and pr.organization_id = p_organization_id
      and pr.school_id = p_school_id
  ) then
    raise exception 'Prospect % does not belong to the selected tenant.', p_prospect_id;
  end if;

  if p_trial_lesson_id is not null and not exists (
    select 1
    from public.trial_lessons tl
    where tl.id = p_trial_lesson_id
      and tl.organization_id = p_organization_id
      and tl.school_id = p_school_id
  ) then
    raise exception 'Trial lesson % does not belong to the selected tenant.', p_trial_lesson_id;
  end if;

  if p_channel = 'email' and nullif(trim(coalesce(p_recipient, '')), '') is null then
    raise exception 'Recipient is required for email communication.';
  end if;

  if nullif(trim(coalesce(p_body, '')), '') is null then
    raise exception 'Message body is required.';
  end if;

  insert into public.communications as c (
    organization_id,
    school_id,
    student_id,
    prospect_id,
    trial_lesson_id,
    communication_type,
    channel,
    recipient,
    subject,
    body,
    template_key,
    sent_by,
    source,
    delivery_status,
    external_provider,
    metadata
  )
  values (
    p_organization_id,
    p_school_id,
    p_student_id,
    p_prospect_id,
    p_trial_lesson_id,
    coalesce(nullif(trim(p_communication_type), ''), 'custom'),
    p_channel,
    nullif(trim(coalesce(p_recipient, '')), ''),
    nullif(trim(coalesce(p_subject, '')), ''),
    trim(p_body),
    nullif(trim(coalesce(p_template_key, '')), ''),
    (select auth.uid()),
    'manual',
    case when p_channel = 'email' then 'queued' else 'sent' end,
    case when p_channel = 'email' then 'gmail' else null end,
    jsonb_build_object('queued_from', 'bee_school_office')
  )
  returning id into v_communication_id;

  if p_channel = 'email' then
    insert into public.communication_integration_actions (
      organization_id,
      school_id,
      communication_id,
      trial_lesson_id,
      provider,
      action_type,
      idempotency_key,
      request_payload
    )
    values (
      p_organization_id,
      p_school_id,
      v_communication_id,
      p_trial_lesson_id,
      'gmail',
      'send_email',
      'communication:' || v_communication_id::text || ':gmail_send',
      jsonb_build_object(
        'recipient', nullif(trim(coalesce(p_recipient, '')), ''),
        'subject', nullif(trim(coalesce(p_subject, '')), ''),
        'body', trim(p_body),
        'template_key', nullif(trim(coalesce(p_template_key, '')), ''),
        'communication_type', coalesce(nullif(trim(p_communication_type), ''), 'custom')
      )
    );
  end if;

  return v_communication_id;
end;
$$;

revoke all on function public.queue_communication_mvp(
  uuid,
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  public.communication_channel,
  text,
  text,
  text,
  text
) from public, anon;

grant execute on function public.queue_communication_mvp(
  uuid,
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  public.communication_channel,
  text,
  text,
  text,
  text
) to authenticated;

create or replace function public.confirm_trial_lesson_mvp(
  p_trial_lesson_id uuid,
  p_trial_date date default null,
  p_trial_time time default null,
  p_assigned_teacher_profile_id uuid default null
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_calendar_action_id uuid;
  v_calendar_idempotency_key text;
  v_calendar_status public.integration_action_status;
  v_communication_id uuid;
  v_context jsonb;
  v_email_idempotency_key text;
  v_email_status public.communication_delivery_status;
  v_participant_name text;
  v_prospect public.prospects%rowtype;
  v_recipient text;
  v_school_name text;
  v_subject text;
  v_body text;
  v_template public.communication_templates%rowtype;
  v_trial public.trial_lessons%rowtype;
  v_teacher_name text;
begin
  select * into v_trial
  from public.trial_lessons tl
  where tl.id = p_trial_lesson_id
  for update;

  if not found then
    raise exception 'Trial lesson % was not found or is not accessible.', p_trial_lesson_id;
  end if;

  if v_trial.status = 'joined' then
    raise exception 'Converted trial lessons cannot be reconfirmed.';
  end if;

  if not public.can_manage_school(v_trial.school_id) then
    raise exception 'You do not have permission to confirm this trial lesson.';
  end if;

  update public.trial_lessons
  set trial_date = coalesce(p_trial_date, trial_date),
      trial_time = coalesce(p_trial_time, trial_time),
      assigned_teacher_profile_id = coalesce(p_assigned_teacher_profile_id, assigned_teacher_profile_id),
      status = 'booked',
      updated_at = now()
  where id = v_trial.id
  returning * into v_trial;

  select * into v_prospect
  from public.prospects pr
  where pr.id = v_trial.prospect_id;

  select s.name into v_school_name
  from public.schools s
  where s.id = v_trial.school_id;

  select coalesce(p.full_name, p.email::text) into v_teacher_name
  from public.profiles p
  where p.id = v_trial.assigned_teacher_profile_id;

  select coalesce(nullif(trim(tlp.alphabet_name), ''), nullif(trim(tlp.japanese_name), '')) into v_participant_name
  from public.trial_lesson_participants tlp
  where tlp.trial_lesson_id = v_trial.id
  order by tlp.created_at, tlp.id
  limit 1;

  select pc.value into v_recipient
  from public.prospect_contacts pc
  where pc.prospect_id = v_trial.prospect_id
    and pc.contact_type = 'email'
  order by pc.is_primary desc, pc.created_at, pc.id
  limit 1;

  select * into v_template
  from public.communication_templates ct
  where ct.template_key = 'trial_lesson_confirmation'
    and ct.status = 'active';

  if not found then
    raise exception 'Trial lesson confirmation communication template is missing.';
  end if;

  v_context = jsonb_build_object(
    'recipient_name', coalesce(nullif(trim(v_prospect.alphabet_name), ''), nullif(trim(v_prospect.japanese_name), ''), 'there'),
    'prospect_name', coalesce(nullif(trim(v_prospect.alphabet_name), ''), nullif(trim(v_prospect.japanese_name), ''), 'Prospect'),
    'student_name', coalesce(v_participant_name, nullif(trim(v_prospect.alphabet_name), ''), nullif(trim(v_prospect.japanese_name), ''), 'Student'),
    'confirmed_date', to_char(v_trial.trial_date, 'YYYY-MM-DD'),
    'confirmed_time', to_char(v_trial.trial_time, 'HH24:MI'),
    'school_name', coalesce(v_school_name, 'Bee School'),
    'lesson_type', initcap(replace(v_trial.lesson_type::text, '_', ' ')),
    'teacher', coalesce(v_teacher_name, 'Not assigned')
  );

  v_subject = public.render_text_template(v_template.subject_template, v_context);
  v_body = public.render_text_template(v_template.body_template, v_context);
  v_email_idempotency_key = 'trial_lesson:' || v_trial.id::text || ':trial_lesson_confirmation_email';
  v_calendar_idempotency_key = 'trial_lesson:' || v_trial.id::text || ':google_calendar_event';

  insert into public.communications (
    organization_id,
    school_id,
    prospect_id,
    trial_lesson_id,
    communication_type,
    channel,
    recipient,
    subject,
    body,
    template_key,
    sent_by,
    source,
    delivery_status,
    external_provider,
    idempotency_key,
    error_message,
    metadata
  )
  values (
    v_trial.organization_id,
    v_trial.school_id,
    v_trial.prospect_id,
    v_trial.id,
    'trial_lesson_confirmation',
    'email',
    nullif(trim(coalesce(v_recipient, '')), ''),
    v_subject,
    v_body,
    'trial_lesson_confirmation',
    (select auth.uid()),
    'manual',
    case
      when nullif(trim(coalesce(v_recipient, '')), '') is null then 'failed'::public.communication_delivery_status
      else 'queued'::public.communication_delivery_status
    end,
    'gmail',
    v_email_idempotency_key,
    case
      when nullif(trim(coalesce(v_recipient, '')), '') is null then 'No email contact exists for this prospect.'
      else null
    end,
    v_context
  )
  on conflict (idempotency_key) do update
  set recipient = case when c.delivery_status = 'sent' then c.recipient else excluded.recipient end,
      subject = case when c.delivery_status = 'sent' then c.subject else excluded.subject end,
      body = case when c.delivery_status = 'sent' then c.body else excluded.body end,
      sent_by = coalesce(c.sent_by, excluded.sent_by),
      delivery_status = case when c.delivery_status = 'sent' then c.delivery_status else excluded.delivery_status end,
      error_message = case when c.delivery_status = 'sent' then c.error_message else excluded.error_message end,
      metadata = case when c.delivery_status = 'sent' then c.metadata else excluded.metadata end,
      updated_at = now()
  returning id, delivery_status into v_communication_id, v_email_status;

  insert into public.communication_integration_actions as cia (
    organization_id,
    school_id,
    communication_id,
    trial_lesson_id,
    provider,
    action_type,
    idempotency_key,
    status,
    error_message,
    request_payload
  )
  values (
    v_trial.organization_id,
    v_trial.school_id,
    v_communication_id,
    v_trial.id,
    'gmail',
    'send_email',
    v_email_idempotency_key,
    case
      when nullif(trim(coalesce(v_recipient, '')), '') is null then 'failed'::public.integration_action_status
      else 'pending'::public.integration_action_status
    end,
    case
      when nullif(trim(coalesce(v_recipient, '')), '') is null then 'No email contact exists for this prospect.'
      else null
    end,
    jsonb_build_object(
      'recipient', nullif(trim(coalesce(v_recipient, '')), ''),
      'subject', v_subject,
      'body', v_body,
      'template_key', 'trial_lesson_confirmation',
      'context', v_context
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
      error_message = case
        when cia.status = 'succeeded' then cia.error_message
        else excluded.error_message
      end,
      updated_at = now()
  returning id into v_calendar_action_id;

  insert into public.communication_integration_actions as cia (
    organization_id,
    school_id,
    trial_lesson_id,
    provider,
    action_type,
    idempotency_key,
    request_payload
  )
  values (
    v_trial.organization_id,
    v_trial.school_id,
    v_trial.id,
    'google_calendar',
    'create_calendar_event',
    v_calendar_idempotency_key,
    jsonb_build_object(
      'trial_lesson_id', v_trial.id,
      'summary', 'Bee School Trial Lesson - ' || coalesce(v_participant_name, v_prospect.japanese_name),
      'date', to_char(v_trial.trial_date, 'YYYY-MM-DD'),
      'time', to_char(v_trial.trial_time, 'HH24:MI'),
      'duration_minutes', 60,
      'school_name', coalesce(v_school_name, 'Bee School'),
      'teacher', coalesce(v_teacher_name, ''),
      'prospect_id', v_trial.prospect_id
    )
  )
  on conflict (idempotency_key) do update
  set request_payload = case
        when cia.status = 'succeeded' then cia.request_payload
        else excluded.request_payload
      end,
      status = case
        when cia.status = 'succeeded' then cia.status
        else excluded.status
      end,
      updated_at = now()
  returning id, status into v_calendar_action_id, v_calendar_status;

  return jsonb_build_object(
    'trial_lesson_id', v_trial.id,
    'status', v_trial.status,
    'communication_id', v_communication_id,
    'email_delivery_status', v_email_status,
    'email_idempotency_key', v_email_idempotency_key,
    'calendar_action_id', v_calendar_action_id,
    'calendar_status', v_calendar_status,
    'calendar_idempotency_key', v_calendar_idempotency_key
  );
end;
$$;

revoke all on function public.confirm_trial_lesson_mvp(uuid, date, time, uuid) from public, anon;
grant execute on function public.confirm_trial_lesson_mvp(uuid, date, time, uuid) to authenticated;

create or replace function public.enqueue_due_no_show_follow_ups(p_limit integer default 50)
returns table (
  trial_lesson_id uuid,
  communication_id uuid,
  action_id uuid,
  recipient text,
  delivery_status public.communication_delivery_status,
  action_status public.integration_action_status
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_action_id uuid;
  v_body text;
  v_communication_id uuid;
  v_context jsonb;
  v_delivery_status public.communication_delivery_status;
  v_email_idempotency_key text;
  v_email_status public.communication_delivery_status;
  v_participant_name text;
  v_prospect public.prospects%rowtype;
  v_recipient text;
  v_row public.trial_lessons%rowtype;
  v_subject text;
  v_template public.communication_templates%rowtype;
begin
  select * into v_template
  from public.communication_templates ct
  where ct.template_key = 'no_show_follow_up'
    and ct.status = 'active';

  if not found then
    raise exception 'No-show follow-up communication template is missing.';
  end if;

  for v_row in
    select *
    from public.trial_lessons tl
    where tl.status = 'no_show'
      and tl.follow_up_due_at is not null
      and tl.follow_up_due_at <= now()
      and tl.follow_up_due_at <= coalesce(tl.no_show_at, tl.follow_up_due_at) + interval '3 days'
      and tl.automated_follow_up_sent_at is null
      and tl.phone_follow_up_completed_at is null
      and tl.follow_up_state in ('scheduled', 'automated_email_failed')
    order by tl.follow_up_due_at, tl.id
    limit greatest(1, least(coalesce(p_limit, 50), 200))
    for update skip locked
  loop
    select * into v_prospect
    from public.prospects pr
    where pr.id = v_row.prospect_id;

    select coalesce(nullif(trim(tlp.alphabet_name), ''), nullif(trim(tlp.japanese_name), '')) into v_participant_name
    from public.trial_lesson_participants tlp
    where tlp.trial_lesson_id = v_row.id
    order by tlp.created_at, tlp.id
    limit 1;

    select pc.value into v_recipient
    from public.prospect_contacts pc
    where pc.prospect_id = v_row.prospect_id
      and pc.contact_type = 'email'
    order by pc.is_primary desc, pc.created_at, pc.id
    limit 1;

    v_context = jsonb_build_object(
      'recipient_name', coalesce(nullif(trim(v_prospect.alphabet_name), ''), nullif(trim(v_prospect.japanese_name), ''), 'there'),
      'student_name', coalesce(v_participant_name, nullif(trim(v_prospect.alphabet_name), ''), nullif(trim(v_prospect.japanese_name), ''), 'Student')
    );

    v_subject = public.render_text_template(v_template.subject_template, v_context);
    v_body = public.render_text_template(v_template.body_template, v_context);
    v_email_idempotency_key = 'trial_lesson:' || v_row.id::text || ':no_show_follow_up_email';
    v_email_status = case
      when nullif(trim(coalesce(v_recipient, '')), '') is null then 'failed'::public.communication_delivery_status
      else 'queued'::public.communication_delivery_status
    end;

    insert into public.communications as c (
      organization_id,
      school_id,
      prospect_id,
      trial_lesson_id,
      communication_type,
      channel,
      recipient,
      subject,
      body,
      template_key,
      source,
      delivery_status,
      external_provider,
      idempotency_key,
      error_message,
      metadata
    )
    values (
      v_row.organization_id,
      v_row.school_id,
      v_row.prospect_id,
      v_row.id,
      'no_show_follow_up',
      'email',
      nullif(trim(coalesce(v_recipient, '')), ''),
      v_subject,
      v_body,
      'no_show_follow_up',
      'automated',
      v_email_status,
      'gmail',
      v_email_idempotency_key,
      case when v_email_status = 'failed' then 'No email contact exists for this prospect.' else null end,
      v_context
    )
    on conflict (idempotency_key) do update
    set recipient = case when c.delivery_status = 'sent' then c.recipient else excluded.recipient end,
        subject = case when c.delivery_status = 'sent' then c.subject else excluded.subject end,
        body = case when c.delivery_status = 'sent' then c.body else excluded.body end,
        delivery_status = case when c.delivery_status = 'sent' then c.delivery_status else excluded.delivery_status end,
        error_message = case when c.delivery_status = 'sent' then c.error_message else excluded.error_message end,
        metadata = case when c.delivery_status = 'sent' then c.metadata else excluded.metadata end,
        updated_at = now()
    returning id, delivery_status into v_communication_id, v_delivery_status;

    insert into public.communication_integration_actions as cia (
      organization_id,
      school_id,
      communication_id,
      trial_lesson_id,
      provider,
      action_type,
      idempotency_key,
      status,
      error_message,
      request_payload
    )
    values (
      v_row.organization_id,
      v_row.school_id,
      v_communication_id,
      v_row.id,
      'gmail',
      'send_email',
      v_email_idempotency_key,
      case when v_delivery_status = 'failed' then 'failed'::public.integration_action_status else 'pending'::public.integration_action_status end,
      case when v_delivery_status = 'failed' then 'No email contact exists for this prospect.' else null end,
      jsonb_build_object(
        'recipient', nullif(trim(coalesce(v_recipient, '')), ''),
        'subject', v_subject,
        'body', v_body,
        'template_key', 'no_show_follow_up',
        'context', v_context
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
        error_message = case
          when cia.status = 'succeeded' then cia.error_message
          else excluded.error_message
        end,
        updated_at = now()
    returning id, status into v_action_id, action_status;

    update public.trial_lessons
    set follow_up_state = case
          when v_delivery_status = 'failed' then 'automated_email_failed'::public.trial_follow_up_state
          else 'automated_email_queued'::public.trial_follow_up_state
        end,
        updated_at = now()
    where id = v_row.id;

    trial_lesson_id = v_row.id;
    communication_id = v_communication_id;
    action_id = v_action_id;
    recipient = v_recipient;
    delivery_status = v_delivery_status;
    return next;
  end loop;
end;
$$;

revoke all on function public.enqueue_due_no_show_follow_ups(integer) from public, anon, authenticated;
grant execute on function public.enqueue_due_no_show_follow_ups(integer) to service_role;

create or replace function public.record_communication_integration_result(
  p_idempotency_key text,
  p_status public.integration_action_status,
  p_external_id text default null,
  p_error_message text default null,
  p_response_payload jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_action public.communication_integration_actions%rowtype;
  v_communication public.communications%rowtype;
begin
  if p_status not in ('succeeded', 'failed', 'skipped') then
    raise exception 'Only terminal integration statuses can be recorded.';
  end if;

  update public.communication_integration_actions cia
  set status = p_status,
      external_id = coalesce(nullif(trim(coalesce(p_external_id, '')), ''), cia.external_id),
      error_message = nullif(trim(coalesce(p_error_message, '')), ''),
      response_payload = coalesce(p_response_payload, '{}'::jsonb),
      attempt_count = cia.attempt_count + 1,
      last_attempt_at = now(),
      updated_at = now()
  where cia.idempotency_key = p_idempotency_key
  returning * into v_action;

  if not found then
    raise exception 'Integration action % was not found.', p_idempotency_key;
  end if;

  if v_action.communication_id is not null then
    update public.communications c
    set delivery_status = case
          when p_status = 'succeeded' then 'sent'::public.communication_delivery_status
          when p_status = 'failed' then 'failed'::public.communication_delivery_status
          else 'skipped'::public.communication_delivery_status
        end,
        sent_at = case when p_status = 'succeeded' then coalesce(c.sent_at, now()) else c.sent_at end,
        external_message_id = case when p_status = 'succeeded' then coalesce(nullif(trim(coalesce(p_external_id, '')), ''), c.external_message_id) else c.external_message_id end,
        error_message = nullif(trim(coalesce(p_error_message, '')), ''),
        updated_at = now()
    where c.id = v_action.communication_id
    returning * into v_communication;
  end if;

  if v_action.trial_lesson_id is not null
    and v_action.action_type = 'send_email'
    and v_communication.template_key = 'no_show_follow_up'
    and v_communication.source = 'automated'
  then
    update public.trial_lessons
    set automated_follow_up_sent_at = case
          when p_status = 'succeeded' then coalesce(automated_follow_up_sent_at, now())
          else automated_follow_up_sent_at
        end,
        follow_up_state = case
          when p_status = 'succeeded' then 'automated_email_sent'::public.trial_follow_up_state
          when p_status = 'failed' then 'automated_email_failed'::public.trial_follow_up_state
          else follow_up_state
        end,
        updated_at = now()
    where id = v_action.trial_lesson_id
      and status = 'no_show';
  end if;
end;
$$;

revoke all on function public.record_communication_integration_result(
  text,
  public.integration_action_status,
  text,
  text,
  jsonb
) from public, anon, authenticated;

grant execute on function public.record_communication_integration_result(
  text,
  public.integration_action_status,
  text,
  text,
  jsonb
) to service_role;

create or replace function public.mark_trial_lesson_phone_follow_up_complete(p_trial_lesson_id uuid)
returns timestamptz
language plpgsql
set search_path = public
as $$
declare
  v_completed_at timestamptz;
  v_trial public.trial_lessons%rowtype;
begin
  select * into v_trial
  from public.trial_lessons tl
  where tl.id = p_trial_lesson_id
  for update;

  if not found then
    raise exception 'Trial lesson % was not found or is not accessible.', p_trial_lesson_id;
  end if;

  if not public.can_manage_school(v_trial.school_id) then
    raise exception 'You do not have permission to update follow-up for this trial lesson.';
  end if;

  update public.trial_lessons
  set phone_follow_up_completed_at = coalesce(phone_follow_up_completed_at, now()),
      follow_up_state = 'phone_completed',
      updated_at = now()
  where id = v_trial.id
  returning phone_follow_up_completed_at into v_completed_at;

  return v_completed_at;
end;
$$;

revoke all on function public.mark_trial_lesson_phone_follow_up_complete(uuid) from public, anon;
grant execute on function public.mark_trial_lesson_phone_follow_up_complete(uuid) to authenticated;

alter table public.communication_templates enable row level security;
alter table public.communications enable row level security;
alter table public.communication_integration_actions enable row level security;
alter table public.communication_automation_settings enable row level security;

revoke all on public.communication_templates from anon, authenticated;
revoke all on public.communications from anon, authenticated;
revoke all on public.communication_integration_actions from anon, authenticated;
revoke all on public.communication_automation_settings from anon, authenticated;

grant select on public.communication_templates to authenticated;
grant select, insert, update, delete on public.communications to authenticated;
grant select, insert, update on public.communication_integration_actions to authenticated;
grant select, insert, update, delete on public.communication_automation_settings to authenticated;

grant all on public.communication_templates to service_role;
grant all on public.communications to service_role;
grant all on public.communication_integration_actions to service_role;
grant all on public.communication_automation_settings to service_role;

drop policy if exists "communication_templates_select_active" on public.communication_templates;
create policy "communication_templates_select_active"
on public.communication_templates
for select
to authenticated
using (status = 'active');

drop policy if exists "communications_select_school_management" on public.communications;
create policy "communications_select_school_management"
on public.communications
for select
to authenticated
using (public.can_manage_school(school_id));

drop policy if exists "communications_insert_school_management" on public.communications;
create policy "communications_insert_school_management"
on public.communications
for insert
to authenticated
with check (
  public.can_access_org(organization_id)
  and public.can_manage_school(school_id)
  and (sent_by is null or sent_by = (select auth.uid()))
);

drop policy if exists "communications_update_school_management" on public.communications;
create policy "communications_update_school_management"
on public.communications
for update
to authenticated
using (public.can_manage_school(school_id))
with check (
  public.can_access_org(organization_id)
  and public.can_manage_school(school_id)
);

drop policy if exists "communications_delete_super_admin" on public.communications;
create policy "communications_delete_super_admin"
on public.communications
for delete
to authenticated
using (public.is_super_admin());

drop policy if exists "communication_integration_actions_select_school_management" on public.communication_integration_actions;
create policy "communication_integration_actions_select_school_management"
on public.communication_integration_actions
for select
to authenticated
using (public.can_manage_school(school_id));

drop policy if exists "communication_integration_actions_insert_school_management" on public.communication_integration_actions;
create policy "communication_integration_actions_insert_school_management"
on public.communication_integration_actions
for insert
to authenticated
with check (
  public.can_access_org(organization_id)
  and public.can_manage_school(school_id)
);

drop policy if exists "communication_integration_actions_update_school_management" on public.communication_integration_actions;
create policy "communication_integration_actions_update_school_management"
on public.communication_integration_actions
for update
to authenticated
using (public.can_manage_school(school_id))
with check (
  public.can_access_org(organization_id)
  and public.can_manage_school(school_id)
);

drop policy if exists "communication_automation_settings_select_management" on public.communication_automation_settings;
create policy "communication_automation_settings_select_management"
on public.communication_automation_settings
for select
to authenticated
using (
  public.is_super_admin()
  or (school_id is not null and public.can_manage_school(school_id))
  or (
    school_id is null
    and public.has_org_role(organization_id, array['franchise_owner', 'office_staff']::public.membership_role[])
  )
);

drop policy if exists "communication_automation_settings_insert_management" on public.communication_automation_settings;
create policy "communication_automation_settings_insert_management"
on public.communication_automation_settings
for insert
to authenticated
with check (
  public.is_super_admin()
  or (school_id is not null and public.can_manage_school(school_id))
  or (
    school_id is null
    and public.has_org_role(organization_id, array['franchise_owner', 'office_staff']::public.membership_role[])
  )
);

drop policy if exists "communication_automation_settings_update_management" on public.communication_automation_settings;
create policy "communication_automation_settings_update_management"
on public.communication_automation_settings
for update
to authenticated
using (
  public.is_super_admin()
  or (school_id is not null and public.can_manage_school(school_id))
  or (
    school_id is null
    and public.has_org_role(organization_id, array['franchise_owner', 'office_staff']::public.membership_role[])
  )
)
with check (
  public.is_super_admin()
  or (school_id is not null and public.can_manage_school(school_id))
  or (
    school_id is null
    and public.has_org_role(organization_id, array['franchise_owner', 'office_staff']::public.membership_role[])
  )
);

drop policy if exists "communication_automation_settings_delete_super_admin" on public.communication_automation_settings;
create policy "communication_automation_settings_delete_super_admin"
on public.communication_automation_settings
for delete
to authenticated
using (public.is_super_admin());

notify pgrst, 'reload schema';
