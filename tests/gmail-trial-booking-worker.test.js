import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  buildGmailTrialBookingSearchQuery,
  decodeGmailBodyData,
  extractGmailMessageBody,
  pollGmailTrialBookings,
  readGmailTrialBookingWorkerConfig
} from "../lib/gmail-trial-booking-worker.js";

const workerSource = readFileSync(new URL("../lib/gmail-trial-booking-worker.js", import.meta.url), "utf8");
const edgeFunctionSource = readFileSync(
  new URL("../supabase/functions/gmail-trial-booking-poll/index.ts", import.meta.url),
  "utf8"
);

const config = {
  sourceMailbox: "bee.school.fukuoka@gmail.com",
  organizationId: "11111111-1111-4111-8111-111111111111",
  schoolId: "22222222-2222-4222-8222-222222222222",
  importAfter: "2026-08-01",
  maxResults: 10
};

const knownBody = `BOOKING SOURCE: KIDS CAMPAIGN
TRIAL TYPE: FREE
Student name: Example Student
Email: example@example.com
Phone: 09000000000
Student age: 7
Course: 小学生英会話
Lesson type: グループレッスン
First preferred date: 2026-08-19`;

test("Gmail query targets incoming Trial Booking messages with a safe cutoff", () => {
  const query = buildGmailTrialBookingSearchQuery({ importAfter: "2026-08-01" });

  assert.equal(
    query,
    'in:inbox -in:sent -from:calendar-notification@google.com -subject:"Re:" -subject:"Fwd:" subject:"Trial Booking" after:2026/08/01'
  );
});

test("worker config requires server-side Gmail, Supabase, tenant, and cutoff secrets", () => {
  const values = {
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service-role",
    GMAIL_CLIENT_ID: "client-id",
    GMAIL_CLIENT_SECRET: "client-secret",
    GMAIL_REFRESH_TOKEN: "refresh-token",
    GMAIL_SOURCE_MAILBOX: config.sourceMailbox,
    GMAIL_TENANT_ORGANIZATION_ID: config.organizationId,
    GMAIL_TENANT_SCHOOL_ID: config.schoolId,
    GMAIL_IMPORT_AFTER: "2026/08/01",
    GMAIL_POLL_MAX_RESULTS: "25"
  };
  const result = readGmailTrialBookingWorkerConfig((name) => values[name]);

  assert.deepEqual(result.errors, []);
  assert.equal(result.config.importAfter, "2026-08-01");
  assert.equal(result.config.maxResults, 25);
});

test("matching incoming Trial Booking message creates one pending row", async () => {
  const repository = createMemoryRepository();
  const result = await pollGmailTrialBookings({
    config,
    pendingImportRepository: repository,
    gmailClient: createFakeGmailClient([
      gmailMessage({ id: "message-1", subject: "[ADS KIDS - FREE TRIAL] New Trial Booking", body: knownBody })
    ]),
    logger: quietLogger()
  });

  assert.equal(result.ok, true);
  assert.equal(result.inserted, 1);
  assert.equal(repository.rows.length, 1);
  assert.equal(repository.rows[0].gmail_message_id, "message-1");
  assert.equal(repository.rows[0].student_name, "Example Student");
  assert.equal(repository.rows[0].course, "小学生英会話");
  assert.equal(repository.rows[0].lesson_type, "グループレッスン");
});

test("unrelated email is ignored even if returned by Gmail", async () => {
  const repository = createMemoryRepository();
  const result = await pollGmailTrialBookings({
    config,
    pendingImportRepository: repository,
    gmailClient: createFakeGmailClient([gmailMessage({ id: "message-2", subject: "Website inquiry", body: knownBody })]),
    logger: quietLogger()
  });

  assert.equal(result.ignored, 1);
  assert.equal(result.outcomes[0].reason, "subject_not_trial_booking");
  assert.equal(repository.rows.length, 0);
});

