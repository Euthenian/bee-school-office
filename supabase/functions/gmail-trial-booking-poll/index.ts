import {
  createGmailApiClient,
  createSupabaseRestPendingImportRepository,
  pollGmailTrialBookings,
  readGmailTrialBookingWorkerConfig,
} from "../../../lib/gmail-trial-booking-worker.js";
import { createGmailSenderClient } from "../../../lib/communications-worker.js";
import {
  createSupabaseRestCronAlertRepository,
  processGmailTrialBookingCronAlert,
  readGmailTrialBookingCronAlertConfig,
  summarizeCronAlertForResponse,
} from "../../../lib/gmail-trial-booking-cron-alerts.js";

const jsonHeaders = {
  "Content-Type": "application/json",
};

Deno.serve(async (request) => {
  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed." }, 405);
  }

  const cronSecret = Deno.env.get("GMAIL_POLL_CRON_SECRET");
  if (cronSecret && request.headers.get("x-gmail-poll-secret") !== cronSecret) {
    return jsonResponse({ error: "Unauthorized." }, 401);
  }

  const { config, errors } = readGmailTrialBookingWorkerConfig((name: string) =>
    Deno.env.get(name)
  );
  if (errors.length) {
    const alerting = await evaluateCronAlerting({
      ok: false,
      processed: 0,
      inserted: 0,
      skippedDuplicates: 0,
      parseErrors: 0,
      errors: [{ stage: "config" }],
    });

    return jsonResponse({ ok: false, errors, alerting }, 500);
  }

  const result = await pollGmailTrialBookings({
    config,
    gmailClient: createGmailApiClient(
      {
        clientId: config.gmailClientId,
        clientSecret: config.gmailClientSecret,
        refreshToken: config.gmailRefreshToken,
        sourceMailbox: config.sourceMailbox,
      },
      fetch,
    ),
    pendingImportRepository: createSupabaseRestPendingImportRepository(
      {
        supabaseUrl: config.supabaseUrl,
        serviceRoleKey: config.supabaseServiceRoleKey,
      },
      fetch,
    ),
  });

  const alerting = await evaluateCronAlerting(result);

  return jsonResponse({ ...result, alerting }, result.ok ? 200 : 502);
});

async function evaluateCronAlerting(pollResult: Record<string, unknown>) {
  const { config, errors } = readGmailTrialBookingCronAlertConfig((name: string) =>
    Deno.env.get(name)
  );

  if (errors.length) {
    return summarizeCronAlertForResponse({
      ok: false,
      action: "none",
      sent: false,
      setupRequired: true,
      recipientCount: 0,
      errors: ["trial_booking_cron_alerting_not_configured"],
    });
  }

  try {
    const summary = await processGmailTrialBookingCronAlert({
      config,
      emailProvider: createGmailSenderClient(
        {
          clientId: config.gmailClientId,
          clientSecret: config.gmailClientSecret,
          refreshToken: config.gmailRefreshToken,
          senderEmail: config.gmailSenderEmail,
        },
        fetch,
      ),
      pollResult,
      repository: createSupabaseRestCronAlertRepository(
        {
          supabaseUrl: config.supabaseUrl,
          serviceRoleKey: config.supabaseServiceRoleKey,
        },
        fetch,
      ),
    });

    return summarizeCronAlertForResponse(summary);
  } catch (error) {
    console.error("gmail trial booking cron alert evaluation failed", {
      message: error instanceof Error ? error.message : String(error),
    });

    return summarizeCronAlertForResponse({
      ok: false,
      action: "none",
      sent: false,
      setupRequired: false,
      recipientCount: config.alertRecipients?.length || 0,
      errors: ["trial_booking_cron_alert_evaluation_failed"],
    });
  }
}

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: jsonHeaders,
  });
}
