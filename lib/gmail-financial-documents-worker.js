import {
  createGmailApiClient,
  extractGmailMessageBody,
  extractGmailMessageMetadata,
  normalizeImportAfterDate
} from "./gmail-trial-booking-worker.js";
import { isTrialBookingSubject } from "./trial-booking-imports.js";

const DEFAULT_MAX_RESULTS = 10;
const MAX_ALLOWED_RESULTS = 50;
const FINANCIAL_DOCUMENT_TABLE = "financial_documents";
const FINANCIAL_DOCUMENT_RULE_TABLE = "financial_document_rules";

const financialSignalPatterns = [
  { key: "invoice", pattern: /invoice|\u8acb\u6c42\u66f8/i },
  { key: "receipt", pattern: /receipt|\u9818\u53ce\u66f8/i },
  { key: "billing", pattern: /billing|bill/i },
  { key: "payment", pattern: /payment|\u652f\u6255\u3044/i },
  { key: "statement", pattern: /statement|\u660e\u7d30/i }
];

const financialAttachmentPattern = /\.(pdf|csv|xlsx?|jpg|jpeg|png)$/i;

export function readGmailFinancialDocumentWorkerConfig(getEnv) {
  const config = {
    supabaseUrl: readEnv(getEnv, "SUPABASE_URL"),
    supabaseServiceRoleKey: readEnv(getEnv, "SUPABASE_SERVICE_ROLE_KEY"),
    gmailClientId: readEnv(getEnv, "GMAIL_CLIENT_ID"),
    gmailClientSecret: readEnv(getEnv, "GMAIL_CLIENT_SECRET"),
    gmailRefreshToken: readEnv(getEnv, "GMAIL_REFRESH_TOKEN"),
    sourceMailbox: normalizeNullableString(readEnv(getEnv, "GMAIL_SOURCE_MAILBOX")),
    organizationId: normalizeNullableString(readEnv(getEnv, "GMAIL_TENANT_ORGANIZATION_ID")),
    schoolId: normalizeNullableString(readEnv(getEnv, "GMAIL_TENANT_SCHOOL_ID")),
    importAfter: normalizeImportAfterDate(readEnv(getEnv, "GMAIL_FINANCIAL_IMPORT_AFTER")),
    maxResults: normalizeMaxResults(readEnv(getEnv, "GMAIL_FINANCIAL_POLL_MAX_RESULTS"))
  };
  const errors = [];

  for (const [key, label] of [
    ["supabaseUrl", "SUPABASE_URL"],
    ["supabaseServiceRoleKey", "SUPABASE_SERVICE_ROLE_KEY"],
    ["gmailClientId", "GMAIL_CLIENT_ID"],
    ["gmailClientSecret", "GMAIL_CLIENT_SECRET"],
    ["gmailRefreshToken", "GMAIL_REFRESH_TOKEN"],
    ["sourceMailbox", "GMAIL_SOURCE_MAILBOX"],
    ["organizationId", "GMAIL_TENANT_ORGANIZATION_ID"],
    ["schoolId", "GMAIL_TENANT_SCHOOL_ID"],
    ["importAfter", "GMAIL_FINANCIAL_IMPORT_AFTER"]
  ]) {
    if (!config[key]) errors.push(`${label} is required.`);
  }

  return { config, errors };
}

export function buildGmailFinancialDocumentSearchQuery({ importAfter } = {}) {
  const after = normalizeImportAfterDate(importAfter);
  if (!after) {
    throw new Error("GMAIL_FINANCIAL_IMPORT_AFTER is required to prevent accidental historical backfill.");
  }

  return [
    "in:inbox",
    "-in:sent",
    '-from:calendar-notification@google.com',
    '-subject:"Re:"',
    '-subject:"Fwd:"',
    "(invoice OR receipt OR billing OR bill OR payment OR statement)",
    `after:${after.replaceAll("-", "/")}`
  ].join(" ");
}