test("Google Calendar notification is ignored", async () => {
  const repository = createMemoryRepository();
  const result = await pollGmailTrialBookings({
    config,
    pendingImportRepository: repository,
    gmailClient: createFakeGmailClient([
      gmailMessage({
        id: "message-3",
        subject: "Trial Booking reminder",
        from: "Google Calendar <calendar-notification@google.com>",
        body: knownBody
      })
    ]),
    logger: quietLogger()
  });

  assert.equal(result.ignored, 1);
  assert.equal(result.outcomes[0].reason, "google_calendar");
  assert.equal(repository.rows.length, 0);
});

test("same Gmail message seen twice creates one pending row", async () => {
  const repository = createMemoryRepository();
  const gmailClient = createFakeGmailClient([
    gmailMessage({ id: "message-4", subject: "New Trial Booking", body: knownBody })
  ]);

  const first = await pollGmailTrialBookings({ config, pendingImportRepository: repository, gmailClient, logger: quietLogger() });
  const second = await pollGmailTrialBookings({ config, pendingImportRepository: repository, gmailClient, logger: quietLogger() });

  assert.equal(first.inserted, 1);
  assert.equal(second.inserted, 0);
  assert.equal(second.skippedDuplicates, 1);
  assert.equal(repository.rows.length, 1);
});

test("two different messages in the same Gmail thread create two pending rows", async () => {
  const repository = createMemoryRepository();
  const result = await pollGmailTrialBookings({
    config,
    pendingImportRepository: repository,
    gmailClient: createFakeGmailClient([
      gmailMessage({ id: "message-5a", threadId: "shared-thread", subject: "New Trial Booking", body: knownBody }),
      gmailMessage({ id: "message-5b", threadId: "shared-thread", subject: "Another Trial Booking", body: knownBody })
    ]),
    logger: quietLogger()
  });

  assert.equal(result.inserted, 2);
  assert.deepEqual(
    repository.rows.map((row) => row.gmail_message_id),
    ["message-5a", "message-5b"]
  );
  assert.deepEqual(
    repository.rows.map((row) => row.gmail_thread_id),
    ["shared-thread", "shared-thread"]
  );
});

test("malformed Trial Booking body creates a pending row with parse error", async () => {
  const repository = createMemoryRepository();
  const result = await pollGmailTrialBookings({
    config,
    pendingImportRepository: repository,
    gmailClient: createFakeGmailClient([
      gmailMessage({
        id: "message-6",
        subject: "Malformed Trial Booking",
        body: "Email: example@example.com"
      })
    ]),
    logger: quietLogger()
  });

  assert.equal(result.inserted, 1);
  assert.equal(result.parseErrors, 1);
  assert.equal(repository.rows[0].parse_status, "parse_error");
  assert.match(repository.rows[0].parse_error, /Student name is required/);
});

test("HTML-only Gmail body falls back to safe text extraction", async () => {
  const html = `<html><body>
    <p>BOOKING SOURCE: KIDS CAMPAIGN</p>
    <p>TRIAL TYPE: FREE</p>
    <p>Student name: HTML Student</p>
    <p>Email: html@example.com</p>
    <p>Course: 小学生英会話</p>
    <p>Lesson type: グループレッスン</p>
    <p>First preferred date: 2026-08-19</p>
  </body></html>`;
  const repository = createMemoryRepository();
  const result = await pollGmailTrialBookings({
    config,
    pendingImportRepository: repository,
    gmailClient: createFakeGmailClient([
      gmailMessage({ id: "message-7", subject: "HTML Trial Booking", html, body: "" })
    ]),
    logger: quietLogger()
  });

  assert.equal(result.inserted, 1);
  assert.equal(repository.rows[0].student_name, "HTML Student");
  assert.equal(repository.rows[0].course, "小学生英会話");
  assert.equal(repository.rows[0].lesson_type, "グループレッスン");
  assert.match(repository.rows[0].raw_body, /BOOKING SOURCE: KIDS CAMPAIGN/);
  assert.match(repository.rows[0].raw_body, /Course: 小学生英会話/);
});

test("Gmail API transient list failure is reported without inserting rows", async () => {
  const repository = createMemoryRepository();
  const result = await pollGmailTrialBookings({
    config,
    pendingImportRepository: repository,
    gmailClient: {
      async listMessages() {
        throw new Error("Gmail unavailable");
      }
    },
    logger: quietLogger()
  });

  assert.equal(result.ok, false);
  assert.equal(result.errors[0].stage, "list");
  assert.equal(repository.rows.length, 0);
});

