import {
  buildPendingTrialBookingImport,
  getHeaderValue,
  isTrialBookingSubject,
  PENDING_TRIAL_BOOKING_IMPORT_TABLE
} from "./trial-booking-imports.js";

const GMAIL_API_BASE_URL = "https://gmail.googleapis.com/gmail/v1";
const GOOGLE_OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";
const DEFAULT_MAX_RESULTS = 10;
const MAX_ALLOWED_RESULTS = 50;

export function readGmailTrialBookingWorkerConfig(getEnv) {
  const config = {
    supabaseUrl: readEnv(getEnv, "SUPABASE_URL"),
    supabaseServiceRoleKey: readEnv(getEnv, "SUPABASE_SERVICE_ROLE_KEY"),
    gmailClientId: readEnv(getEnv, "GMAIL_CLIENT_ID"),
    gmailClientSecret: readEnv(getEnv, "GMAIL_CLIENT_SECRET"),
    gmailRefreshToken: readEnv(getEnv, "GMAIL_REFRESH_TOKEN"),
    sourceMailbox: normalizeNullableString(readEnv(getEnv, "GMAIL_SOURCE_MAILBOX")),
    organizationId: normalizeNullableString(readEnv(getEnv, "GMAIL_TENANT_ORGANIZATION_ID")),
    schoolId: normalizeNullableString(readEnv(getEnv, "GMAIL_TENANT_SCHOOL_ID")),
    importAfter: normalizeImportAfterDate(readEnv(getEnv, "GMAIL_IMPORT_AFTER")),
    maxResults: normalizeMaxResults(readEnv(getEnv, "GMAIL_POLL_MAX_RESULTS"))
  };
  const errors = [];

  for (const [key, label] of [
    ["supabaseUrl", "SUPABASE_URL"],
    ["supabaseServiceRoleKey", "SUPABASE_SERVICE_ROLE_KEY"],
    ["gmailClientId", "GMAIL_CLIENT_ID"],
    ["gmailClientSecret", "GMAIL_CLIENT_SECRET"],
    ["gmailRefreshToken", "GMAIL_REFRESH_TOKEN"],
    ["sourceMailbox", "GMAIL_SOURCE_MAILBOX"],
    ["organizationId", "GMAIL_TENANT_ORGANIZATION_ID"],
    ["schoolId", "GMAIL_TENANT_SCHOOL_ID"],
    ["importAfter", "GMAIL_IMPORT_AFTER"]
  ]) {
    if (!config[key]) errors.push(`${label} is required.`);
  }

  return { config, errors };
}

export function buildGmailTrialBookingSearchQuery({ importAfter } = {}) {
  const after = normalizeImportAfterDate(importAfter);
  if (!after) {
    throw new Error("GMAIL_IMPORT_AFTER is required to prevent accidental historical backfill.");
  }

  return [
    "in:inbox",
    "-in:sent",
    '-from:calendar-notification@google.com',
    '-subject:"Re:"',
    '-subject:"Fwd:"',
    'subject:"Trial Booking"',
    `after:${after.replaceAll("-", "/")}`
  ].join(" ");
}

