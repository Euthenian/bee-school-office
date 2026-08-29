export const GMAIL_TRIAL_BOOKING_CRON_JOB_NAME = "bee-school-gmail-trial-booking-poll";
export const GMAIL_TRIAL_BOOKING_CRON_EXPECTED_CADENCE = "*/15 * * * *";
export const GMAIL_TRIAL_BOOKING_CRON_WARNING_MINUTES = 30;
export const GMAIL_TRIAL_BOOKING_CRON_CRITICAL_MINUTES = 45;

export function getGmailTrialBookingCronHealthStatus({
  lastSuccessAt,
  minutesSinceLastSuccess,
  recentFailureCount = 0
} = {}) {
  const failureCount = normalizeCount(recentFailureCount);
  const minutes = normalizeCount(minutesSinceLastSuccess);

  if (!lastSuccessAt) return "critical";
  if (failureCount >= 2) return "critical";
  if (minutes > GMAIL_TRIAL_BOOKING_CRON_CRITICAL_MINUTES) return "critical";
  if (failureCount === 1) return "warning";
  if (minutes > GMAIL_TRIAL_BOOKING_CRON_WARNING_MINUTES) return "warning";
  return "healthy";
}

export function normalizeGmailTrialBookingCronHealth(row) {
  if (!row) return null;

  const health = {
    status: row.status || "",
    lastRunAt: row.last_run_at || null,
    lastSuccessAt: row.last_success_at || null,
    lastResult: row.last_result || "",
    lastCronStatus: row.last_cron_status || "",
    lastHttpStatus: row.last_http_status ?? null,
    minutesSinceLastSuccess: row.minutes_since_last_success ?? null,
    recentFailureCount: row.recent_failure_count ?? 0
  };

  return {
    ...health,
    status:
      health.status ||
      getGmailTrialBookingCronHealthStatus({
        lastSuccessAt: health.lastSuccessAt,
        minutesSinceLastSuccess: health.minutesSinceLastSuccess,
        recentFailureCount: health.recentFailureCount
      })
  };
}

export function shouldShowGmailTrialBookingCronHealthAlert(health) {
  return health?.status === "warning" || health?.status === "critical";
}

export function getGmailTrialBookingCronHealthAlertTone(health) {
  return health?.status === "critical" ? "critical" : "warning";
}

function normalizeCount(value) {
  const count = Number(value);
  return Number.isFinite(count) ? count : 0;
}
