export function formatCountBadgeValue(count) {
  const numericCount = Number(count);
  if (!Number.isFinite(numericCount) || numericCount <= 0) return "";
  return numericCount > 99 ? "99+" : String(Math.floor(numericCount));
}
