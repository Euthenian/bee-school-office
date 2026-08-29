import { AI_EIGO_INVITATION_TEMPLATE_KEY } from "./ai-eigo-invitations.js";

const GOOGLE_OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GMAIL_API_BASE_URL = "https://gmail.googleapis.com/gmail/v1";
const GOOGLE_CALENDAR_API_BASE_URL = "https://www.googleapis.com/calendar/v3";
const DEFAULT_MAX_ACTIONS = 25;
const MAX_ALLOWED_ACTIONS = 100;
const DEFAULT_TIME_ZONE = "Asia/Tokyo";

export function readCommunicationsWorkerConfig(getEnv) {
  const config = {
    supabaseUrl: readEnv(getEnv, "SUPABASE_URL"),
    supabaseServiceRoleKey: readEnv(getEnv, "SUPABASE_SERVICE_ROLE_KEY"),
    googleClientId: readEnv(getEnv, "GOOGLE_CLIENT_ID") || readEnv(getEnv, "GMAIL_CLIENT_ID"),
    googleClientSecret: readEnv(getEnv, "GOOGLE_CLIENT_SECRET") || readEnv(getEnv, "GMAIL_CLIENT_SECRET"),
    googleRefreshToken: readEnv(getEnv, "GOOGLE_REFRESH_TOKEN") || readEnv(getEnv, "GMAIL_REFRESH_TOKEN"),
    gmailSenderEmail: readEnv(getEnv, "GOOGLE_GMAIL_SENDER_EMAIL") || readEnv(getEnv, "GMAIL_SENDER_EMAIL"),
    googleCalendarId: readEnv(getEnv, "GOOGLE_CALENDAR_ID"),
    googleCalendarTimeZone: readEnv(getEnv, "GOOGLE_CALENDAR_TIME_ZONE") || DEFAULT_TIME_ZONE,
    maxActions: normalizeMaxActions(readEnv(getEnv, "COMMUNICATIONS_MAX_ACTIONS"))
  };
  const errors = [];
  const missingGoogleSecrets = [];

  for (const [key, label] of [
    ["supabaseUrl", "SUPABASE_URL"],
    ["supabaseServiceRoleKey", "SUPABASE_SERVICE_ROLE_KEY"]
  ]) {
    if (!config[key]) errors.push(`${label} is required.`);
  }

  for (const [key, label] of [
    ["googleClientId", "GOOGLE_CLIENT_ID"],
    ["googleClientSecret", "GOOGLE_CLIENT_SECRET"],
    ["googleRefreshToken", "GOOGLE_REFRESH_TOKEN"],
    ["gmailSenderEmail", "GOOGLE_GMAIL_SENDER_EMAIL"],
    ["googleCalendarId", "GOOGLE_CALENDAR_ID"]
  ]) {
    if (!config[key]) missingGoogleSecrets.push(label);
  }

  const googleReady = missingGoogleSecrets.length === 0;

  return {
    config: {
      ...config,
      googleReady,
      missingGoogleSecrets
    },
    errors,
    googleReady,
    missingGoogleSecrets
  };
}

export async function processQueuedCommunicationActions({
  calendarProvider,
  config,
  emailProvider,
  logger = console,
  repository
}) {
  const summary = {
    ok: true,
    setupRequired: false,
    missingGoogleSecrets: [],
    enqueuedNoShowFollowUps: 0,
    processed: 0,
    succeeded: 0,
    failed: 0,
    skipped: 0,
    errors: []
  };

  const dueNoShowRows = await repository.enqueueDueNoShowFollowUps({ limit: config.maxActions || DEFAULT_MAX_ACTIONS });
  summary.enqueuedNoShowFollowUps = Array.isArray(dueNoShowRows) ? dueNoShowRows.length : 0;

  const actions = await repository.listPendingIntegrationActions({ limit: config.maxActions || DEFAULT_MAX_ACTIONS });
  if (!actions.length) {
    return summary;
  }

  if (!config.googleReady) {
    summary.ok = false;
    summary.setupRequired = true;
    summary.missingGoogleSecrets = config.missingGoogleSecrets || [];
    summary.skipped = actions.length;
    return summary;
  }

  for (const action of actions) {
    summary.processed += 1;

    try {
      const result = await processIntegrationAction({ action, calendarProvider, emailProvider, repository });
      await repository.recordActionResult({
        idempotencyKey: action.idempotency_key,
        status: result.status,
        externalId: result.externalId || null,
        errorMessage: result.errorMessage || null,
        responsePayload: result.responsePayload || {}
      });

      if (result.status === "succeeded") summary.succeeded += 1;
      else if (result.status === "skipped") summary.skipped += 1;
      else summary.failed += 1;
    } catch (error) {
      summary.ok = false;
      summary.failed += 1;
      const message = getErrorMessage(error);
      summary.errors.push({ idempotencyKey: action.idempotency_key, message });
      logger.error?.("communication action failed", { idempotencyKey: action.idempotency_key, message });

      await repository.recordActionResult({
        idempotencyKey: action.idempotency_key,
        status: "failed",
        errorMessage: message,
        responsePayload: { error: message }
      });
    }
  }

  return summary;
}

