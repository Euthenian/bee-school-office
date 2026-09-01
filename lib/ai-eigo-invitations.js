import { groupStudentContacts } from "./contacts.js";
import { formatDate, formatPersonName } from "./format.js";

export const AI_EIGO_INVITATION_TEMPLATE_KEY = "ai_eigo_student_invitation";
export const AI_EIGO_INVITATION_EXPIRY_DAYS = 14;

export const aiEigoAccessStatusLabels = {
  not_invited: "Not invited",
  pending_send: "Invitation queued",
  sent: "Invited",
  send_failed: "Invitation failed",
  manual_review: "Manual review",
  expired: "Expired",
  linked: "Linked"
};

export function getStudentInvitationRecipient(student) {
  return groupStudentContacts(student?.student_contacts || []).emails[0]?.value || "";
}

export function getAiEigoLink(student) {
  return (student?.ai_eigo_student_links || []).find((link) => link?.ai_eigo_user_id) || null;
}

export function getLatestAiEigoInvitation(student) {
  return [...(student?.ai_eigo_student_invitations || [])]
    .filter((invitation) => invitation && !invitation.revoked_at && !invitation.claimed_at)
    .sort((left, right) => String(right.created_at || "").localeCompare(String(left.created_at || "")))[0] || null;
}

export function getAiEigoAccessStatus(student) {
  if (getAiEigoLink(student)) return "linked";

  const invitation = getLatestAiEigoInvitation(student);
  if (!invitation) return "not_invited";
  if (["pending_send", "sent", "send_failed", "manual_review", "expired"].includes(invitation.status)) {
    return invitation.status;
  }

  return "not_invited";
}

export function getAiEigoAccessStatusLabel(status) {
  return aiEigoAccessStatusLabels[status] || aiEigoAccessStatusLabels.not_invited;
}

export function getAiEigoAccessDetail(student) {
  const link = getAiEigoLink(student);
  if (link) {
    return link.linked_at ? `AI-EIGO: Linked ${formatDate(link.linked_at)}` : "AI-EIGO: Linked";
  }

  const invitation = getLatestAiEigoInvitation(student);
  if (!invitation) {
    return getStudentInvitationRecipient(student) ? "Ready to invite" : "No email contact";
  }

  if (invitation.status === "pending_send") return "Queued for secure email sending";
  if (invitation.status === "sent") {
    return invitation.sent_at ? `Last sent ${formatDate(invitation.sent_at)}` : "Invitation sent";
  }
  if (invitation.status === "send_failed") return invitation.last_send_error || "Email sending failed";
  if (invitation.status === "manual_review") return invitation.last_send_error || "Manual review required";
  if (invitation.status === "expired") return "Previous invitation expired";

  return "";
}

export function canSendAiEigoInvitationForStudent(student) {
  return student?.status === "active" && !getAiEigoLink(student) && Boolean(getStudentInvitationRecipient(student));
}

export function getAiEigoInvitationActionLabel(student) {
  if (getAiEigoLink(student)) return "";

  const invitation = getLatestAiEigoInvitation(student);
  if (invitation && ["pending_send", "sent"].includes(invitation.status)) return "Resend invitation";
  return "Send AI-EIGO invitation";
}

export function normalizeAiEigoInvitationResponse(data) {
  return Array.isArray(data) ? data[0] || null : data || null;
}

export function applyAiEigoInvitationResult(student, invitation) {
  if (!student || !invitation?.id) return student;

  const previous = (student.ai_eigo_student_invitations || []).filter((row) => row.id !== invitation.id);
  return {
    ...student,
    ai_eigo_student_invitations: [
      {
        id: invitation.id,
        communication_id: invitation.communication_id || null,
        created_at: invitation.created_at || new Date().toISOString(),
        last_send_error: invitation.last_send_error || null,
        recipient_email: invitation.recipient_email || getStudentInvitationRecipient(student),
        sent_at: invitation.sent_at || null,
        status: invitation.status || "pending_send",
        token_expires_at: invitation.token_expires_at || null
      },
      ...previous
    ]
  };
}

export function getAiEigoInvitationStudentLabel(student) {
  return `${formatPersonName(student)} / ${student?.schools?.name || "Unassigned school"}`;
}
