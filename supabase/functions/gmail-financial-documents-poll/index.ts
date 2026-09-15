import {
  createGmailFinancialDocumentApiClient,
  createSupabaseRestFinancialDocumentRepository,
  pollGmailFinancialDocuments,
  readGmailFinancialDocumentWorkerConfig,
} from "../../../lib/gmail-financial-documents-worker.js";

const jsonHeaders = {
  "Content-Type": "application/json",
};

Deno.serve(async (request) => {
  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed." }, 405);
  }

  const cronSecret = Deno.env.get("GMAIL_FINANCIAL_POLL_CRON_SECRET");
  if (cronSecret && request.headers.get("x-gmail-financial-poll-secret") !== cronSecret) {
    return jsonResponse({ error: "Unauthorized." }, 401);
  }

  const { config, errors } = readGmailFinancialDocumentWorkerConfig((name: string) =>
    Deno.env.get(name)
  );
  if (errors.length) {
    return jsonResponse({ ok: false, errors }, 500);
  }

  const result = await pollGmailFinancialDocuments({
    config,
    financialDocumentRepository: createSupabaseRestFinancialDocumentRepository(
      {
        supabaseUrl: config.supabaseUrl,
        serviceRoleKey: config.supabaseServiceRoleKey,
      },
      fetch,
    ),
    gmailClient: createGmailFinancialDocumentApiClient(
      {
        clientId: config.gmailClientId,
        clientSecret: config.gmailClientSecret,
        refreshToken: config.gmailRefreshToken,
        sourceMailbox: config.sourceMailbox,
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
