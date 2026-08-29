import { GMAIL_TRIAL_BOOKING_CRON_JOB_NAME } from "./cron-health.js";

export const TRIAL_BOOKING_CRON_ALERT_EMAIL_ENV = "TRIAL_BOOKING_CRON_ALERT_EMAIL";
export const GMAIL_TRIAL_BOOKING_CRON_CRITICAL_SUBJECT =
  "[Bee School Office] Trial Booking Import CRITICAL";
export const GMAIL_TRIAL_BOOKING_CRON_RECOVERY_SUBJECT =
  "[Bee School Office] Trial Booking Import Recovered";

export function readGmailTrialBookingCronAlertConfig(getEnv) {
  const alertRecipients = parseCronAlertRecipients(readEnv(getEnv, TRIAL_BOOKING_CRON_ALERT_EMAIL_ENV));
  const config = {
    supabaseUrl: readEnv(getEnv, "SUPABASE_URL"),
    supabaseServiceRoleKey: readEnv(getEnv, "SUPABASE_SERVICE_ROLE_KEY"),
    gmailClientId: readEnv(getEnv, "GOOGLE_CLIENT_ID") || readEnv(getEnv, "GMAIL_CLIENT_ID"),
    gmailClientSecret: readEnv(getEnv, "GOOGLE_CLIENT_SECRET") || readEnv(getEnv, "GMAIL_CLIENT_SECRET"),
    gmailRefreshToken: readEnv(getEnv, "GOOGLE_REFRESH_TOKEN") || readEnv(getEnv, "GMAIL_REFRESH_TOKEN"),
    gmailSenderEmail:
      readEnv(getEnv, "GOOGLE_GMAIL_SENDER_EMAIL") ||
      readEnv(getEnv, "GMAIL_SENDER_EMAIL") ||
      readEnv(getEnv, "GMAIL_SOURCE_MAILBOX"),
    alertRecipients,
    alertRecipientHeader: alertRecipients.join(", ")
  };
  const errors = [];

  for (const [key, label] of [
    ["supabaseUrl", "SUPABASE_URL"],
    ["supabaseServiceRoleKey", "SUPABASE_SERVICE_ROLE_KEY"],
    ["gmailClientId", "GOOGLE_CLIENT_ID or GMAIL_CLIENT_ID"],
    ["gmailClientSecret", "GOOGLE_CLIENT_SECRET or GMAIL_CLIENT_SECRET"],
    ["gmailRefreshToken", "GOOGLE_REFRESH_TOKEN or GMAIL_REFRESH_TOKEN"],
    ["gmailSenderEmail", "GOOGLE_GMAIL_SENDER_EMAIL or GMAIL_SENDER_EMAIL or GMAIL_SOURCE_MAILBOX"]
  ]) {
    if (!config[key]) errors.push(`${label} is required for Trial Booking cron alerting.`);
  }

  if (!alertRecipients.length) {
    errors.push(`${TRIAL_BOOKING_CRON_ALERT_EMAIL_ENV} is required for Trial Booking cron alerting.`);
  }

  return {
    config: {
      ...config,
      ready: errors.length === 0
    },
    errors
  };
}

export function parseCronAlertRecipients(value) {
  return [...new Set(String(value || "")
    .split(",")
    .map((recipient) => recipient.trim())
    .filter(Boolean)
    .filter((recipient) => /^[^@\s,<>]+@[^@\s,<>]+\.[^@\s,<>]+$/.test(recipient))
    .map((recipient) => recipient.toLowerCase()))];
}