test("one bad Gmail message does not block later messages", async () => {
  const repository = createMemoryRepository();
  const result = await pollGmailTrialBookings({
    config,
    pendingImportRepository: repository,
    gmailClient: createFakeGmailClient(
      [gmailMessage({ id: "message-9b", subject: "Good Trial Booking", body: knownBody })],
      { ids: ["message-9a", "message-9b"], failGetIds: new Set(["message-9a"]) }
    ),
    logger: quietLogger()
  });

  assert.equal(result.ok, true);
  assert.equal(result.errors.length, 1);
  assert.equal(result.inserted, 1);
  assert.equal(repository.rows[0].gmail_message_id, "message-9b");
});

test("worker does not call live Trial Lesson creation paths", () => {
  assert.doesNotMatch(workerSource, /create_trial_lesson_mvp/);
  assert.doesNotMatch(edgeFunctionSource, /create_trial_lesson_mvp/);
  assert.doesNotMatch(workerSource, /from\("trial_lessons"\)/);
});

test("extractGmailMessageBody prefers plain text over HTML", () => {
  const body = extractGmailMessageBody({
    mimeType: "multipart/alternative",
    parts: [
      { mimeType: "text/html", body: { data: encodeBase64Url("<p>HTML</p>") } },
      { mimeType: "text/plain", body: { data: encodeBase64Url("Plain text") } }
    ]
  });

  assert.equal(body, "Plain text");
});

test("Gmail body decoding preserves UTF-8 Japanese bytes exactly", () => {
  const value = "Course: 小学生英会話\nLesson type: グループレッスン";
  const data = encodeBase64Url(value);

  assert.equal(decodeGmailBodyData(data), value);
});

function createFakeGmailClient(messages, options = {}) {
  const messageMap = new Map(messages.map((message) => [message.id, message]));
  const ids = options.ids || messages.map((message) => message.id);
  const failGetIds = options.failGetIds || new Set();

  return {
    async listMessages() {
      return ids.map((id) => ({ id }));
    },
    async getMessage(id) {
      if (failGetIds.has(id)) {
        throw new Error(`Fetch failed for ${id}`);
      }
      return messageMap.get(id);
    }
  };
}

function createMemoryRepository() {
  const rowsByKey = new Map();

  return {
    get rows() {
      return [...rowsByKey.values()];
    },
    async hasPendingImport({ sourceMailbox, gmailMessageId }) {
      return rowsByKey.has(`${sourceMailbox}::${gmailMessageId}`);
    },
    async insertPendingImport(row) {
      const key = `${row.source_mailbox}::${row.gmail_message_id}`;
      if (rowsByKey.has(key)) {
        return { inserted: false, data: [] };
      }
      rowsByKey.set(key, row);
      return { inserted: true, data: [{ id: `pending-${rowsByKey.size}` }] };
    }
  };
}

function gmailMessage({
  id,
  threadId = "thread-1",
  subject,
  from = "Bee Website <bookings@example.com>",
  to = config.sourceMailbox,
  body = knownBody,
  html = "",
  labelIds = ["INBOX"],
  internalDate = "1787115600000"
}) {
  const parts = [];
  if (body) parts.push({ mimeType: "text/plain", body: { data: encodeBase64Url(body) } });
  if (html) parts.push({ mimeType: "text/html", body: { data: encodeBase64Url(html) } });

  return {
    id,
    threadId,
    labelIds,
    internalDate,
    payload: {
      mimeType: parts.length > 1 ? "multipart/alternative" : parts[0]?.mimeType || "text/plain",
      headers: [
        { name: "From", value: from },
        { name: "To", value: to },
        { name: "Subject", value: subject }
      ],
      body: parts.length === 1 ? parts[0].body : {},
      parts: parts.length > 1 ? parts : []
    }
  };
}

function encodeBase64Url(value) {
  return Buffer.from(value, "utf8").toString("base64").replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function quietLogger() {
  return {
    info() {},
    error() {}
  };
}
