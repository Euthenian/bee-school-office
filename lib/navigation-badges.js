export const ricoCancellationUpdatedEvent = "rico-cancellation-updated";
export const ricoCancellationFilterRequestedEvent = "rico-cancellation-filter-requested";

export function formatCountBadgeValue(count) {
  const numericCount = Number(count);
  if (!Number.isFinite(numericCount) || numericCount <= 0) return "";
  return numericCount > 99 ? "99+" : String(Math.floor(numericCount));
}