export async function pollGmailFinancialDocuments({ config, financialDocumentRepository, gmailClient, logger = console }) {
  const query = buildGmailFinancialDocumentSearchQuery(config);
  const outcomes = [];
  const summary = {
    ok: true,
    query,
    processed: 0,
    inserted: 0,
    autoCreatedExpenses: 0,
    skippedDuplicates: 0,
    ignored: 0,
    errors: [],
    outcomes
  };

  let rules = [];
  if (typeof financialDocumentRepository.listActiveRules === "function") {
    try {
      rules = await financialDocumentRepository.listActiveRules({
        organizationId: config.organizationId,
        schoolId: config.schoolId
      });
    } catch (error) {
      summary.ok = false;
      summary.errors.push({ stage: "rules", message: getErrorMessage(error) });
      logger.error?.("gmail_financial_document_poll rules failed", { error: getErrorMessage(error) });
    }
  }

  let messageSummaries;
  try {
    messageSummaries = await gmailClient.listMessages({ q: query, maxResults: config.maxResults || DEFAULT_MAX_RESULTS });
  } catch (error) {
    summary.ok = false;
    summary.errors.push({ stage: "list", message: getErrorMessage(error) });
    logger.error?.("gmail_financial_document_poll list failed", { error: getErrorMessage(error) });
    return summary;
  }

  for (const messageSummary of messageSummaries || []) {
    const gmailMessageId = normalizeNullableString(messageSummary?.id);
    if (!gmailMessageId) {
      summary.ignored += 1;
      outcomes.push({ status: "ignored", reason: "missing_message_id" });
      continue;
    }

    const outcome = { gmailMessageId };
    outcomes.push(outcome);
    summary.processed += 1;

    try {
      if (await financialDocumentRepository.hasFinancialDocument({ sourceMailbox: config.sourceMailbox, gmailMessageId })) {
        outcome.status = "skipped_duplicate";
        summary.skippedDuplicates += 1;
        continue;
      }

      const message = await gmailClient.getMessage(gmailMessageId);
      const metadata = extractFinancialGmailMessageMetadata(message);
      const classification = classifyFinancialEmail(metadata);

      if (!classification.isFinancial) {
        outcome.status = "ignored";
        outcome.reason = classification.reason;
        summary.ignored += 1;
        continue;
      }

      const rule = findMatchingFinancialDocumentRule(rules, {
        ...metadata,
        schoolId: config.schoolId
      });
      const row = buildFinancialDocumentFromGmailMessage({ classification, config, metadata, rule });
      const insertResult = await financialDocumentRepository.insertFinancialDocument(row);
      outcome.status = insertResult.inserted === false ? "skipped_duplicate" : "inserted";
      outcome.documentId = insertResult.id || null;
      outcome.processingMode = row.processingMode;
      outcome.ruleId = rule?.id || null;

      if (outcome.status === "inserted") summary.inserted += 1;
      else summary.skippedDuplicates += 1;

      if (outcome.documentId && shouldAutoCreateExpense(row, rule) && typeof financialDocumentRepository.createExpenseFromDocument === "function") {
        const expenseId = await financialDocumentRepository.createExpenseFromDocument({
          amount: row.detectedAmount,
          categoryId: row.categoryId,
          currency: row.detectedCurrency || "JPY",
          description: row.title,
          documentId: outcome.documentId,
          expenseDate: (row.receivedAt || new Date().toISOString()).slice(0, 10),
          paymentMethod: "bank_transfer",
          schoolId: row.schoolId,
          vendor: row.vendor
        });
        outcome.autoExpenseId = expenseId || null;
        summary.autoCreatedExpenses += expenseId ? 1 : 0;
      }
    } catch (error) {
      outcome.status = "error";
      outcome.error = getErrorMessage(error);
      summary.errors.push({ gmailMessageId, message: outcome.error });
      logger.error?.("gmail_financial_document_poll message failed", { gmailMessageId, error: outcome.error });
    }
  }

  return summary;
}

export function createGmailFinancialDocumentApiClient(options, fetchImpl = fetch) {
  return createGmailApiClient(options, fetchImpl);
}

