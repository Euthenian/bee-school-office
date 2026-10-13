const DEFAULT_BATCH_SIZE = 200;
const DEFAULT_MAX_BATCHES = 20;

export async function runMonthlyCalendarReminderBatches({
  supabaseUrl,
  serviceRoleKey,
  fetchImpl = fetch,
  batchSize = DEFAULT_BATCH_SIZE,
  maxBatches = DEFAULT_MAX_BATCHES
}) {
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
  }
  const summary = { batches: 0, processed: 0, queued: 0, skipped: 0, moreDue: false };
  for (let index = 0; index < maxBatches; index += 1) {
    const response = await fetchImpl(
      `${supabaseUrl.replace(/\/$/, "")}/rest/v1/rpc/enqueue_monthly_calendar_reminder_batch`,
      {
        method: "POST",
        headers: {
          apikey: serviceRoleKey,
          Authorization: `Bearer ${serviceRoleKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ p_limit: batchSize })
      }
    );
    if (!response.ok) {
      throw new Error(`Monthly calendar reminder batch failed with HTTP ${response.status}.`);
    }
    const result = await response.json();
    if (!result?.due) return summary;
    summary.batches += 1;
    summary.processed += result.processed;
    summary.queued += result.queued;
    summary.skipped += result.skipped;
    summary.moreDue = !result.complete;
  }
  // The batch cap bounds one invocation; a later trigger continues the run.
  summary.moreDue = true;
  return summary;
}
