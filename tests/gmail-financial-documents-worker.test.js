import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  buildFinancialDocumentFromGmailMessage,
  buildGmailFinancialDocumentSearchQuery,
  classifyFinancialEmail,
  extractFinancialGmailMessageMetadata,
  findMatchingFinancialDocumentRule,
  pollGmailFinancialDocuments,
  readGmailFinancialDocumentWorkerConfig
} from "../lib/gmail-financial-documents-worker.js";

const financialWorkerSource = readFileSync(
  new URL("../lib/gmail-financial-documents-worker.js", import.meta.url),
  "utf8"
);
const financialEdgeFunctionSource = readFileSync(
  new URL("../supabase/functions/gmail-financial-documents-poll/index.ts", import.meta.url),
  "utf8"
);
const trialBookingWorkerSource = readFileSync(new URL("../lib/gmail-trial-booking-worker.js", import.meta.url), "utf8");
const trialBookingEdgeFunctionSource = readFileSync(
  new URL("../supabase/functions/gmail-trial-booking-poll/index.ts", import.meta.url),
  "utf8"
);

const config = {
  sourceMailbox: "bee.school.fukuoka@gmail.com",
  organizationId: "11111111-1111-4111-8111-111111111111",
  schoolId: "22222222-2222-4222-8222-222222222222",
  importAfter: "2026-09-01",
  maxResults: 10
};

test("financial Gmail query is separate and uses a safe cutoff", () => {
  const query = buildGmailFinancialDocumentSearchQuery({ importAfter: "2026-09-01" });

  assert.equal(
    query,
    'in:inbox -in:sent -from:calendar-notification@google.com -subject:"Re:" -subject:"Fwd:" (invoice OR receipt OR billing OR bill OR payment OR statement) after:2026/09/01'
  );
  assert.doesNotMatch(financialEdgeFunctionSource, /pollGmailTrialBookings|pending_trial_booking_imports/);
  assert.doesNotMatch(trialBookingWorkerSource, /financial_documents|gmail-financial/i);
  assert.doesNotMatch(trialBookingEdgeFunctionSource, /gmail-financial|FinancialDocument/i);
});

test("financial worker config reuses existing Gmail credentials with its own cutoff", () => {
  const result = readGmailFinancialDocumentWorkerConfig((name) =>
    ({
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "service-role",
      GMAIL_CLIENT_ID: "client-id",
      GMAIL_CLIENT_SECRET: "client-secret",
      GMAIL_REFRESH_TOKEN: "refresh-token",
      GMAIL_SOURCE_MAILBOX: config.sourceMailbox,
      GMAIL_TENANT_ORGANIZATION_ID: config.organizationId,
      GMAIL_TENANT_SCHOOL_ID: config.schoolId,
      GMAIL_FINANCIAL_IMPORT_AFTER: "2026/09/01",
      GMAIL_FINANCIAL_POLL_MAX_RESULTS: "25"
    })[name]
  );

  assert.deepEqual(result.errors, []);
  assert.equal(result.config.importAfter, "2026-09-01");
  assert.equal(result.config.maxResults, 25);
});

test("invoice email creates a Financial Doc to Check row", async () => {
  const repository = createMemoryFinancialDocumentRepository();
  const result = await pollGmailFinancialDocuments({
    config,
    financialDocumentRepository: repository,
    gmailClient: createFakeGmailClient([
      gmailMessage({
        id: "invoice-1",
        subject: "Microsoft invoice September",
        body: "Invoice total JPY 12345",
        filename: "microsoft-invoice.pdf"
      })
    ]),
    logger: quietLogger()
  });

  assert.equal(result.inserted, 1);
  assert.equal(repository.rows.length, 1);
  assert.equal(repository.rows[0].gmailMessageId, "invoice-1");
  assert.equal(repository.rows[0].detectedAmount, "12345");
  assert.equal(repository.rows[0].detectedCurrency, "JPY");
  assert.equal(repository.rows[0].processingMode, "manual_review");
});

test("non-financial email and Trial Booking email are ignored", async () => {
  const repository = createMemoryFinancialDocumentRepository();
  const result = await pollGmailFinancialDocuments({
    config,
    financialDocumentRepository: repository,
    gmailClient: createFakeGmailClient([
      gmailMessage({ id: "message-1", from: "Parent <parent@example.com>", subject: "Website inquiry", body: "Hello", filename: "" }),
      gmailMessage({ id: "message-2", subject: "New Trial Booking", body: "Student name: Example" })
    ]),
    logger: quietLogger()
  });

  assert.equal(result.ignored, 2);
  assert.deepEqual(
    result.outcomes.map((outcome) => outcome.reason),
    ["no_conservative_financial_signal", "trial_booking_subject"]
  );
  assert.equal(repository.rows.length, 0);
});

test("duplicate Gmail financial document is inserted once", async () => {
  const repository = createMemoryFinancialDocumentRepository();
  const gmailClient = createFakeGmailClient([
    gmailMessage({
      id: "invoice-duplicate",
      subject: "YouTube billing receipt",
      body: "Receipt total JPY 2500",
      filename: "youtube-receipt.pdf"
    })
  ]);

  const first = await pollGmailFinancialDocuments({ config, financialDocumentRepository: repository, gmailClient, logger: quietLogger() });
  const second = await pollGmailFinancialDocuments({ config, financialDocumentRepository: repository, gmailClient, logger: quietLogger() });

  assert.equal(first.inserted, 1);
  assert.equal(second.inserted, 0);
  assert.equal(second.skippedDuplicates, 1);
  assert.equal(repository.rows.length, 1);
});

