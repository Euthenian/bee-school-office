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

revoke execute on function public.ingest_financial_document_mvp(
  uuid, uuid, text, text, text, text, timestamptz, text, text, text, text, text,
  text, text, text, numeric, text, uuid, text, jsonb
) from public;

revoke execute on function public.ingest_financial_document_mvp(
  uuid, uuid, text, text, text, text, timestamptz, text, text, text, text, text,
  text, text, text, numeric, text, uuid, text, jsonb
) from anon;

revoke execute on function public.ingest_financial_document_mvp(
  uuid, uuid, text, text, text, text, timestamptz, text, text, text, text, text,
  text, text, text, numeric, text, uuid, text, jsonb
) from authenticated;

grant execute on function public.ingest_financial_document_mvp(
  uuid, uuid, text, text, text, text, timestamptz, text, text, text, text, text,
  text, text, text, numeric, text, uuid, text, jsonb
) to service_role;
