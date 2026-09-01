import {
  createGmailSenderClient,
  createGoogleCalendarClient,
  createResendSenderClient,
  createSupabaseRestCommunicationsRepository,
  processQueuedCommunicationActions,
  readCommunicationsWorkerConfig,
} from "../../../lib/communications-worker.js";

const jsonHeaders = {
  "Content-Type": "application/json",
};

Deno.serve(async (request) => {
  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed." }, 405);
  }

  const cronSecret = Deno.env.get("COMMUNICATIONS_CRON_SECRET");
  if (cronSecret && request.headers.get("x-communications-cron-secret") !== cronSecret) {
    return jsonResponse({ error: "Unauthorized." }, 401);
  }

  const { config, errors } = readCommunicationsWorkerConfig((name: string) =>
    Deno.env.get(name)
  );
  if (errors.length) {
    return jsonResponse({ ok: false, errors }, 500);
  }

  const repository = createSupabaseRestCommunicationsRepository(
    {
      supabaseUrl: config.supabaseUrl,
      serviceRoleKey: config.supabaseServiceRoleKey,
    },
    fetch,
  );

  const result = await processQueuedCommunicationActions({
    config,
    emailProvider: config.googleReady
      ? createGmailSenderClient(
          {
            clientId: config.googleClientId,
            clientSecret: config.googleClientSecret,
            refreshToken: config.googleRefreshToken,
            senderEmail: config.gmailSenderEmail,
          },
          fetch,
        )
      : null,
    resendProvider: config.resendReady
      ? createResendSenderClient(
          {
            apiKey: config.resendApiKey,
            from: config.aiEigoInvitationEmailFrom,
          },
          fetch,
        )
      : null,
    calendarProvider: config.googleReady
      ? createGoogleCalendarClient(
          {
            calendarId: config.googleCalendarId,
            clientId: config.googleClientId,
            clientSecret: config.googleClientSecret,
            refreshToken: config.googleRefreshToken,
            timeZone: config.googleCalendarTimeZone,
          },
          fetch,
        )
      : null,
    repository,
  });

  return jsonResponse(result, result.ok || result.setupRequired ? 200 : 502);
});

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: jsonHeaders,
  });
}
