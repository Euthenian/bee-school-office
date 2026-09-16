import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  createExpenseFromFinancialDocument,
  createFinancialDocumentRule,
  createOfficeTodo,
  createOfficeTodoForFinancialDocument,
  fetchFinancialDocumentBadgeCount,
  fetchOfficeTodoBadgeCount,
  generateRecurringExpenses,
  markFinancialDocumentRead,
  markOfficeTodoCompleted
} from "../lib/data.js";
import {
  buildFinancialDocumentRuleInsert,
  countUnreadPendingFinancialDocuments,
  validateFinancialDocumentRuleForm
} from "../lib/financial-documents.js";
import { formatCountBadgeValue } from "../lib/navigation-badges.js";
import { buildOfficeTodoInsert, countOutstandingOfficeTodos, validateOfficeTodoForm } from "../lib/office-todos.js";
import {
  createRecurringExpenseTemplateForm,
  getMonthStartDate,
  validateRecurringExpenseTemplateForm
} from "../lib/recurring-expenses.js";

const workflowSql = readFileSync(
  new URL("../supabase/migrations/20260915001000_expenses_financial_documents_workflow.sql", import.meta.url),
  "utf8"
);
const ingestionServiceRoleOnlySql = readFileSync(
  new URL("../supabase/migrations/20260916001000_financial_document_ingestion_service_role_only.sql", import.meta.url),
  "utf8"
);
const dataSource = readFileSync(new URL("../lib/data.js", import.meta.url), "utf8");
const adminShell = readFileSync(new URL("../components/AdminShell.js", import.meta.url), "utf8");
const financialDocumentsPage = readFileSync(
  new URL("../app/(app)/expenses/financial-docs/page.js", import.meta.url),
  "utf8"
);
const financialDocumentReviewPage = readFileSync(
  new URL("../app/(app)/expenses/financial-docs/review/page.js", import.meta.url),
  "utf8"
);
const todoPage = readFileSync(new URL("../app/(app)/todo/page.js", import.meta.url), "utf8");
const recurringPage = readFileSync(new URL("../app/(app)/expenses/recurring/page.js", import.meta.url), "utf8");

test("recurring expense migration creates monthly templates and idempotent generated expenses", async () => {
  assert.match(workflowSql, /create table if not exists public\.recurring_expense_templates/);
  assert.match(workflowSql, /recurrence in \('one_time', 'monthly'\)/);
  assert.match(workflowSql, /add column if not exists recurring_template_id uuid/);
  assert.match(workflowSql, /add column if not exists recurring_period_start date/);
  assert.match(workflowSql, /create unique index if not exists expenses_recurring_template_period_uidx/);
  assert.match(workflowSql, /create or replace function public\.generate_recurring_expenses_mvp/);
  assert.match(workflowSql, /ret\.recurrence = 'monthly'/);
  assert.match(workflowSql, /on conflict \(recurring_template_id, recurring_period_start\) do nothing/);
  assert.doesNotMatch(workflowSql, /ret\.recurrence = 'one_time'[\s\S]*insert into public\.expenses/);
  assert.match(recurringPage, /generateRecurringExpenses/);

  const form = createRecurringExpenseTemplateForm({
    amount: 12000,
    category_id: "category-1",
    name: "Microsoft 365",
    recurrence: "monthly",
    school_id: "school-1",
    start_date: "2026-09-01"
  });
  assert.equal(validateRecurringExpenseTemplateForm(form), "");
  assert.equal(validateRecurringExpenseTemplateForm({ ...form, endDate: "2026-08-31" }), "End date cannot be before start date.");
  assert.equal(getMonthStartDate("2026-09-15T10:00:00Z"), "2026-09-01");

  const calls = [];
  const result = await generateRecurringExpenses(
    {
      rpc(name, args) {
        calls.push([name, args]);
        return Promise.resolve({ data: [{ generation_status: "generated" }], error: null });
      }
    },
    "2026-09-01"
  );

  assert.equal(result.data[0].generation_status, "generated");
  assert.deepEqual(calls, [["generate_recurring_expenses_mvp", { p_target_month: "2026-09-01" }]]);
});

