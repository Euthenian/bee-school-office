import { humanize } from "@/lib/format";

export function StatusBadge({ value }) {
  const status = value || "unknown";
  return <span className={`status-badge ${status}`}>{humanize(status)}</span>;
}
