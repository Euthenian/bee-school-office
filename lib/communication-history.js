export const unavailableEmailBody = "Email content is unavailable for this record.";

export function getEmailHistoryPreview(communication) {
  const recipient = communication?.recipient?.trim() || "";
  const body = communication?.body;
  const status = communication?.delivery_status;

  return {
    to: recipient ? `Recipient name not recorded (${recipient})` : "No recipient recorded",
    subject: communication?.subject || "No subject recorded",
    date: communication?.sent_at || communication?.created_at,
    status: status === "sent" ? "Sent"
      : status === "failed" || status === "partial_failed" ? "Failed"
        : status === "queued" || status === "draft" ? "Pending"
          : status === "skipped" ? "Skipped" : "Unknown",
    body: typeof body === "string" && body.trim() ? body : unavailableEmailBody
  };
}
