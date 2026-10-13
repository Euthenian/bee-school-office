import { runMonthlyCalendarReminderBatches } from "../../../lib/monthly-calendar-reminder-worker.js";

Deno.serve(async (request) => {
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed." }), { status: 405 });
  }
  const cronSecret = Deno.env.get("MONTHLY_CALENDAR_CRON_SECRET");
  if (!cronSecret) {
    return new Response(JSON.stringify({ error: "Cron secret is not configured." }), { status: 503 });
  }
  if (request.headers.get("x-monthly-calendar-cron-secret") !== cronSecret) {
    return new Response(JSON.stringify({ error: "Unauthorized." }), { status: 401 });
  }
  try {
    const result = await runMonthlyCalendarReminderBatches({
      supabaseUrl: Deno.env.get("SUPABASE_URL"),
      serviceRoleKey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
    });
    return new Response(JSON.stringify(result), {
      headers: { "Content-Type": "application/json" }
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }), {
      status: 502,
      headers: { "Content-Type": "application/json" }
    });
  }
});
