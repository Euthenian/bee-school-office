import { StatusBadge } from "@/components/StatusBadge";
import { formatDateTime, humanize } from "@/lib/format";

export function CommunicationHistory({ communications }) {
  if (!communications?.length) {
    return <div className="table-placeholder">No communication history yet.</div>;
  }

  return (
    <div className="communication-history">
      {communications.map((communication) => (
        <article className="list-card" key={communication.id}>
          <div className="list-card-header communication-history-header">
            <strong>{communication.subject || humanize(communication.communication_type)}</strong>
            <StatusBadge value={communication.delivery_status} />
          </div>
          <span>
            {communication.recipient || "No recipient"} / {humanize(communication.channel)} /{" "}
            {communication.sent_at ? formatDateTime(communication.sent_at) : formatDateTime(communication.created_at)}
          </span>
          {communication.error_message ? <p className="communication-error">{communication.error_message}</p> : null}
        </article>
      ))}
    </div>
  );
}
