import {
  createGmailSenderClient,
  createGoogleCalendarClient,
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

  const { config, errors, missingGoogleSecrets } = readCommunicationsWorkerConfig((name: string) =>
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

  if (missingGoogleSecrets.length) {
    const enqueued = await repository.enqueueDueNoShowFollowUps({ limit: config.maxActions });
    return jsonResponse(
      {
        ok: false,
        setupRequired: true,
        missingGoogleSecrets,
        enqueuedNoShowFollowUps: Array.isArray(enqueued) ? enqueued.length : 0,
      },
      200,
    );
  }

  const result = await processQueuedCommunicationActions({
    config,
    emailProvider: createGmailSenderClient(
      {
        clientId: config.googleClientId,
        clientSecret: config.googleClientSecret,
        refreshToken: config.googleRefreshToken,
        senderEmail: config.gmailSenderEmail,
      },
      fetch,
    ),
    calendarProvider: createGoogleCalendarClient(
      {
        calendarId: config.googleCalendarId,
        clientId: config.googleClientId,
        clientSecret: config.googleClientSecret,
        refreshToken: config.googleRefreshToken,
        timeZone: config.googleCalendarTimeZone,
      },
      fetch,
    ),
    repository,
  });

  return jsonResponse(result, result.ok ? 200 : 502);
});

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: jsonHeaders,
  });
}
