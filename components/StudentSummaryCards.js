import { ActionIcon } from "./ActionIcon";
import { MetricCard } from "./Surface";

export function StudentSummaryCards({ metrics, loading, showAiEigo }) {
  return (
    <div className="students-summary-grid" aria-label="Student summary">
      <MetricCard label="Total students" value={metrics?.total} loading={loading} description="Available student records" icon={<ActionIcon name="users" />} tone="gold" />
      <MetricCard label="Active students" value={metrics?.active} loading={loading} description="Currently active" icon={<ActionIcon name="check" />} tone="green" />
      <MetricCard label="Inactive students" value={metrics?.inactive} loading={loading} description="Currently inactive" icon={<ActionIcon name="pause" />} tone="red" />
      {showAiEigo ? <MetricCard label="AI-EIGO invited" value={metrics?.invited} loading={loading} description="Invited or linked" icon={<ActionIcon name="graduation" />} tone="blue" /> : null}
    </div>
  );
}