export function createSupabaseRestFinancialDocumentRepository({ serviceRoleKey, supabaseUrl }, fetchImpl = fetch) {
  const baseUrl = supabaseUrl.replace(/\/$/, "");
  const headers = {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    "Content-Type": "application/json"
  };

  return {
    async hasFinancialDocument({ sourceMailbox, gmailMessageId }) {
      const url = new URL(`${baseUrl}/rest/v1/${FINANCIAL_DOCUMENT_TABLE}`);
      url.searchParams.set("select", "id");
      url.searchParams.set("source_mailbox", `eq.${sourceMailbox}`);
      url.searchParams.set("gmail_message_id", `eq.${gmailMessageId}`);
      url.searchParams.set("limit", "1");

      const response = await fetchImpl(url, { headers });
      if (!response.ok) {
        throw new Error(`Financial document lookup failed with HTTP ${response.status}.`);
      }

      const json = await response.json();
      return Array.isArray(json) && json.length > 0;
    },
    async listActiveRules({ organizationId, schoolId }) {
      const url = new URL(`${baseUrl}/rest/v1/${FINANCIAL_DOCUMENT_RULE_TABLE}`);
      url.searchParams.set("select", "*");
      url.searchParams.set("organization_id", `eq.${organizationId}`);
      url.searchParams.set("status", "eq.active");
      url.searchParams.set("or", `(school_id.is.null,school_id.eq.${schoolId})`);
      url.searchParams.set("order", "school_id.asc.nullsfirst,vendor.asc");

      const response = await fetchImpl(url, { headers });
      if (!response.ok) {
        throw new Error(`Financial document rules lookup failed with HTTP ${response.status}.`);
      }

      return response.json();
    },
    async insertFinancialDocument(row) {
      const response = await fetchImpl(`${baseUrl}/rest/v1/rpc/ingest_financial_document_mvp`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          p_organization_id: row.organizationId,
          p_school_id: row.schoolId,
          p_source: row.source,
          p_source_mailbox: row.sourceMailbox,
          p_gmail_message_id: row.gmailMessageId,
          p_gmail_thread_id: row.gmailThreadId,
          p_received_at: row.receivedAt,
          p_sender: row.sender,
          p_recipient: row.recipient,
          p_subject: row.subject,
          p_title: row.title,
          p_vendor: row.vendor,
          p_document_filename: row.documentFilename,
          p_document_mime_type: row.documentMimeType,
          p_document_file_path: row.documentFilePath,
          p_detected_amount: row.detectedAmount,
          p_detected_currency: row.detectedCurrency,
          p_category_id: row.categoryId,
          p_raw_body: row.rawBody,
          p_metadata: row.metadata
        })
      });

      if (!response.ok) {
        throw new Error(`Financial document insert failed with HTTP ${response.status}.`);
      }

      const json = await response.json();
      return { id: Array.isArray(json) ? json[0] : json, inserted: true };
    },
    async createExpenseFromDocument(input) {
      const response = await fetchImpl(`${baseUrl}/rest/v1/rpc/create_expense_from_financial_document_mvp`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          p_financial_document_id: input.documentId,
          p_school_id: input.schoolId,
          p_expense_date: input.expenseDate,
          p_category_id: input.categoryId,
          p_vendor: input.vendor,
          p_description: input.description,
          p_amount: input.amount,
          p_currency: input.currency,
          p_tax_amount: null,
          p_payment_method: input.paymentMethod || "bank_transfer",
          p_reference: input.documentId,
          p_receipt_reference: input.documentId,
          p_notes: "Auto-created from trusted financial document rule."
        })
      });

      if (!response.ok) {
        throw new Error(`Financial document auto-expense failed with HTTP ${response.status}.`);
      }

      const json = await response.json();
      return Array.isArray(json) ? json[0] : json;
    }
  };
}

export function extractFinancialGmailMessageMetadata(message) {
  const base = extractGmailMessageMetadata(message);
  const attachments = extractAttachmentMetadata(message?.payload);

  return {
    ...base,
    body: extractGmailMessageBody(message?.payload),
    attachments,
    attachmentFilenames: attachments.map((attachment) => attachment.filename).filter(Boolean)
  };
}

export function classifyFinancialEmail(metadata) {
  const ignoreReason = getFinancialEmailIgnoredReason(metadata);
  if (ignoreReason) {
    return { isFinancial: false, reason: ignoreReason, signals: [] };
  }

  const subject = metadata?.subject || "";
  const body = metadata?.body || "";
  const sender = metadata?.sender || "";
  const haystack = `${subject}\n${body}`;
  const signals = financialSignalPatterns.filter((signal) => signal.pattern.test(haystack)).map((signal) => signal.key);
  const subjectSignals = financialSignalPatterns.filter((signal) => signal.pattern.test(subject)).map((signal) => signal.key);
  const hasFinancialAttachment = (metadata?.attachments || []).some((attachment) =>
    financialAttachmentPattern.test(attachment.filename || attachment.mimeType || "")
  );
  const senderLooksFinancial = /billing|invoice|receipt|payment|payments|accounts?/i.test(sender);

  if (subjectSignals.length) {
    return {
      amount: detectFinancialAmount(haystack),
      currency: detectFinancialCurrency(haystack),
      isFinancial: true,
      reason: "subject_signal",
      signals
    };
  }

  if (signals.length && hasFinancialAttachment) {
    return {
      amount: detectFinancialAmount(haystack),
      currency: detectFinancialCurrency(haystack),
      isFinancial: true,
      reason: "body_signal_with_attachment",
      signals
    };
  }

  if (senderLooksFinancial && hasFinancialAttachment) {
    return {
      amount: detectFinancialAmount(haystack),
      currency: detectFinancialCurrency(haystack),
      isFinancial: true,
      reason: "financial_sender_with_attachment",
      signals: signals.length ? signals : ["sender"]
    };
  }

  return { isFinancial: false, reason: "no_conservative_financial_signal", signals };
}

