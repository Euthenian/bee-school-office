-- Class profile actions use the existing enrollment and Communication Center tables.
-- Apply manually after 20261015001000_student_departure_confirmation_email.sql.

create function public.add_existing_student_to_class_mvp(p_class_id uuid, p_student_id uuid)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_student public.students%rowtype;
  v_class public.classes%rowtype;
  v_school_timezone text;
  v_enrollment_id uuid;
begin
  if auth.uid() is null or p_class_id is null or p_student_id is null then
    raise exception 'A signed-in staff member, class, and student are required.';
  end if;

  -- Student writers use this same row lock, so two class additions cannot race.
  select * into v_student from public.students where id = p_student_id for update;
  if not found or not public.can_manage_student(p_student_id) then
    raise exception 'Student not found or permission denied.';
  end if;
  select * into v_class from public.classes where id = p_class_id for share;
  if v_class.id is null or v_class.status <> 'active'
    or v_class.school_id <> v_student.school_id
    or v_class.organization_id <> v_student.organization_id
    or not public.can_manage_school(v_class.school_id) then
    raise exception 'Active class not found in the student school or permission denied.';
  end if;
  if v_student.status <> 'active' then
    raise exception 'Only active students can be added to a class.';
  end if;
  select timezone into v_school_timezone from public.schools where id = v_class.school_id;
  if exists (
    select 1 from public.student_enrollments se
    where se.student_id = p_student_id and se.status = 'active'
  ) then
    raise exception 'Student already has an active class enrollment. Review their assignment in Student Edit.';
  end if;

  -- Preserve completed/paused/withdrawn rows instead of repurposing history.
  insert into public.student_enrollments (
    organization_id, school_id, student_id, class_id, status, start_date
  ) values (
    v_student.organization_id, v_student.school_id, v_student.id, v_class.id,
    'active', (now() at time zone coalesce(v_school_timezone, 'Asia/Tokyo'))::date
  ) returning id into v_enrollment_id;
  return v_enrollment_id;
end;
$$;
revoke all on function public.add_existing_student_to_class_mvp(uuid, uuid) from public, anon;
grant execute on function public.add_existing_student_to_class_mvp(uuid, uuid) to authenticated;

-- Shared preparation resolves every recipient and variable on the server. It is
-- callable only through the preview/send wrappers below.
create function public.prepare_class_template_email_mvp(
  p_class_id uuid, p_template_key text, p_send boolean
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_class public.classes%rowtype;
  v_template public.communication_templates%rowtype;
  v_student_id uuid;
  v_message jsonb;
  v_recipient text;
  v_seen text[] := array[]::text[];
  v_representative jsonb;
  v_selected integer := 0;
  v_missing integer := 0;
  v_duplicate integer := 0;
  v_eligible integer := 0;
  v_queued integer := 0;
begin
  if auth.uid() is null or p_class_id is null or nullif(btrim(coalesce(p_template_key, '')), '') is null then
    raise exception 'A signed-in staff member, class, and template are required.';
  end if;
  select * into v_class from public.classes where id = p_class_id;
  if not found or not public.can_manage_school(v_class.school_id) then
    raise exception 'Class not found or permission denied.';
  end if;
  select * into v_template from public.communication_templates
  where template_key = p_template_key and status = 'active' and channel = 'email'
    and template_key <> 'student_departure_confirmation';
  if not found or not (v_template.variable_keys <@ array[
    'student_name', 'student_email', 'recipient_name', 'school_name'
  ]::text[]) then
    raise exception 'Active student email template not available.';
  end if;
  perform public.validate_student_email_template_mvp(
    v_template.subject_template, v_template.body_template, v_template.variable_keys
  );

  for v_student_id in
    select distinct se.student_id from public.student_enrollments se
    join public.students st on st.id = se.student_id
      and st.organization_id = se.organization_id and st.school_id = se.school_id
    where se.class_id = p_class_id and se.status = 'active'
      and se.school_id = v_class.school_id and se.organization_id = v_class.organization_id
    order by se.student_id
  loop
    v_selected := v_selected + 1;
    if not public.can_manage_student(v_student_id) then
      raise exception 'Permission denied for an active class student.';
    end if;
    -- Match Communication Center's validity and priority before calling its
    -- renderer, which treats a missing recipient as an error.
    select btrim(c.value) into v_recipient from public.student_contacts c
    where c.student_id = v_student_id and c.contact_type = 'email'
      and btrim(c.value) ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    order by c.is_primary desc, c.created_at asc, c.id asc limit 1;
    if v_recipient is null then
      v_missing := v_missing + 1;
      continue;
    end if;
    v_message := public.resolve_student_email_template_mvp(p_template_key, v_student_id);
    v_recipient := lower(btrim(v_message->>'recipient'));
    if v_recipient = any(v_seen) then
      v_duplicate := v_duplicate + 1;
      continue;
    end if;
    if nullif(btrim(v_message->>'subject'), '') is null
      or nullif(btrim(v_message->>'body'), '') is null
      or (v_message->>'subject') ~ '\{\{|\}\}'
      or (v_message->>'body') ~ '\{\{|\}\}' then
      raise exception 'Template contains unresolved variables.';
    end if;
    v_seen := array_append(v_seen, v_recipient);
    v_eligible := v_eligible + 1;
    if v_representative is null then
      v_representative := jsonb_build_object(
        'student_id', v_student_id, 'recipient', v_message->>'recipient',
        'subject', v_message->>'subject', 'body', v_message->>'body'
      );
    end if;
    if p_send then
      perform public.queue_communication_mvp(
        v_class.organization_id, v_class.school_id, v_student_id, null, null,
        v_message->>'communication_type', 'email'::public.communication_channel,
        v_message->>'recipient', v_message->>'subject', v_message->>'body', p_template_key
      );
      v_queued := v_queued + 1;
    end if;
  end loop;
  return jsonb_build_object(
    'template_key', p_template_key, 'template_name', v_template.name,
    'selected', v_selected, 'recipient_count', v_eligible,
    'skipped_missing', v_missing, 'skipped_duplicate', v_duplicate,
    'queued', v_queued, 'representative', v_representative
  );
end;
$$;
revoke all on function public.prepare_class_template_email_mvp(uuid, text, boolean)
  from public, anon, authenticated;

create function public.preview_class_template_email_mvp(p_class_id uuid, p_template_key text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
begin
  return public.prepare_class_template_email_mvp(p_class_id, p_template_key, false);
end;
$$;
revoke all on function public.preview_class_template_email_mvp(uuid, text) from public, anon;
grant execute on function public.preview_class_template_email_mvp(uuid, text) to authenticated;

create function public.send_class_template_email_mvp(p_class_id uuid, p_template_key text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
begin
  return public.prepare_class_template_email_mvp(p_class_id, p_template_key, true);
end;
$$;
revoke all on function public.send_class_template_email_mvp(uuid, text) from public, anon;
grant execute on function public.send_class_template_email_mvp(uuid, text) to authenticated;

notify pgrst, 'reload schema';
