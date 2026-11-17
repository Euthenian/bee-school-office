import { AI_EIGO_INVITATION_TEMPLATE_KEY } from "./ai-eigo-invitations.js";

const GOOGLE_OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_CALENDAR_API_BASE_URL = "https://www.googleapis.com/calendar/v3";
const RESEND_EMAILS_ENDPOINT = "https://api.resend.com/emails";
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
    googleCalendarId: readEnv(getEnv, "GOOGLE_CALENDAR_ID"),
    googleCalendarTimeZone: readEnv(getEnv, "GOOGLE_CALENDAR_TIME_ZONE") || DEFAULT_TIME_ZONE,
    resendApiKey: readEnv(getEnv, "RESEND_API_KEY"),
    beeSchoolResendApiKey: readEnv(getEnv, "BEE_SCHOOL_RESEND_API_KEY"),
    beeSchoolEmailFrom: readEnv(getEnv, "BEE_SCHOOL_EMAIL_FROM"),
    aiEigoInvitationEmailFrom: readEnv(getEnv, "AI_EIGO_INVITATION_EMAIL_FROM"),
    maxActions: normalizeMaxActions(readEnv(getEnv, "COMMUNICATIONS_MAX_ACTIONS"))
  };
  const errors = [];
  const missingGoogleSecrets = [];
  const missingResendSecrets = [];

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
    ["googleCalendarId", "GOOGLE_CALENDAR_ID"]
  ]) {
    if (!config[key]) missingGoogleSecrets.push(label);
  }

  for (const [key, label] of [
    ["resendApiKey", "RESEND_API_KEY"],
    ["beeSchoolResendApiKey", "BEE_SCHOOL_RESEND_API_KEY"],
    ["beeSchoolEmailFrom", "BEE_SCHOOL_EMAIL_FROM"],
    ["aiEigoInvitationEmailFrom", "AI_EIGO_INVITATION_EMAIL_FROM"]
  ]) {
    if (!config[key]) missingResendSecrets.push(label);
  }

  const googleReady = missingGoogleSecrets.length === 0;
  const resendReady = missingResendSecrets.length === 0;
  const beeSchoolResendReady = Boolean(config.beeSchoolResendApiKey && config.beeSchoolEmailFrom);
  const aiEigoInvitationResendReady = Boolean(config.resendApiKey && config.aiEigoInvitationEmailFrom);

  return {
    config: {
      ...config,
      googleReady,
      missingGoogleSecrets,
      resendReady,
      missingResendSecrets,
      beeSchoolResendReady,
      aiEigoInvitationResendReady
    },
    errors,
    googleReady,
    missingGoogleSecrets,
    resendReady,
    missingResendSecrets,
    beeSchoolResendReady,
    aiEigoInvitationResendReady
  };
}