test("trusted auto-expense rule links the source document to an expense", async () => {
  const repository = createMemoryFinancialDocumentRepository({
    rules: [
      {
        id: "rule-1",
        category_id: "category-1",
        currency: "JPY",
        processing_mode: "auto_expense",
        sender_domain: "microsoft.com",
        vendor: "Microsoft"
      }
    ]
  });
  const result = await pollGmailFinancialDocuments({
    config,
    financialDocumentRepository: repository,
    gmailClient: createFakeGmailClient([
      gmailMessage({
        id: "invoice-auto",
        from: "Microsoft Billing <billing@microsoft.com>",
        subject: "Microsoft invoice",
        body: "Invoice total JPY 12345",
        filename: "invoice.pdf"
      })
    ]),
    logger: quietLogger()
  });

  assert.equal(result.inserted, 1);
  assert.equal(result.autoCreatedExpenses, 1);
  assert.equal(repository.expenses.length, 1);
  assert.equal(repository.expenses[0].documentId, "financial-doc-1");
  assert.equal(repository.expenses[0].categoryId, "category-1");
});

test("financial email detection is conservative and uses sender, subject, body, and attachment signals", () => {
  const invoice = extractFinancialGmailMessageMetadata(
    gmailMessage({
      id: "detect-1",
      subject: "Invoice",
      body: "Total JPY 1000",
      filename: "invoice.pdf"
    })
  );
  const newsletter = extractFinancialGmailMessageMetadata(
    gmailMessage({
      id: "detect-2",
      subject: "September news",
      body: "Payment tips for families",
      filename: ""
    })
  );

  assert.equal(classifyFinancialEmail(invoice).isFinancial, true);
  assert.equal(classifyFinancialEmail(newsletter).isFinancial, false);

  const rule = findMatchingFinancialDocumentRule(
    [{ id: "rule-1", sender_domain: "example.com", subject_contains: "receipt", status: "active" }],
    { sender: "Billing <billing@example.com>", subject: "Receipt for payment" }
  );
  assert.equal(rule.id, "rule-1");

  const row = buildFinancialDocumentFromGmailMessage({
    classification: classifyFinancialEmail(invoice),
    config,
    metadata: invoice,
    rule: { category_id: "category-1", currency: "JPY", processing_mode: "manual_review", vendor: "Vendor" }
  });
  assert.equal(row.categoryId, "category-1");
  assert.equal(row.metadata.attachment_filenames[0], "invoice.pdf");
});

test("financial Gmail worker does not send email or use Resend directly", () => {
  assert.doesNotMatch(financialWorkerSource, /createResendSenderClient|RESEND_API_KEY|BEE_SCHOOL_RESEND_API_KEY/);
  assert.match(financialWorkerSource, /ingest_financial_document_mvp/);
  assert.match(financialWorkerSource, /create_expense_from_financial_document_mvp/);
  assert.match(financialEdgeFunctionSource, /GMAIL_FINANCIAL_POLL_CRON_SECRET/);
});

function createFakeGmailClient(messages) {
  const messageMap = new Map(messages.map((message) => [message.id, message]));

  return {
    async listMessages() {
      return messages.map((message) => ({ id: message.id }));
    },
    async getMessage(id) {
      return messageMap.get(id);
    }
  };
}

function createMemoryFinancialDocumentRepository({ rules = [] } = {}) {
  const rowsByKey = new Map();
  const expenses = [];

  return {
    expenses,
    get rows() {
      return [...rowsByKey.values()];
    },
    async hasFinancialDocument({ sourceMailbox, gmailMessageId }) {
      return rowsByKey.has(`${sourceMailbox}::${gmailMessageId}`);
    },
    async listActiveRules() {
      return rules;
    },
    async insertFinancialDocument(row) {
      const key = `${row.sourceMailbox}::${row.gmailMessageId}`;
      if (rowsByKey.has(key)) {
        return { id: rowsByKey.get(key).id, inserted: false };
      }

      const saved = { ...row, id: `financial-doc-${rowsByKey.size + 1}` };
      rowsByKey.set(key, saved);
      return { id: saved.id, inserted: true };
    },
    async createExpenseFromDocument(input) {
      expenses.push(input);
      return `expense-${expenses.length}`;
    }
  };
}

function gmailMessage({
  id,
  threadId = "thread-1",
  subject,
  from = "Billing <billing@example.com>",
  to = config.sourceMailbox,
  body = "",
  filename = "document.pdf",
  labelIds = ["INBOX"],
  internalDate = "1789275600000"
}) {
  const parts = [];
  if (body) parts.push({ mimeType: "text/plain", body: { data: encodeBase64Url(body) } });
  if (filename) {
    parts.push({
      body: { attachmentId: `${id}-attachment` },
      filename,
      mimeType: filename.endsWith(".pdf") ? "application/pdf" : "application/octet-stream"
    });
  }

  return {
    id,
    threadId,
    labelIds,
    internalDate,
    payload: {
      mimeType: parts.length > 1 ? "multipart/mixed" : parts[0]?.mimeType || "text/plain",
      headers: [
        { name: "From", value: from },
        { name: "To", value: to },
        { name: "Subject", value: subject }
      ],
      body: parts.length === 1 && parts[0].mimeType === "text/plain" ? parts[0].body : {},
      parts: parts.length > 1 ? parts : []
    }
  };
}

function encodeBase64Url(value) {
  return Buffer.from(value, "utf8").toString("base64").replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function quietLogger() {
  return {
    error() {}
  };
}
