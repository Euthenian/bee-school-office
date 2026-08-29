import {
  createGmailApiClient,
  createSupabaseRestPendingImportRepository,
  pollGmailTrialBookings,
  readGmailTrialBookingWorkerConfig,
} from "../../../lib/gmail-trial-booking-worker.js";

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
    return jsonResponse({ ok: false, errors }, 500);
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

  return jsonResponse(result, result.ok ? 200 : 502);
});

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: jsonHeaders,
  });
}