export async function pollGmailTrialBookings({ gmailClient, pendingImportRepository, config, logger = console }) {
  const query = buildGmailTrialBookingSearchQuery(config);
  const outcomes = [];
  const summary = {
    ok: true,
    query,
    processed: 0,
    inserted: 0,
    skippedDuplicates: 0,
    ignored: 0,
    parseErrors: 0,
    errors: [],
    outcomes
  };

  let messageSummaries;
  try {
    messageSummaries = await gmailClient.listMessages({ q: query, maxResults: config.maxResults || DEFAULT_MAX_RESULTS });
  } catch (error) {
    summary.ok = false;
    summary.errors.push({ stage: "list", message: getErrorMessage(error) });
    logger.error?.("gmail_trial_booking_poll list failed", { error: getErrorMessage(error) });
    return summary;
  }

  for (const messageSummary of messageSummaries || []) {
    const gmailMessageId = normalizeNullableString(messageSummary?.id);
    if (!gmailMessageId) {
      summary.ignored += 1;
      outcomes.push({ status: "ignored", reason: "missing_message_id" });
      continue;
    }

    const outcome = { gmailMessageId };
    outcomes.push(outcome);
    summary.processed += 1;

    try {
      if (await pendingImportRepository.hasPendingImport({ sourceMailbox: config.sourceMailbox, gmailMessageId })) {
        outcome.status = "skipped_duplicate";
        summary.skippedDuplicates += 1;
        logger.info?.("gmail_trial_booking_poll skipped duplicate", { gmailMessageId });
        continue;
      }

      const message = await gmailClient.getMessage(gmailMessageId);
      const metadata = extractGmailMessageMetadata(message);
      const ignoreReason = getIgnoredMessageReason(metadata);

      if (ignoreReason) {
        outcome.status = "ignored";
        outcome.reason = ignoreReason;
        summary.ignored += 1;
        logger.info?.("gmail_trial_booking_poll ignored message", { gmailMessageId, reason: ignoreReason });
        continue;
      }

      const row = buildPendingTrialBookingImport({
        organizationId: config.organizationId,
        schoolId: config.schoolId,
        sourceMailbox: config.sourceMailbox,
        gmailMessageId,
        gmailThreadId: message.threadId,
        headers: metadata.headers,
        sender: metadata.sender,
        recipient: metadata.recipient,
        subject: metadata.subject,
        receivedAt: metadata.receivedAt,
        rawBody: metadata.body
      });

      const insertResult = await pendingImportRepository.insertPendingImport(row);
      outcome.status = insertResult.inserted ? "inserted" : "skipped_duplicate";
      outcome.parseStatus = row.parse_status;

      if (insertResult.inserted) {
        summary.inserted += 1;
        if (row.parse_status === "parse_error") summary.parseErrors += 1;
      } else {
        summary.skippedDuplicates += 1;
      }

      logger.info?.("gmail_trial_booking_poll processed message", {
        gmailMessageId,
        status: outcome.status,
        parseStatus: row.parse_status
      });
    } catch (error) {
      outcome.status = "error";
      outcome.error = getErrorMessage(error);
      summary.errors.push({ gmailMessageId, message: outcome.error });
      logger.error?.("gmail_trial_booking_poll message failed", { gmailMessageId, error: outcome.error });
    }
  }

  return summary;
}

export function createGmailApiClient({ clientId, clientSecret, refreshToken, sourceMailbox }, fetchImpl = fetch) {
  let accessToken = null;
  let expiresAt = 0;

  async function getAccessToken() {
    if (accessToken && Date.now() < expiresAt - 60_000) {
      return accessToken;
    }

    const response = await fetchImpl(GOOGLE_OAUTH_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: "refresh_token"
      })
    });

    if (!response.ok) {
      throw new Error(`Gmail OAuth token refresh failed with HTTP ${response.status}.`);
    }

    const json = await response.json();
    accessToken = json.access_token;
    expiresAt = Date.now() + Number(json.expires_in || 3600) * 1000;
    return accessToken;
  }

  async function gmailRequest(path, params = {}) {
    const token = await getAccessToken();
    const url = new URL(`${GMAIL_API_BASE_URL}/users/${encodeURIComponent(sourceMailbox)}${path}`);
    for (const [key, value] of Object.entries(params)) {
      if (value !== null && value !== undefined && value !== "") {
        url.searchParams.set(key, String(value));
      }
    }

    const response = await fetchImpl(url, {
      headers: { Authorization: `Bearer ${token}` }
    });

    if (!response.ok) {
      throw new Error(`Gmail API request failed with HTTP ${response.status}.`);
    }

    return response.json();
  }

  return {
    async listMessages({ q, maxResults }) {
      const json = await gmailRequest("/messages", { q, maxResults });
      return json.messages || [];
    },
    async getMessage(messageId) {
      return gmailRequest(`/messages/${encodeURIComponent(messageId)}`, { format: "full" });
    }
  };
}

