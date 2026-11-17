-- Update the active invitation template and the fixed preparation RPC copy.
-- Existing invitations, tokens, expiry, and claim behavior are unchanged.
update public.communication_templates
set subject_template = '【Bee School】AI-EIGO Voice Check ご利用のご案内',
    body_template = 'Bee Schoolの生徒・保護者の皆さまへ

Bee Schoolに通う生徒の皆さまは、特典としてAI-EIGOの「Voice Check（発音チェック）」機能を無料でご利用いただけます。

以下のボタンからAI-EIGOにアクセスし、ログインまたは新規登録をお願いいたします。

[CTA: 利用を開始する]

ボタンが開かない場合は、以下のURLをコピーしてブラウザに貼り付けてください。

{{invitation_link}}

このご案内リンクはお送りした方専用です。他の方への転送はお控えください。

このリンクは送信後14日間有効です。

Bee School',
    variable_keys = array['invitation_link'],
    updated_at = now()
where template_key = 'ai_eigo_student_invitation';

create or replace function public.prepare_ai_eigo_student_invitation_email_mvp(p_invitation_id uuid)
returns table (
  recipient text,
  subject text,
  body text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := now();
  v_raw_token text;
  v_token_hash text;
  v_link text;
  v_expires_at timestamptz;
  v_body text;
  v_context jsonb;
  v_student_name text;
  v_school_name text;
  v_subject text;
  v_template public.communication_templates%rowtype;
  v_invitation public.ai_eigo_student_invitations%rowtype;
begin
  if coalesce((select auth.role()), '') <> 'service_role' then
    raise exception 'Only the service role may prepare AI-EIGO invitation emails.';
  end if;

  select * into v_invitation
  from public.ai_eigo_student_invitations inv
  where inv.id = p_invitation_id
  for update;

  if not found then
    raise exception 'AI-EIGO invitation was not found.';
  end if;

  if v_invitation.status not in ('pending_send', 'send_failed') then
    raise exception 'AI-EIGO invitation is not pending email delivery.';
  end if;

  if v_invitation.revoked_at is not null or v_invitation.claimed_at is not null then
    raise exception 'AI-EIGO invitation is no longer active.';
  end if;

  if exists (
    select 1
    from public.ai_eigo_student_links link
    where link.student_id = v_invitation.student_id
  ) then
    update public.ai_eigo_student_invitations inv
    set status = 'revoked',
        token_hash = null,
        token_expires_at = null,
        revoked_at = v_now,
        updated_at = v_now
    where inv.id = v_invitation.id;

    raise exception 'Student is already linked to AI-EIGO.';
  end if;

  select trim(concat_ws(' ', nullif(st.first_name, ''), nullif(st.last_name, ''))),
         coalesce(s.name, 'Bee School')
    into v_student_name,
         v_school_name
  from public.students st
  join public.schools s on s.id = st.school_id
  where st.id = v_invitation.student_id
    and st.organization_id = v_invitation.organization_id
    and st.school_id = v_invitation.school_id;

  v_student_name = coalesce(nullif(v_student_name, ''), 'Bee School student');
  v_raw_token = rtrim(translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/', '-_'), '=');
  v_token_hash = encode(extensions.digest(v_raw_token, 'sha256'), 'hex');
  v_expires_at = v_now + interval '14 days';
  v_link = 'https://ai-eigo.com/invite/' || v_raw_token;

  select * into v_template
  from public.communication_templates ct
  where ct.template_key = 'ai_eigo_student_invitation'
    and ct.status = 'active';

  if not found then
    raise exception 'AI-EIGO invitation communication template is missing.';
  end if;

  v_context = jsonb_build_object(
    'student_name', v_student_name,
    'school_name', v_school_name,
    'invitation_link', v_link,
    'expires_at', to_char(v_expires_at at time zone 'Asia/Tokyo', 'YYYY-MM-DD')
  );
  -- Fixed Japanese copy is independent of staff locale and editable template content.
  v_subject = '【Bee School】AI-EIGO Voice Check ご利用のご案内';
  v_body = array_to_string(ARRAY[
    'Bee Schoolの生徒・保護者の皆さまへ',
    '',
    'Bee Schoolに通う生徒の皆さまは、特典としてAI-EIGOの「Voice Check（発音チェック）」機能を無料でご利用いただけます。',
    '',
    '以下のボタンからAI-EIGOにアクセスし、ログインまたは新規登録をお願いいたします。',
    '',
    '[CTA: 利用を開始する]',
    '',
    'ボタンが開かない場合は、以下のURLをコピーしてブラウザに貼り付けてください。',
    '',
    v_link,
    '',
    'このご案内リンクはお送りした方専用です。他の方への転送はお控えください。',
    '',
    'このリンクは送信後14日間有効です。',
    '',
    'Bee School'
  ], E'\n');

  update public.ai_eigo_student_invitations inv
  set token_hash = v_token_hash,
      token_expires_at = v_expires_at,
      last_send_attempt_at = v_now,
      last_send_error = null,
      updated_at = v_now
  where inv.id = v_invitation.id;

  return query
  select
    v_invitation.recipient_email::text,
    v_subject,
    v_body;
end;
$$;

revoke all on function public.prepare_ai_eigo_student_invitation_email_mvp(uuid) from public, anon, authenticated;
grant execute on function public.prepare_ai_eigo_student_invitation_email_mvp(uuid) to service_role;
