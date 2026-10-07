-- Communication Center V1 uses the existing template and outbound queue tables.
drop policy if exists "communication_templates_select_active" on public.communication_templates;
create policy "communication_templates_select_active"
on public.communication_templates for select to authenticated
using (status = 'active' or public.is_super_admin());

create function public.validate_student_email_template_mvp(
  p_subject text, p_body text, p_variable_keys text[]
)
returns void
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_key text;
  v_match text[];
  v_source text;
begin
  if nullif(btrim(coalesce(p_subject, '')), '') is null
    or nullif(btrim(coalesce(p_body, '')), '') is null then
    raise exception 'Subject and body are required.';
  end if;
  if p_variable_keys is null or array_position(p_variable_keys, null) is not null then
    raise exception 'Allowed variables must be specified.';
  end if;
  foreach v_key in array p_variable_keys loop
    if v_key not in ('student_name', 'student_email', 'recipient_name', 'school_name') then
      raise exception 'Unknown template variable: %', v_key;
    end if;
  end loop;
  foreach v_source in array array[p_subject, p_body] loop
    for v_match in select regexp_matches(v_source, '\{\{([^{}]*)\}\}', 'g') loop
      v_key := btrim(v_match[1]);
      if v_key not in ('student_name', 'student_email', 'recipient_name', 'school_name')
        or not v_key = any(p_variable_keys) then
        raise exception 'Unknown or undeclared template variable: %', v_key;
      end if;
    end loop;
    if regexp_replace(v_source, '\{\{[^{}]*\}\}', '', 'g') ~ '\{\{|\}\}' then
      raise exception 'Malformed template variable.';
    end if;
  end loop;
end;
$$;
revoke all on function public.validate_student_email_template_mvp(text, text, text[]) from public, anon, authenticated;

create function public.save_student_email_template_mvp(
  p_template_id uuid,
  p_template_key text,
  p_name text,
  p_subject text,
  p_body text,
  p_variable_keys text[],
  p_status text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  if auth.uid() is null or not public.is_super_admin() then
    raise exception 'Only super admins can manage templates.';
  end if;
  if p_template_key is null or p_template_key !~ '^[a-z][a-z0-9_]*$'
    or nullif(btrim(coalesce(p_name, '')), '') is null
    or p_status not in ('active', 'inactive') or p_status is null then
    raise exception 'A valid key, name, and status are required.';
  end if;
  perform public.validate_student_email_template_mvp(p_subject, p_body, p_variable_keys);

  if p_template_id is null then
    insert into public.communication_templates (
      template_key, name, communication_type, channel, subject_template,
      body_template, variable_keys, is_system, status
    ) values (
      p_template_key, btrim(p_name), 'custom', 'email', p_subject,
      p_body, p_variable_keys, false, p_status
    ) returning id into v_id;
  else
    update public.communication_templates
    set name = btrim(p_name), subject_template = p_subject,
      body_template = p_body, variable_keys = p_variable_keys, status = p_status
    where id = p_template_id and template_key = p_template_key and channel = 'email'
    returning id into v_id;
    if v_id is null then
      raise exception 'Email template not found or its key was changed.';
    end if;
  end if;
  return v_id;
end;
$$;
revoke all on function public.save_student_email_template_mvp(uuid, text, text, text, text, text[], text) from public, anon;
grant execute on function public.save_student_email_template_mvp(uuid, text, text, text, text, text[], text) to authenticated;

create function public.resolve_student_email_template_mvp(p_template_key text, p_student_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_student public.students%rowtype;
  v_school_name text;
  v_template public.communication_templates%rowtype;
  v_recipient text;
  v_name text;
  v_subject text;
  v_body text;
  v_match text[];
  v_key text;
  v_value text;
begin
  select * into v_student from public.students where id = p_student_id;
  if not found or auth.uid() is null or not public.can_manage_school(v_student.school_id) then
    raise exception 'Student not found or permission denied.';
  end if;
  select * into v_template from public.communication_templates
  where template_key = p_template_key and status = 'active' and channel = 'email';
  if not found then
    raise exception 'Active email template not found.';
  end if;
  perform public.validate_student_email_template_mvp(
    v_template.subject_template, v_template.body_template, v_template.variable_keys
  );

  select btrim(c.value) into v_recipient
  from public.student_contacts c
  where c.student_id = p_student_id and c.contact_type = 'email'
    and btrim(c.value) ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  order by c.is_primary desc, c.created_at asc, c.id asc
  limit 1;
  if v_recipient is null then
    raise exception 'No valid email recipient';
  end if;

  v_name := nullif(concat_ws(' ', nullif(btrim(v_student.first_name), ''), nullif(btrim(v_student.last_name), '')), '');
  v_name := coalesce(v_name, nullif(btrim(v_student.legacy_japanese_name), ''));
  if v_name is not null and nullif(btrim(v_student.preferred_name), '') is not null then
    v_name := v_name || ' (' || btrim(v_student.preferred_name) || ')';
  end if;
  select nullif(btrim(s.name), '') into v_school_name
  from public.schools s where s.id = v_student.school_id and s.organization_id = v_student.organization_id;

  v_subject := v_template.subject_template;
  v_body := v_template.body_template;
  for v_match in select regexp_matches(v_subject || E'\n' || v_body, '\{\{([^{}]*)\}\}', 'g') loop
    v_key := btrim(v_match[1]);
    v_value := case v_key
      when 'student_name' then v_name
      when 'student_email' then v_recipient
      when 'recipient_name' then v_name
      when 'school_name' then v_school_name
      else null end;
    if nullif(btrim(coalesce(v_value, '')), '') is null then
      raise exception 'Missing template variable: %', v_key;
    end if;
    v_subject := replace(v_subject, '{{' || v_match[1] || '}}', v_value);
    v_body := replace(v_body, '{{' || v_match[1] || '}}', v_value);
  end loop;
  return jsonb_build_object(
    'template_key', v_template.template_key,
    'recipient', v_recipient, 'subject', v_subject, 'body', v_body,
    'student_id', v_student.id, 'school_id', v_student.school_id,
    'organization_id', v_student.organization_id,
    'communication_type', v_template.communication_type
  );
end;
$$;
revoke all on function public.resolve_student_email_template_mvp(text, uuid) from public, anon, authenticated;

create function public.preview_student_email_template_mvp(p_template_key text, p_student_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  return public.resolve_student_email_template_mvp(p_template_key, p_student_id);
end;
$$;
revoke all on function public.preview_student_email_template_mvp(text, uuid) from public, anon;
grant execute on function public.preview_student_email_template_mvp(text, uuid) to authenticated;

create function public.send_student_email_template_mvp(p_template_key text, p_student_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_message jsonb;
begin
  -- Always resolve again; the browser's preview is never a send payload.
  v_message := public.resolve_student_email_template_mvp(p_template_key, p_student_id);
  return public.queue_communication_mvp(
    (v_message->>'organization_id')::uuid,
    (v_message->>'school_id')::uuid,
    p_student_id, null, null,
    v_message->>'communication_type',
    'email'::public.communication_channel,
    v_message->>'recipient', v_message->>'subject', v_message->>'body',
    p_template_key
  );
end;
$$;
revoke all on function public.send_student_email_template_mvp(text, uuid) from public, anon;
grant execute on function public.send_student_email_template_mvp(text, uuid) to authenticated;

notify pgrst, 'reload schema';
