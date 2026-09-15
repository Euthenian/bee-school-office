export const financialDocumentsUpdatedEvent = "financial-documents-updated";

export const financialDocumentStatuses = [
  { value: "pending", label: "Pending" },
  { value: "converted_to_expense", label: "Converted to expense" },
  { value: "dismissed", label: "Dismissed" }
];

export const financialDocumentProcessingModes = [
  { value: "manual_review", label: "Financial docs to check" },
  { value: "auto_expense", label: "Auto-create expense" }
];

export function isFinancialDocumentBadgeEligible(document) {
  return document?.status === "pending" && document?.is_read === false;
}

export function countUnreadPendingFinancialDocuments(documents = []) {
  return documents.filter(isFinancialDocumentBadgeEligible).length;
}

export function getFinancialDocumentTitle(document) {
  return (
    normalizeFinancialDocumentText(document?.title) ||
    normalizeFinancialDocumentText(document?.subject) ||
    normalizeFinancialDocumentText(document?.document_filename) ||
    "Untitled financial document"
  );
}

export function createFinancialDocumentRuleForm(defaults = {}) {
  return {
    organizationId: defaults.organizationId || defaults.organization_id || "",
    schoolId: defaults.schoolId || defaults.school_id || "",
    senderDomain: defaults.senderDomain || defaults.sender_domain || "",
    subjectContains: defaults.subjectContains || defaults.subject_contains || "",
    vendor: defaults.vendor || "",
    categoryId: defaults.categoryId || defaults.category_id || "",
    expectedAmount: stringifyRuleAmount(defaults.expectedAmount ?? defaults.expected_amount),
    currency: defaults.currency || "JPY",
    processingMode: defaults.processingMode || defaults.processing_mode || "manual_review",
    notes: defaults.notes || ""
  };
}

export function validateFinancialDocumentRuleForm(form) {
  if (!form.organizationId) return "Organization is required.";
  if (!normalizeFinancialDocumentText(form.senderDomain) && !normalizeFinancialDocumentText(form.subjectContains)) {
    return "Sender domain or subject match is required.";
  }
  if (!normalizeFinancialDocumentText(form.vendor)) return "Vendor is required.";
  if (form.processingMode === "auto_expense" && !form.categoryId) {
    return "Auto-create rules need an expense category.";
  }
  if (form.expectedAmount && (!Number.isFinite(Number(form.expectedAmount)) || Number(form.expectedAmount) <= 0)) {
    return "Expected amount must be greater than zero.";
  }
  if (!/^[A-Za-z]{3}$/.test(String(form.currency || "").trim())) return "Currency must be a three-letter code.";
  if (!financialDocumentProcessingModes.some((mode) => mode.value === form.processingMode)) {
    return "Processing mode is required.";
  }
  return "";
}

export function buildFinancialDocumentRuleInsert(input = {}) {
  return {
    organization_id: input.organizationId,
    school_id: emptyToNull(input.schoolId),
    sender_domain: emptyToNull(input.senderDomain),
    subject_contains: emptyToNull(input.subjectContains),
    vendor: normalizeFinancialDocumentText(input.vendor),
    category_id: emptyToNull(input.categoryId),
    expected_amount: normalizeRuleAmount(input.expectedAmount),
    currency: String(input.currency || "JPY").trim().toUpperCase(),
    processing_mode: input.processingMode || "manual_review",
    notes: emptyToNull(input.notes)
  };
}

export function notifyFinancialDocumentsUpdated() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(financialDocumentsUpdatedEvent));
  }
}

function normalizeFinancialDocumentText(value) {
  return String(value || "").trim();
}

function emptyToNull(value) {
  const normalized = normalizeFinancialDocumentText(value);
  return normalized ? normalized : null;
}

function stringifyRuleAmount(value) {
  return value === null || value === undefined ? "" : String(value);
}

function normalizeRuleAmount(value) {
  if (value === null || value === undefined || value === "") return null;
  return String(value).trim();
}