export function getFinancialEmailIgnoredReason(metadata) {
  const subject = metadata?.subject || "";
  const sender = metadata?.sender || "";
  const labelIds = metadata?.labelIds || [];

  if (Array.isArray(labelIds) && labelIds.includes("SENT")) return "sent_message";
  if (Array.isArray(labelIds) && labelIds.length && !labelIds.includes("INBOX")) return "not_inbox";
  if (/^(re|fw|fwd)\s*:/i.test(String(subject).trim())) return "reply_or_forward";
  if (String(sender).toLowerCase().includes("calendar-notification@google.com")) return "google_calendar";
  if (isTrialBookingSubject(subject)) return "trial_booking_subject";
  return null;
}

export function findMatchingFinancialDocumentRule(rules = [], metadata = {}) {
  const sender = String(metadata.sender || "").toLowerCase();
  const subject = String(metadata.subject || "").toLowerCase();

  return (
    rules.find((rule) => {
      if (rule.status && rule.status !== "active") return false;
      if (rule.school_id && metadata.schoolId && rule.school_id !== metadata.schoolId) return false;

      const senderDomain = String(rule.sender_domain || "").trim().toLowerCase();
      const subjectContains = String(rule.subject_contains || "").trim().toLowerCase();
      const senderMatches = senderDomain ? sender.includes(senderDomain) : true;
      const subjectMatches = subjectContains ? subject.includes(subjectContains) : true;

      return senderMatches && subjectMatches;
    }) || null
  );
}

export function buildFinancialDocumentFromGmailMessage({ classification, config, metadata, rule = null }) {
  const primaryAttachment = metadata.attachments[0] || {};
  const detectedAmount = normalizeAmount(rule?.expected_amount ?? classification.amount);
  const detectedCurrency = String(rule?.currency || classification.currency || "JPY").toUpperCase();

  return {
    organizationId: config.organizationId,
    schoolId: rule?.school_id || config.schoolId,
    source: "gmail",
    sourceMailbox: config.sourceMailbox,
    gmailMessageId: metadata.id,
    gmailThreadId: metadata.threadId,
    receivedAt: metadata.receivedAt,
    sender: metadata.sender,
    recipient: metadata.recipient,
    subject: metadata.subject,
    title: metadata.subject || primaryAttachment.filename || "Financial document",
    vendor: rule?.vendor || extractSenderDisplayName(metadata.sender),
    documentFilename: primaryAttachment.filename || "",
    documentMimeType: primaryAttachment.mimeType || "",
    documentFilePath: "",
    detectedAmount,
    detectedCurrency,
    categoryId: rule?.category_id || null,
    rawBody: metadata.body,
    processingMode: rule?.processing_mode || "manual_review",
    metadata: {
      attachment_filenames: metadata.attachmentFilenames || [],
      classification_reason: classification.reason,
      processing_mode: rule?.processing_mode || "manual_review",
      rule_id: rule?.id || null,
      signals: classification.signals || []
    }
  };
}

function shouldAutoCreateExpense(row, rule) {
  return (
    rule?.processing_mode === "auto_expense" &&
    Boolean(row.categoryId) &&
    Number.isFinite(Number(row.detectedAmount)) &&
    Number(row.detectedAmount) > 0
  );
}

function extractAttachmentMetadata(part, results = []) {
  if (!part) return results;
  if (part.filename || part.body?.attachmentId) {
    results.push({
      attachmentId: part.body?.attachmentId || "",
      filename: part.filename || "",
      mimeType: part.mimeType || ""
    });
  }

  for (const child of part.parts || []) {
    extractAttachmentMetadata(child, results);
  }

  return results;
}

function detectFinancialAmount(value) {
  const text = String(value || "");
  const match =
    text.match(/(?:JPY|YEN)\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/i) ||
    text.match(/(?:\u00a5|\\)\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/);
  if (!match) return null;

  const amount = Number(match[1].replaceAll(",", ""));
  return Number.isFinite(amount) ? String(amount) : null;
}

function detectFinancialCurrency(value) {
  const text = String(value || "");
  if (/(?:JPY|YEN|\u00a5|\\)/i.test(text)) return "JPY";
  if (/\bUSD\b|\$/i.test(text)) return "USD";
  return "JPY";
}

function normalizeAmount(value) {
  if (value === null || value === undefined || value === "") return null;
  const amount = Number(String(value).replaceAll(",", ""));
  return Number.isFinite(amount) ? String(amount) : null;
}

function extractSenderDisplayName(sender) {
  const value = String(sender || "").trim();
  const match = value.match(/^"?([^"<]+)"?\s*</);
  return (match?.[1] || value.split("@")[0] || "").trim();
}

function normalizeMaxResults(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) return DEFAULT_MAX_RESULTS;
  return Math.min(parsed, MAX_ALLOWED_RESULTS);
}

function normalizeNullableString(value) {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim();
  return normalized ? normalized : null;
}

function readEnv(getEnv, name) {
  return typeof getEnv === "function" ? getEnv(name) : null;
}

function getErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