export async function processGmailTrialBookingCronAlert({
  config,
  emailProvider,
  logger = console,
  now = new Date().toISOString(),
  pollResult,
  repository
}) {
  const summary = {
    ok: true,
    action: "none",
    sent: false,
    setupRequired: false,
    incidentId: null,
    healthStatus: null,
    recipientCount: config?.alertRecipients?.length || 0,
    errors: []
  };

  if (!config?.ready) {
    summary.ok = false;
    summary.setupRequired = true;
    summary.errors = ["trial_booking_cron_alerting_not_configured"];
    return summary;
  }

  const currentResult = buildSafeCurrentPollResult(pollResult);
  const evaluation = await repository.evaluateCronAlert({
    currentHttpStatus: pollResult?.ok === true ? 200 : 502,
    currentOk: pollResult?.ok === true,
    currentResult,
    now
  });

  summary.action = evaluation.action || "none";
  summary.incidentId = evaluation.incidentId || null;
  summary.healthStatus = evaluation.healthStatus || null;

  if (summary.action !== "send_critical_alert" && summary.action !== "send_recovery_alert") {
    return summary;
  }

  const alertType = summary.action === "send_critical_alert" ? "critical" : "recovery";
  const message =
    alertType === "critical"
      ? buildCriticalAlertEmail({ detectedAt: now, health: evaluation })
      : buildRecoveryAlertEmail({ health: evaluation, incident: evaluation, recoveredAt: now });

  try {
    const result = await emailProvider.sendEmail({
      body: message.body,
      recipient: config.alertRecipientHeader,
      subject: message.subject
    });

    await repository.recordCronAlertEmailResult({
      alertType,
      errorMessage: null,
      externalId: result?.externalId || null,
      incidentId: summary.incidentId
    });

    summary.sent = true;
    return summary;
  } catch (error) {
    summary.ok = false;
    summary.errors = ["trial_booking_cron_alert_email_failed"];
    const messageText = getErrorMessage(error);

    await repository.recordCronAlertEmailResult({
      alertType,
      errorMessage: messageText,
      externalId: null,
      incidentId: summary.incidentId
    });

    logger.error?.("gmail trial booking cron alert email failed", {
      alertType,
      incidentId: summary.incidentId,
      message: messageText
    });

    return summary;
  }
}

export function buildSafeCurrentPollResult(pollResult) {
  if (!pollResult) return "current_poll_unknown";

  const parts = [
    pollResult.ok ? "current_poll_ok" : "current_poll_failed",
    `processed=${normalizeCount(pollResult.processed)}`,
    `inserted=${normalizeCount(pollResult.inserted)}`,
    `duplicates=${normalizeCount(pollResult.skippedDuplicates)}`,
    `parse_errors=${normalizeCount(pollResult.parseErrors)}`,
    `failed=${Array.isArray(pollResult.errors) ? pollResult.errors.length : 0}`
  ];

  return parts.join(" ");
}

export function buildCriticalAlertEmail({ detectedAt, health }) {
  const body = [
    "Trial Booking Gmail import is CRITICAL.",
    "",
    `Detected at: ${formatValue(detectedAt)}`,
    `Last successful run: ${formatValue(health.lastSuccessAt)}`,
    `Minutes since last success: ${formatValue(health.minutesSinceLastSuccess)}`,
    `Last run: ${formatValue(health.lastRunAt)}`,
    `Latest safe result: ${formatValue(health.lastResult)}`,
    `Cron status: ${formatValue(health.lastCronStatus)}`,
    `HTTP status: ${formatValue(health.lastHttpStatus)}`,
    `Recent failure count: ${formatValue(health.recentFailureCount)}`,
    "",
    "No booking content, customer data, tokens, keys, headers, or Vault values are included in this alert."
  ].join("\n");

  return {
    subject: GMAIL_TRIAL_BOOKING_CRON_CRITICAL_SUBJECT,
    body
  };
}