export function createSupabaseRestPendingImportRepository({ supabaseUrl, serviceRoleKey }, fetchImpl = fetch) {
  const baseUrl = `${supabaseUrl.replace(/\/$/, "")}/rest/v1/${PENDING_TRIAL_BOOKING_IMPORT_TABLE}`;
  const headers = {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`
  };

  return {
    async hasPendingImport({ sourceMailbox, gmailMessageId }) {
      const url = new URL(baseUrl);
      url.searchParams.set("select", "id");
      url.searchParams.set("source_mailbox", `eq.${sourceMailbox}`);
      url.searchParams.set("gmail_message_id", `eq.${gmailMessageId}`);
      url.searchParams.set("limit", "1");

      const response = await fetchImpl(url, { headers });
      if (!response.ok) {
        throw new Error(`Pending import lookup failed with HTTP ${response.status}.`);
      }

      const json = await response.json();
      return Array.isArray(json) && json.length > 0;
    },
    async insertPendingImport(row) {
      const url = new URL(baseUrl);
      url.searchParams.set("on_conflict", "source_mailbox,gmail_message_id");

      const response = await fetchImpl(url, {
        method: "POST",
        headers: {
          ...headers,
          "Content-Type": "application/json",
          Prefer: "resolution=ignore-duplicates,return=representation"
        },
        body: JSON.stringify(row)
      });

      if (!response.ok) {
        throw new Error(`Pending import insert failed with HTTP ${response.status}.`);
      }

      const json = await response.json();
      return { inserted: Array.isArray(json) && json.length > 0, data: json };
    }
  };
}

export function extractGmailMessageMetadata(message) {
  const headers = message?.payload?.headers || [];
  const body = extractGmailMessageBody(message?.payload);
  const internalDate = Number(message?.internalDate);

  return {
    id: message?.id || null,
    threadId: message?.threadId || null,
    labelIds: message?.labelIds || [],
    headers,
    sender: getHeaderValue(headers, "from"),
    recipient: getHeaderValue(headers, "to"),
    subject: getHeaderValue(headers, "subject"),
    receivedAt: Number.isFinite(internalDate) ? new Date(internalDate).toISOString() : null,
    body
  };
}

export function extractGmailMessageBody(payload) {
  const plain = findMimeBody(payload, "text/plain");
  if (plain) return plain;

  const html = findMimeBody(payload, "text/html");
  if (html) return htmlToText(html);

  return "";
}

export function getIgnoredMessageReason(metadata) {
  const subject = metadata?.subject || "";
  const sender = metadata?.sender || "";
  const labelIds = metadata?.labelIds || [];

  if (Array.isArray(labelIds) && labelIds.includes("SENT")) return "sent_message";
  if (Array.isArray(labelIds) && labelIds.length && !labelIds.includes("INBOX")) return "not_inbox";
  if (isReplyOrForwardSubject(subject)) return "reply_or_forward";
  if (isCalendarSender(sender)) return "google_calendar";
  if (!isTrialBookingSubject(subject)) return "subject_not_trial_booking";

  return null;
}

export function normalizeImportAfterDate(value) {
  const normalized = normalizeNullableString(value);
  if (!normalized) return null;

  const match = normalized.match(/^(\d{4})[-/](\d{2})[-/](\d{2})$/);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  const valid =
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day;

  return valid ? `${match[1]}-${match[2]}-${match[3]}` : null;
}

function findMimeBody(part, mimeType) {
  if (!part) return "";
  if (part.mimeType === mimeType && part.body?.data) {
    return decodeGmailBodyData(part.body.data);
  }

  for (const child of part.parts || []) {
    const found = findMimeBody(child, mimeType);
    if (found) return found;
  }

  return "";
}

export function decodeGmailBodyData(value) {
  return new TextDecoder("utf-8").decode(decodeBase64UrlBytes(value));
}

function decodeBase64UrlBytes(value) {
  const base64 = String(value).replaceAll("-", "+").replaceAll("_", "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  const binary = globalThis.atob(padded);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

function htmlToText(html) {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/gi, '"')
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

function isReplyOrForwardSubject(subject) {
  return /^(re|fw|fwd)\s*:/i.test(String(subject).trim());
}

function isCalendarSender(sender) {
  return String(sender).toLowerCase().includes("calendar-notification@google.com");
}

function normalizeMaxResults(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) return DEFAULT_MAX_RESULTS;
  return Math.min(parsed, MAX_ALLOWED_RESULTS);
}

function normalizeNullableString(value) {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim();
  return normalized ? normalized : null;
}

function readEnv(getEnv, name) {
  return typeof getEnv === "function" ? getEnv(name) : null;
}

function getErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