test("financial documents preserve source rows and support read, dismiss, and conversion actions", async () => {
  assert.match(workflowSql, /create table if not exists public\.financial_documents/);
  assert.match(workflowSql, /status in \('pending', 'converted_to_expense', 'dismissed'\)/);
  assert.match(workflowSql, /\bis_read boolean not null default false/);
  assert.match(workflowSql, /\blinked_expense_id uuid/);
  assert.match(workflowSql, /\braw_body text/);
  assert.match(workflowSql, /add column if not exists financial_document_id uuid/);
  assert.match(workflowSql, /source_type in \('manual', 'recurring_template', 'financial_document'\)/);
  assert.match(workflowSql, /create or replace function public\.create_expense_from_financial_document_mvp/);
  assert.match(workflowSql, /status = 'converted_to_expense'/);
  assert.doesNotMatch(workflowSql, /delete from public\.financial_documents/i);
  assert.match(financialDocumentsPage, /Mark read/);
  assert.match(financialDocumentsPage, /Create To Do/);
  assert.match(financialDocumentsPage, /Dismiss/);
  assert.match(financialDocumentReviewPage, /ExpenseForm/);
  assert.match(financialDocumentReviewPage, /Source text/);

  assert.equal(
    countUnreadPendingFinancialDocuments([
      { status: "pending", is_read: false },
      { status: "pending", is_read: true },
      { status: "dismissed", is_read: false }
    ]),
    1
  );

  const rpcCalls = [];
  const supabase = {
    rpc(name, args) {
      rpcCalls.push([name, args]);
      return Promise.resolve({ data: "ok", error: null });
    }
  };

  await markFinancialDocumentRead(supabase, "doc-1");
  await createExpenseFromFinancialDocument(supabase, "doc-1", {
    amount: "12000",
    categoryId: "category-1",
    currency: "JPY",
    description: "Microsoft invoice",
    expenseDate: "2026-09-12",
    paymentMethod: "bank_transfer",
    schoolId: "school-1",
    vendor: "Microsoft"
  });

  assert.deepEqual(rpcCalls.map((call) => call[0]), [
    "mark_financial_document_read_mvp",
    "create_expense_from_financial_document_mvp"
  ]);
});

test("navigation badges count financial documents and To Do items from real data", async () => {
  assert.equal(formatCountBadgeValue(0), "");
  assert.equal(formatCountBadgeValue(2), "2");
  assert.match(adminShell, /fetchFinancialDocumentBadgeCount/);
  assert.match(adminShell, /fetchOfficeTodoBadgeCount/);
  assert.match(adminShell, /item\.href === "\/expenses\/financial-docs\/"/);
  assert.match(adminShell, /item\.href === "\/todo\/"/);
  assert.match(adminShell, /className="nav-count-badge"/);

  const financial = createCountRecorder(2);
  await fetchFinancialDocumentBadgeCount(financial.supabase);
  assert.deepEqual(financial.calls, [
    ["from", "financial_documents"],
    ["select", "id", { count: "exact", head: true }],
    ["eq", "status", "pending"],
    ["eq", "is_read", false]
  ]);

  const todos = createCountRecorder(3);
  await fetchOfficeTodoBadgeCount(todos.supabase);
  assert.deepEqual(todos.calls, [
    ["from", "office_todo_items"],
    ["select", "id", { count: "exact", head: true }],
    ["eq", "status", "open"]
  ]);
});