export function buildRecoveryAlertEmail({ health, incident, recoveredAt }) {
  const durationMinutes = getDurationMinutes(incident.incidentStartedAt, recoveredAt);
  const body = [
    "Trial Booking Gmail import has recovered.",
    "",
    `Recovered at: ${formatValue(recoveredAt)}`,
    `Latest successful run: ${formatValue(health.lastSuccessAt)}`,
    `Incident started at: ${formatValue(incident.incidentStartedAt)}`,
    `Incident duration minutes: ${formatValue(durationMinutes)}`,
    `Latest safe result: ${formatValue(health.lastResult)}`,
    "",
    "No booking content, customer data, tokens, keys, headers, or Vault values are included in this alert."
  ].join("\n");

  return {
    subject: GMAIL_TRIAL_BOOKING_CRON_RECOVERY_SUBJECT,
    body
  };
}

export function createSupabaseRestCronAlertRepository({ serviceRoleKey, supabaseUrl }, fetchImpl = fetch) {
  const baseUrl = supabaseUrl.replace(/\/$/, "");
  const headers = {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    "Content-Type": "application/json"
  };

  return {
    async evaluateCronAlert({ currentHttpStatus, currentOk, currentResult, now }) {
      const response = await fetchImpl(`${baseUrl}/rest/v1/rpc/evaluate_gmail_trial_booking_cron_alert_mvp`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          p_current_http_status: currentHttpStatus,
          p_current_ok: currentOk,
          p_current_result: currentResult,
          p_now: now
        })
      });

      if (!response.ok) {
        throw new Error(`Trial Booking cron alert evaluation failed with HTTP ${response.status}.`);
      }

      const rows = await response.json();
      return normalizeAlertEvaluation(Array.isArray(rows) ? rows[0] : rows);
    },
    async recordCronAlertEmailResult({ alertType, errorMessage = null, externalId = null, incidentId }) {
      const response = await fetchImpl(`${baseUrl}/rest/v1/rpc/record_gmail_trial_booking_cron_alert_email_result`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          p_alert_type: alertType,
          p_error_message: errorMessage,
          p_external_id: externalId,
          p_incident_id: incidentId
        })
      });

      if (!response.ok) {
        throw new Error(`Trial Booking cron alert result update failed with HTTP ${response.status}.`);
      }
    }
  };
}

export function normalizeAlertEvaluation(row) {
  if (!row) {
    return {
      action: "none",
      healthStatus: null
    };
  }

  return {
    action: row.action || "none",
    incidentId: row.incident_id || null,
    healthStatus: row.health_status || null,
    detectedAt: row.detected_at || null,
    lastRunAt: row.last_run_at || null,
    lastSuccessAt: row.last_success_at || null,
    lastResult: row.last_result || "",
    lastCronStatus: row.last_cron_status || "",
    lastHttpStatus: row.last_http_status ?? null,
    minutesSinceLastSuccess: row.minutes_since_last_success ?? null,
    recentFailureCount: row.recent_failure_count ?? 0,
    incidentStartedAt: row.incident_started_at || null,
    recoveredAt: row.recovered_at || null
  };
}

export function summarizeCronAlertForResponse(summary) {
  return {
    ok: summary?.ok === true,
    action: summary?.action || "none",
    sent: summary?.sent === true,
    setupRequired: summary?.setupRequired === true,
    incidentId: summary?.incidentId || null,
    healthStatus: summary?.healthStatus || null,
    recipientCount: normalizeCount(summary?.recipientCount),
    errors: Array.isArray(summary?.errors) ? summary.errors : []
  };
}

export function getCronAlertMonitorKey() {
  return GMAIL_TRIAL_BOOKING_CRON_JOB_NAME;
}

function formatValue(value) {
  if (value === null || value === undefined || value === "") return "unknown";
  return String(value);
}

function getDurationMinutes(startedAt, endedAt) {
  const start = startedAt ? new Date(startedAt).getTime() : NaN;
  const end = endedAt ? new Date(endedAt).getTime() : NaN;
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  return Math.floor((end - start) / 60_000);
}

function normalizeCount(value) {
  const count = Number(value);
  return Number.isFinite(count) ? count : 0;
}

function readEnv(getEnv, name) {
  const value = typeof getEnv === "function" ? getEnv(name) : null;
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function getErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