export function createSupabaseRestCommunicationsRepository({ supabaseUrl, serviceRoleKey }, fetchImpl = fetch) {
  const baseUrl = supabaseUrl.replace(/\/$/, "");
  const headers = {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`
  };

  return {
    async enqueueDueNoShowFollowUps({ limit }) {
      const response = await fetchImpl(`${baseUrl}/rest/v1/rpc/enqueue_due_no_show_follow_ups`, {
        method: "POST",
        headers: {
          ...headers,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ p_limit: limit })
      });

      if (!response.ok) {
        throw new Error(`No-show follow-up enqueue failed with HTTP ${response.status}.`);
      }

      return response.json();
    },
    async listPendingIntegrationActions({ limit }) {
      const url = new URL(`${baseUrl}/rest/v1/communication_integration_actions`);
      url.searchParams.set(
        "select",
        "id,idempotency_key,provider,action_type,external_id,communication_id,trial_lesson_id,request_payload"
      );
      url.searchParams.set("status", "eq.pending");
      url.searchParams.set("order", "created_at.asc");
      url.searchParams.set("limit", String(limit || DEFAULT_MAX_ACTIONS));

      const response = await fetchImpl(url, { headers });
      if (!response.ok) {
        throw new Error(`Pending communication action lookup failed with HTTP ${response.status}.`);
      }

      return response.json();
    },
    async recordActionResult({ idempotencyKey, status, externalId = null, errorMessage = null, responsePayload = {} }) {
      const response = await fetchImpl(`${baseUrl}/rest/v1/rpc/record_communication_integration_result`, {
        method: "POST",
        headers: {
          ...headers,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          p_idempotency_key: idempotencyKey,
          p_status: status,
          p_external_id: externalId,
          p_error_message: errorMessage,
          p_response_payload: responsePayload
        })
      });

      if (!response.ok) {
        throw new Error(`Communication action result update failed with HTTP ${response.status}.`);
      }
    },
    async prepareAiEigoInvitationEmail({ invitationId }) {
      const response = await fetchImpl(`${baseUrl}/rest/v1/rpc/prepare_ai_eigo_student_invitation_email_mvp`, {
        method: "POST",
        headers: {
          ...headers,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ p_invitation_id: invitationId })
      });

      if (!response.ok) {
        throw new Error(`AI-EIGO invitation email preparation failed with HTTP ${response.status}.`);
      }

      const rows = await response.json();
      const payload = Array.isArray(rows) ? rows[0] : rows;
      if (!payload?.recipient || !payload?.body) {
        throw new Error("AI-EIGO invitation email preparation returned an incomplete payload.");
      }

      return payload;
    }
  };
}

export function createGmailSenderClient({ clientId, clientSecret, refreshToken, senderEmail }, fetchImpl = fetch) {
  const getAccessToken = createGoogleAccessTokenGetter({ clientId, clientSecret, refreshToken }, fetchImpl);

  return {
    async sendEmail({ body, recipient, subject }) {
      const token = await getAccessToken();
      const raw = encodeBase64Url(
        [
          `From: ${senderEmail}`,
          `To: ${recipient}`,
          `Subject: ${subject || ""}`,
          "MIME-Version: 1.0",
          "Content-Type: text/plain; charset=UTF-8",
          "",
          body || ""
        ].join("\r\n")
      );

      const response = await fetchImpl(
        `${GMAIL_API_BASE_URL}/users/${encodeURIComponent(senderEmail)}/messages/send`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ raw })
        }
      );

      if (!response.ok) {
        throw new Error(`Gmail send failed with HTTP ${response.status}.`);
      }

      const json = await response.json();
      return {
        externalId: json.id || null,
        responsePayload: { id: json.id || null, threadId: json.threadId || null },
        status: "succeeded"
      };
    }
  };
}

export function createGoogleCalendarClient(
  { calendarId, clientId, clientSecret, refreshToken, timeZone = DEFAULT_TIME_ZONE },
  fetchImpl = fetch
) {
  const getAccessToken = createGoogleAccessTokenGetter({ clientId, clientSecret, refreshToken }, fetchImpl);

  return {
    async createEvent(payload) {
      const token = await getAccessToken();
      const date = payload.date;
      const time = normalizeTime(payload.time) || "00:00";
      const durationMinutes = normalizeDuration(payload.duration_minutes);
      const event = {
        summary: payload.summary || "Bee School Trial Lesson",
        description: buildCalendarDescription(payload),
        start: {
          dateTime: `${date}T${time}:00`,
          timeZone
        },
        end: {
          dateTime: `${date}T${addMinutesToTime(time, durationMinutes)}:00`,
          timeZone
        }
      };

      const response = await fetchImpl(
        `${GOOGLE_CALENDAR_API_BASE_URL}/calendars/${encodeURIComponent(calendarId)}/events`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify(event)
        }
      );

      if (!response.ok) {
        throw new Error(`Google Calendar event create failed with HTTP ${response.status}.`);
      }

      const json = await response.json();
      return {
        externalId: json.id || null,
        responsePayload: { id: json.id || null, htmlLink: json.htmlLink || null },
        status: "succeeded"
      };
    }
  };
}

async function processIntegrationAction({ action, calendarProvider, emailProvider, repository }) {
  const payload = action.request_payload || {};

  if (action.provider === "gmail" && action.action_type === "send_email") {
    const emailPayload =
      payload.template_key === AI_EIGO_INVITATION_TEMPLATE_KEY && payload.invitation_id
        ? await repository.prepareAiEigoInvitationEmail({ invitationId: payload.invitation_id })
        : payload;

    if (!emailPayload.recipient) {
      return { status: "failed", errorMessage: "Email action is missing a recipient." };
    }

    return emailProvider.sendEmail(emailPayload);
  }

  if (action.provider === "google_calendar" && action.action_type === "create_calendar_event") {
    if (action.external_id) {
      return {
        status: "skipped",
        externalId: action.external_id,
        responsePayload: { reason: "external_event_already_recorded" }
      };
    }

    return calendarProvider.createEvent(payload);
  }

  return {
    status: "skipped",
    responsePayload: { reason: "unsupported_action", provider: action.provider, actionType: action.action_type }
  };
}

function createGoogleAccessTokenGetter({ clientId, clientSecret, refreshToken }, fetchImpl) {
  let accessToken = null;
  let expiresAt = 0;

  return async function getAccessToken() {
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
      throw new Error(`Google OAuth token refresh failed with HTTP ${response.status}.`);
    }

    const json = await response.json();
    accessToken = json.access_token;
    expiresAt = Date.now() + Number(json.expires_in || 3600) * 1000;
    return accessToken;
  };
}

function buildCalendarDescription(payload) {
  return [
    payload.school_name ? `School: ${payload.school_name}` : "",
    payload.teacher ? `Teacher: ${payload.teacher}` : "",
    payload.trial_lesson_id ? `Trial Lesson ID: ${payload.trial_lesson_id}` : "",
    payload.prospect_id ? `Prospect ID: ${payload.prospect_id}` : ""
  ]
    .filter(Boolean)
    .join("\n");
}

function addMinutesToTime(value, minutesToAdd) {
  const [hours, minutes] = normalizeTime(value).split(":").map((part) => Number.parseInt(part, 10));
  const totalMinutes = hours * 60 + minutes + minutesToAdd;
  const normalized = ((totalMinutes % 1440) + 1440) % 1440;
  const nextHours = Math.floor(normalized / 60);
  const nextMinutes = normalized % 60;

  return `${String(nextHours).padStart(2, "0")}:${String(nextMinutes).padStart(2, "0")}`;
}

function normalizeTime(value) {
  const match = String(value || "").match(/^(\d{1,2}):(\d{2})/);
  if (!match) return "";

  const hours = Number.parseInt(match[1], 10);
  const minutes = Number.parseInt(match[2], 10);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return "";

  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function normalizeDuration(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 480 ? parsed : 60;
}

function normalizeMaxActions(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) return DEFAULT_MAX_ACTIONS;
  return Math.min(parsed, MAX_ALLOWED_ACTIONS);
}

function encodeBase64Url(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function readEnv(getEnv, name) {
  const value = typeof getEnv === "function" ? getEnv(name) : null;
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function getErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