test("office To Do model handles manual tasks and financial document tasks", async () => {
  assert.match(workflowSql, /create table if not exists public\.office_todo_items/);
  assert.match(workflowSql, /source_type in \('manual', 'financial_document'\)/);
  assert.match(workflowSql, /create unique index if not exists office_todo_items_source_reference_uidx/);
  assert.match(workflowSql, /create or replace function public\.create_office_todo_for_financial_document_mvp/);
  assert.match(workflowSql, /create or replace function public\.mark_office_todo_completed_mvp/);
  assert.match(todoPage, /markOfficeTodoCompleted/);
  assert.match(todoPage, /status === "open"/);

  assert.equal(
    countOutstandingOfficeTodos([
      { status: "open" },
      { status: "completed" }
    ]),
    1
  );
  assert.equal(validateOfficeTodoForm({ organizationId: "org-1", schoolId: "school-1", title: "Check invoice" }), "");
  assert.deepEqual(buildOfficeTodoInsert({ organizationId: "org-1", schoolId: "school-1", title: "  Check invoice  " }), {
    assignedProfileId: "",
    description: "",
    dueDate: "",
    organizationId: "org-1",
    schoolId: "school-1",
    sourceReference: "",
    sourceType: "manual",
    title: "Check invoice"
  });

  const rpcCalls = [];
  const supabase = {
    rpc(name, args) {
      rpcCalls.push([name, args]);
      return Promise.resolve({ data: "todo-1", error: null });
    }
  };

  await createOfficeTodo(supabase, { organizationId: "org-1", schoolId: "school-1", title: "Check invoice" });
  await createOfficeTodoForFinancialDocument(supabase, "doc-1");
  await markOfficeTodoCompleted(supabase, "todo-1");

  assert.deepEqual(rpcCalls.map((call) => call[0]), [
    "create_office_todo_mvp",
    "create_office_todo_for_financial_document_mvp",
    "mark_office_todo_completed_mvp"
  ]);
});

