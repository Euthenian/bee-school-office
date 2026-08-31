alter table public.ai_eigo_student_invitations
drop constraint if exists ai_eigo_student_invitations_token_state_check;

alter table public.ai_eigo_student_invitations
add constraint ai_eigo_student_invitations_token_state_check
check (
  (status = 'pending_send' and claimed_at is null and revoked_at is null and (token_hash is null or token_expires_at is not null))
  or (status in ('send_failed', 'revoked', 'expired', 'manual_review') and token_hash is null)
  or (status = 'sent' and token_hash is not null and token_expires_at is not null and claimed_at is null and revoked_at is null)
  or (
    status = 'claimed'
    and claimed_at is not null
    and claimed_ai_eigo_user_id is not null
    and (token_hash is null or token_expires_at is not null)
  )
);

drop function if exists public.claim_ai_eigo_student_invitation_mvp(text, text, text);

create or replace function public.claim_ai_eigo_student_invitation_mvp(
  p_token text,
  p_ai_eigo_user_id text,
  p_ai_eigo_email text
)
returns table (
  student_id uuid,
  organization_id uuid,
  school_id uuid,
  ai_eigo_user_id text,
  ai_eigo_email text,
  entitlement_code text,
  linked_at timestamptz,
  claim_status text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := now();
  v_hash text;
  v_invitation public.ai_eigo_student_invitations%rowtype;
  v_existing_link public.ai_eigo_student_links%rowtype;
  v_link public.ai_eigo_student_links%rowtype;
  v_claim_email citext;
  v_claim_user_id text;
begin
  if coalesce((select auth.role()), '') <> 'service_role' then
    raise exception 'Only the service role may claim AI-EIGO invitations.';
  end if;

  if nullif(trim(coalesce(p_token, '')), '') is null then
    raise exception 'Invitation token is required.';
  end if;

  if nullif(trim(coalesce(p_ai_eigo_user_id, '')), '') is null then
    raise exception 'AI-EIGO user ID is required.';
  end if;

  if nullif(trim(coalesce(p_ai_eigo_email, '')), '') is null then
    raise exception 'AI-EIGO account email is required.';
  end if;

  v_claim_user_id = trim(p_ai_eigo_user_id);
  v_claim_email = lower(trim(p_ai_eigo_email));
  v_hash = encode(digest(trim(p_token), 'sha256'), 'hex');

  select * into v_invitation
  from public.ai_eigo_student_invitations inv
  where inv.token_hash = v_hash
  for update;

  if not found then
    raise exception 'AI-EIGO invitation is invalid or expired.';
  end if;

  if v_invitation.revoked_at is not null or v_invitation.status = 'revoked' then
    raise exception 'AI-EIGO invitation has been revoked.';
  end if;

  if v_invitation.token_expires_at is null or v_invitation.token_expires_at <= v_now then
    if v_invitation.status = 'sent' and v_invitation.claimed_at is null then
      update public.ai_eigo_student_invitations inv
      set status = 'expired',
          token_hash = null,
          token_expires_at = null,
          updated_at = v_now
      where inv.id = v_invitation.id;
    end if;

    raise exception 'AI-EIGO invitation has expired.';
  end if;

  if v_invitation.claimed_at is not null or v_invitation.status = 'claimed' then
    if v_invitation.claimed_ai_eigo_user_id = v_claim_user_id then
      select * into v_link
      from public.ai_eigo_student_links link
      where link.student_id = v_invitation.student_id
        and link.ai_eigo_user_id = v_claim_user_id
      for update;

      if not found then
        raise exception 'AI-EIGO invitation requires manual review because its claimed link is missing.';
      end if;

      return query
      select
        v_link.student_id,
        v_link.organization_id,
        v_link.school_id,
        v_link.ai_eigo_user_id,
        v_link.ai_eigo_email::text,
        v_link.entitlement_code,
        v_link.linked_at,
        'already_linked_same_user'::text;
      return;
    end if;

    raise exception 'AI-EIGO invitation has already been claimed by another AI-EIGO user.';
  end if;

  if v_invitation.status <> 'sent' then
    raise exception 'AI-EIGO invitation is not ready to be claimed.';
  end if;

  if v_claim_email <> v_invitation.recipient_email then
    update public.ai_eigo_student_invitations inv
    set status = 'manual_review',
        token_hash = null,
        token_expires_at = null,
        claimed_ai_eigo_user_id = v_claim_user_id,
        claimed_ai_eigo_email = v_claim_email,
        last_send_error = 'AI-EIGO login email did not match the invitation recipient.',
        updated_at = v_now
    where inv.id = v_invitation.id;

    raise exception 'AI-EIGO invitation requires manual review before Bee access can be activated.';
  end if;

  if exists (
    select 1
    from public.student_contacts sc
    where sc.contact_type = 'email'
      and lower(trim(sc.value)) = lower(v_invitation.recipient_email::text)
      and sc.student_id <> v_invitation.student_id
  ) then
    update public.ai_eigo_student_invitations inv
    set status = 'manual_review',
        token_hash = null,
        token_expires_at = null,
        claimed_ai_eigo_user_id = v_claim_user_id,
        claimed_ai_eigo_email = v_claim_email,
        last_send_error = 'Invitation recipient email is shared by multiple Bee students.',
        updated_at = v_now
    where inv.id = v_invitation.id;

    raise exception 'AI-EIGO invitation requires manual review because this email is shared by multiple Bee students.';
  end if;

  select * into v_existing_link
  from public.ai_eigo_student_links link
  where link.student_id = v_invitation.student_id
     or link.ai_eigo_user_id = v_claim_user_id
  for update;

  if found then
    update public.ai_eigo_student_invitations inv
    set status = 'manual_review',
        token_hash = null,
        token_expires_at = null,
        claimed_ai_eigo_user_id = v_claim_user_id,
        claimed_ai_eigo_email = v_claim_email,
        last_send_error = 'The Bee student or AI-EIGO account is already linked.',
        updated_at = v_now
    where inv.id = v_invitation.id;

    raise exception 'AI-EIGO invitation requires manual review because this student or account is already linked.';
  end if;

  insert into public.ai_eigo_student_links (
    organization_id,
    school_id,
    student_id,
    ai_eigo_user_id,
    ai_eigo_email,
    entitlement_code,
    entitlement_activated_at,
    linked_at
  )
  values (
    v_invitation.organization_id,
    v_invitation.school_id,
    v_invitation.student_id,
    v_claim_user_id,
    v_claim_email,
    'bee',
    v_now,
    v_now
  )
  returning * into v_link;

  update public.ai_eigo_student_invitations inv
  set status = 'claimed',
      claimed_at = v_now,
      claimed_ai_eigo_user_id = v_claim_user_id,
      claimed_ai_eigo_email = v_claim_email,
      last_send_error = null,
      updated_at = v_now
  where inv.id = v_invitation.id;

  return query
  select
    v_link.student_id,
    v_link.organization_id,
    v_link.school_id,
    v_link.ai_eigo_user_id,
    v_link.ai_eigo_email::text,
    v_link.entitlement_code,
    v_link.linked_at,
    'linked'::text;
end;
$$;

revoke all on function public.claim_ai_eigo_student_invitation_mvp(text, text, text) from public, anon, authenticated;
grant execute on function public.claim_ai_eigo_student_invitation_mvp(text, text, text) to service_role;

notify pgrst, 'reload schema';