export async function processQueuedCommunicationActions({
  calendarProvider,
  config,
  logger = console,
  repository,
  aiEigoInvitationResendProvider,
  resendProvider
}) {
  const summary = {
    ok: true,
    setupRequired: false,
    missingGoogleSecrets: [],
    missingResendSecrets: [],
    enqueuedNoShowFollowUps: 0,
    processed: 0,
    succeeded: 0,
    failed: 0,
    skipped: 0,
    errors: []
  };

  const dueNoShowRows = await repository.enqueueDueNoShowFollowUps({ limit: config.maxActions || DEFAULT_MAX_ACTIONS });
  summary.enqueuedNoShowFollowUps = Array.isArray(dueNoShowRows) ? dueNoShowRows.length : 0;

  const actions = await repository.claimPendingIntegrationActions({ limit: config.maxActions || DEFAULT_MAX_ACTIONS });
  if (!actions.length) {
    return summary;
  }

  for (const action of actions) {
    const missingSecrets = getMissingSecretsForAction(action, config);
    if (missingSecrets.length) {
      summary.ok = false;
      summary.setupRequired = true;
      summary.skipped += 1;
      appendMissingSecrets(summary, action, missingSecrets);
      await repository.releaseClaim({
        idempotencyKey: action.idempotency_key,
        claimToken: action.claim_token
      });
      continue;
    }

    summary.processed += 1;

    let result;
    try {
      result = await processIntegrationAction({
        action,
        calendarProvider,
        repository,
        aiEigoInvitationResendProvider,
        resendProvider
      });
    } catch (error) {
      const message = getErrorMessage(error);
      result = { status: "failed", errorMessage: message, responsePayload: { error: message } };
      logger.error?.("communication action failed", { idempotencyKey: action.idempotency_key, message });
    }

    try {
      await repository.recordActionResult({
        idempotencyKey: action.idempotency_key,
        ...(action.claim_token ? { claimToken: action.claim_token } : {}),
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
      logger.error?.("communication action result could not be recorded; claim requires review", {
        idempotencyKey: action.idempotency_key, message
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
    async claimPendingIntegrationActions({ limit }) {
      const response = await fetchImpl(`${baseUrl}/rest/v1/rpc/claim_communication_integration_actions`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ p_limit: limit || DEFAULT_MAX_ACTIONS })
      });
      if (!response.ok) {
        throw new Error(`Communication action claim failed with HTTP ${response.status}.`);
      }
      return response.json();
    },
    async releaseClaim({ idempotencyKey, claimToken }) {
      const response = await fetchImpl(`${baseUrl}/rest/v1/rpc/release_communication_integration_claim`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ p_idempotency_key: idempotencyKey, p_claim_token: claimToken })
      });
      if (!response.ok) {
        throw new Error(`Communication action claim release failed with HTTP ${response.status}.`);
      }
    },
    async recordActionResult({ idempotencyKey, claimToken, status, externalId = null, errorMessage = null, responsePayload = {} }) {
      const response = await fetchImpl(`${baseUrl}/rest/v1/rpc/record_claimed_communication_integration_result`, {
        method: "POST",
        headers: {
          ...headers,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          p_idempotency_key: idempotencyKey,
          p_claim_token: claimToken,
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

export function createResendSenderClient(
  { apiKey, from, apiKeySecretName = "RESEND_API_KEY", fromSecretName = "EMAIL_FROM" },
  fetchImpl = fetch
) {
  assertNonEmpty(apiKey, `${apiKeySecretName} is required for Resend email delivery.`);
  assertNonEmpty(from, `${fromSecretName} is required for Resend email delivery.`);

  return {
    async sendEmail({ body, html, recipient, recipients, subject, text }) {
      const to = Array.isArray(recipients)
        ? recipients.filter(Boolean)
        : Array.isArray(recipient)
          ? recipient.filter(Boolean)
          : recipient
            ? [recipient]
            : [];

      if (!to.length) {
        return { status: "failed", errorMessage: "Email action is missing a recipient." };
      }

      const plainText = text || body || "";
      const response = await fetchImpl(RESEND_EMAILS_ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          from,
          to,
          subject: subject || "",
          html: html || renderPlainTextEmailHtml(plainText),
          text: plainText
        })
      });

      const responseText = await response.text();
      if (!response.ok) {
        throw new Error(responseText || `Resend send failed with HTTP ${response.status}.`);
      }

      const json = responseText ? JSON.parse(responseText) : {};
      assertNonEmpty(json.id, "Resend response did not include a message id.");

      return {
        externalId: json.id,
        responsePayload: { id: json.id },
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

async function processIntegrationAction({
  action,
  calendarProvider,
  repository,
  aiEigoInvitationResendProvider,
  resendProvider
}) {
  const payload = action.request_payload || {};

  if (action.provider === "gmail" && action.action_type === "send_email") {
    return {
      status: "skipped",
      errorMessage: "Gmail outbound email is disabled; email actions must use Resend."
    };
  }

  if (action.provider === "resend" && action.action_type === "send_email") {
    const isAiEigoInvitation = isAiEigoInvitationEmailPayload(payload);
    const emailPayload = isAiEigoInvitation
      ? await repository.prepareAiEigoInvitationEmail({ invitationId: payload.invitation_id })
      : payload;
    const selectedResendProvider = isAiEigoInvitation ? aiEigoInvitationResendProvider : resendProvider;

    if (!emailPayload.recipient) {
      return { status: "failed", errorMessage: "Email action is missing a recipient." };
    }

    if (!selectedResendProvider) {
      return { status: "failed", errorMessage: "Resend sender is not configured for this email action." };
    }

    return selectedResendProvider.sendEmail(
      isAiEigoInvitation
        ? { ...emailPayload, text: emailPayload.body, html: renderAiEigoInvitationHtml(emailPayload.body) }
        : emailPayload
    );
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

function getMissingSecretsForAction(action, config) {
  if (action.provider === "gmail" && action.action_type === "send_email") {
    return [];
  }

  if (action.provider === "google_calendar" && action.action_type === "create_calendar_event") {
    return config.googleReady ? [] : config.missingGoogleSecrets || [];
  }

  if (action.provider === "resend" && action.action_type === "send_email") {
    const missingSecrets = [];

    if (isAiEigoInvitationEmailPayload(action.request_payload || {})) {
      if (!config.resendApiKey) missingSecrets.push("RESEND_API_KEY");
      if (!config.aiEigoInvitationEmailFrom) missingSecrets.push("AI_EIGO_INVITATION_EMAIL_FROM");
    } else {
      if (!config.beeSchoolResendApiKey) missingSecrets.push("BEE_SCHOOL_RESEND_API_KEY");
      if (!config.beeSchoolEmailFrom) missingSecrets.push("BEE_SCHOOL_EMAIL_FROM");
    }

    return missingSecrets;
  }

  return [];
}

function isAiEigoInvitationEmailPayload(payload) {
  return payload.template_key === AI_EIGO_INVITATION_TEMPLATE_KEY && Boolean(payload.invitation_id);
}

function appendMissingSecrets(summary, action, missingSecrets) {
  if (action.provider === "resend") {
    summary.missingResendSecrets = mergeUnique(summary.missingResendSecrets, missingSecrets);
    return;
  }

  if (action.provider === "gmail" || action.provider === "google_calendar") {
    summary.missingGoogleSecrets = mergeUnique(summary.missingGoogleSecrets, missingSecrets);
  }
}

function mergeUnique(left, right) {
  return [...new Set([...(left || []), ...(right || [])])];
}

function normalizeMaxActions(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) return DEFAULT_MAX_ACTIONS;
  return Math.min(parsed, MAX_ALLOWED_ACTIONS);
}

function renderPlainTextEmailHtml(value) {
  return `<!doctype html><html><body><pre style="font-family: Arial, Helvetica, sans-serif; white-space: pre-wrap;">${escapeHtml(
    value
  )}</pre></body></html>`;
}

export function renderAiEigoInvitationHtml(body) {
  const lines = String(body || "").split(/\r?\n/).map((line) => line.trim());
  const links = lines.filter((line) => /^https:\/\/ai-eigo\.com\/invite\/[A-Za-z0-9_-]+$/.test(line));
  const ctaIndices = lines.flatMap((line, index) =>
    line === "[CTA: 利用を開始する]" || line === "[利用を開始する]" ? [index] : []
  );
  const ctaIndex = ctaIndices[0];
  const urlIndex = lines.findIndex((line) => line === links[0]);
  if (links.length !== 1 || ctaIndices.length !== 1 || urlIndex <= ctaIndex) {
    throw new Error("AI-EIGO invitation email is missing its secure activation URL or CTA.");
  }

  const escapedUrl = escapeHtml(links[0]);
  const beforeCta = lines.slice(0, ctaIndex).filter(Boolean);
  const fallbackInstructions = lines.slice(ctaIndex + 1, urlIndex).filter(Boolean);
  const afterUrl = lines.slice(urlIndex + 1).filter(Boolean);
  const footerIndex = afterUrl.indexOf("Bee School");
  const closing = footerIndex < 0 ? afterUrl : [...afterUrl.slice(0, footerIndex), ...afterUrl.slice(footerIndex + 1)];
  const paragraph = (line) => `<p style="margin:0 0 22px;color:#17243c;font-size:16px;line-height:1.8;">${escapeHtml(line)}</p>`;

  return `<!doctype html>
<html lang="ja">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0;padding:0;background-color:#fcfaf6;font-family:Arial,Helvetica,sans-serif;color:#17243c;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;background-color:#fcfaf6;">
    <tr><td align="center" style="padding:32px 16px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;max-width:600px;table-layout:fixed;background-color:#ffffff;border:1px solid #e5e9ef;">
        <tr><td style="padding:28px 36px;border-bottom:3px solid #d9a21b;">
          <span style="color:#17243c;font-size:22px;font-weight:bold;line-height:1.3;">Bee School</span>
        </td></tr>
        <tr><td style="padding:36px 36px 30px;">
          ${beforeCta.map(paragraph).join("\n          ")}
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:6px auto 0;"><tr>
            <td align="center" bgcolor="#087a50" style="background-color:#087a50;border-radius:8px;">
              <a href="${escapedUrl}" style="display:inline-block;padding:15px 34px;background-color:#087a50;border:1px solid #087a50;border-radius:8px;color:#ffffff;font-size:16px;font-weight:bold;line-height:24px;text-align:center;text-decoration:none;">利用を開始する</a>
            </td>
          </tr></table>
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;"><tr><td style="padding:24px 0 28px;">
            ${fallbackInstructions.map(paragraph).join("\n            ")}
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;"><tr>
              <td style="padding:14px 16px;background-color:#fcfaf6;border:1px solid #e5e9ef;word-break:break-all;overflow-wrap:anywhere;">
                <a href="${escapedUrl}" style="color:#086542;font-size:13px;line-height:1.7;text-decoration:underline;word-break:break-all;overflow-wrap:anywhere;">${escapedUrl}</a>
              </td>
            </tr></table>
          </td></tr></table>
          ${closing.map(paragraph).join("\n          ")}
        </td></tr>
        <tr><td style="padding:22px 36px;border-top:1px solid #e5e9ef;color:#65758b;font-size:13px;line-height:1.6;">Bee School</td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function assertNonEmpty(value, message) {
  if (!String(value || "").trim()) {
    throw new Error(message);
  }
}

function readEnv(getEnv, name) {
  const value = typeof getEnv === "function" ? getEnv(name) : null;
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function getErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