test("notifications are queued through existing Resend communication actions idempotently", () => {
  assert.match(workflowSql, /create or replace function public\.queue_financial_document_notification_mvp/);
  assert.match(workflowSql, /create or replace function public\.queue_office_todo_notification_mvp/);
  assert.match(workflowSql, /create or replace function public\.queue_office_notification_email/);
  assert.match(workflowSql, /from public\.get_office_notification_recipients/);
  assert.match(workflowSql, /'resend'/);
  assert.match(workflowSql, /'send_email'/);
  assert.match(workflowSql, /financial_document:' \|\| v_document\.id::text \|\| ':recipient:'/);
  assert.match(workflowSql, /office_todo:' \|\| v_todo\.id::text \|\| ':recipient:'/);
  assert.match(workflowSql, /on conflict \(idempotency_key\) do update/);
  assert.doesNotMatch(financialDocumentsPage, /createResendSenderClient|RESEND_API_KEY|BEE_SCHOOL_RESEND_API_KEY/);
  assert.doesNotMatch(todoPage, /createResendSenderClient|RESEND_API_KEY|BEE_SCHOOL_RESEND_API_KEY/);
});

test("trusted vendor rules support manual review and auto expense modes", async () => {
  assert.match(workflowSql, /create table if not exists public\.financial_document_rules/);
  assert.match(workflowSql, /processing_mode in \('manual_review', 'auto_expense'\)/);
  assert.match(financialDocumentsPage, /Trusted Vendor Rules/);
  assert.equal(
    validateFinancialDocumentRuleForm({
      categoryId: "category-1",
      currency: "JPY",
      organizationId: "org-1",
      processingMode: "auto_expense",
      senderDomain: "microsoft.com",
      vendor: "Microsoft"
    }),
    ""
  );

  const row = buildFinancialDocumentRuleInsert({
    categoryId: "category-1",
    currency: "jpy",
    organizationId: "org-1",
    processingMode: "manual_review",
    senderDomain: " billing.example.com ",
    vendor: " Microsoft "
  });
  assert.equal(row.currency, "JPY");
  assert.equal(row.sender_domain, "billing.example.com");
  assert.equal(row.vendor, "Microsoft");

  const recorder = createInsertRecorder({ id: "rule-1" });
  const result = await createFinancialDocumentRule(recorder.supabase, {
    categoryId: "category-1",
    currency: "JPY",
    organizationId: "org-1",
    processingMode: "manual_review",
    senderDomain: "example.com",
    vendor: "Example"
  });
  assert.equal(result.data.id, "rule-1");
  assert.equal(recorder.calls[0][1], "financial_document_rules");
});

test("authorization and document security stay private", () => {
  for (const table of [
    "recurring_expense_templates",
    "financial_documents",
    "financial_document_rules",
    "office_todo_items"
  ]) {
    assert.match(workflowSql, new RegExp(`alter table public\\.${table} enable row level security`));
    assert.match(workflowSql, new RegExp(`revoke all on public\\.${table} from anon, authenticated`));
  }

  assert.match(workflowSql, /public\.can_manage_expenses_org\(organization_id\)/);
  assert.match(workflowSql, /public\.can_manage_school\(school_id\)/);
  assert.match(workflowSql, /public\.is_service_role\(\)/);
  assert.match(workflowSql, /financial_document_id is null or public\.can_manage_expenses_org/);
  assert.doesNotMatch(workflowSql, /storage\.objects|publicUrl|getPublicUrl|public bucket/i);
  assert.match(dataSource, /financialDocumentSelect/);
  assert.match(dataSource, /officeTodoSelect/);
});

test("financial Gmail ingestion RPC is backend-only and preserves idempotent insert behavior", () => {
  const functionBody =
    ingestionServiceRoleOnlySql.match(
      /create or replace function public\.ingest_financial_document_mvp[\s\S]*?\n\$\$;/
    )?.[0] || "";

  assert.match(functionBody, /select \* into v_school/);
  assert.match(functionBody, /School % does not belong to organization %/);
  assert.match(functionBody, /insert into public\.financial_documents as fd/);
  assert.match(functionBody, /on conflict \(source_mailbox, gmail_message_id\) do update/);
  assert.match(functionBody, /perform public\.queue_financial_document_notification_mvp\(v_document_id\)/);
  assert.doesNotMatch(functionBody, /You do not have permission to create financial documents for this organization/);
  assert.doesNotMatch(functionBody, /can_manage_expenses_org\(p_organization_id\) or public\.is_service_role\(\)/);

  assert.match(
    ingestionServiceRoleOnlySql,
    /revoke execute on function public\.ingest_financial_document_mvp\([\s\S]*?\) from public;/
  );
  assert.match(
    ingestionServiceRoleOnlySql,
    /revoke execute on function public\.ingest_financial_document_mvp\([\s\S]*?\) from anon;/
  );
  assert.match(
    ingestionServiceRoleOnlySql,
    /revoke execute on function public\.ingest_financial_document_mvp\([\s\S]*?\) from authenticated;/
  );
  assert.match(
    ingestionServiceRoleOnlySql,
    /grant execute on function public\.ingest_financial_document_mvp\([\s\S]*?\) to service_role;/
  );
  assert.doesNotMatch(ingestionServiceRoleOnlySql, /grant execute on function public\.ingest_financial_document_mvp[\s\S]*to authenticated/);
  assert.doesNotMatch(ingestionServiceRoleOnlySql, /grant execute on function public\.ingest_financial_document_mvp[\s\S]*to anon/);

  assert.doesNotMatch(dataSource, /ingest_financial_document_mvp/);
  assert.match(workflowSql, /grant execute on function public\.mark_financial_document_read_mvp\(uuid\) to authenticated/);
  assert.match(workflowSql, /grant execute on function public\.dismiss_financial_document_mvp\(uuid\) to authenticated/);
  assert.match(workflowSql, /grant execute on function public\.create_office_todo_for_financial_document_mvp\(uuid, date, uuid\) to authenticated/);
  assert.match(workflowSql, /grant execute on function public\.create_expense_from_financial_document_mvp\(/);
  assert.match(workflowSql, /financial_documents_management_access/);
  assert.match(workflowSql, /to authenticated[\s\S]*?using \(public\.can_manage_expenses_org\(organization_id\)\)/);
});

function createCountRecorder(count) {
  const calls = [];
  const query = {
    eq(column, value) {
      calls.push(["eq", column, value]);
      return query;
    },
    select(columns, options) {
      calls.push(["select", columns, options]);
      return query;
    },
    then(resolve, reject) {
      return Promise.resolve({ count, error: null }).then(resolve, reject);
    }
  };

  return {
    calls,
    supabase: {
      from(table) {
        calls.push(["from", table]);
        return query;
      }
    }
  };
}

function createInsertRecorder(data) {
  const calls = [];
  const query = {
    insert(row) {
      calls.push(["insert", row]);
      return query;
    },
    maybeSingle() {
      calls.push(["maybeSingle"]);
      return Promise.resolve({ data, error: null });
    },
    select(selection) {
      calls.push(["select", selection]);
      return query;
    }
  };

  return {
    calls,
    supabase: {
      from(table) {
        calls.push(["from", table]);
        return query;
      }
    }
  };
}
