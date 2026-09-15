"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { EmptyState } from "@/components/EmptyState";
import { ExpenseForm } from "@/components/ExpenseForm";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { DataSurface, SurfaceHeader } from "@/components/Surface";
import { useAuth } from "@/components/AuthProvider";
import {
  createExpenseFromFinancialDocument,
  createOfficeTodoForFinancialDocument,
  dismissFinancialDocument,
  fetchExpenseCategories,
  fetchFinancialDocument,
  fetchSchools,
  markFinancialDocumentRead
} from "@/lib/data";
import {
  getFinancialDocumentTitle,
  notifyFinancialDocumentsUpdated
} from "@/lib/financial-documents";
import { createExpenseForm, formatExpenseAmount } from "@/lib/expenses";
import { formatDateTime, humanize } from "@/lib/format";
import { notifyOfficeTodosUpdated } from "@/lib/office-todos";
import { canManageFinancialDocuments } from "@/lib/roles";
import { getSupabaseBrowserClient } from "@/lib/supabase";

export default function FinancialDocumentReviewPage() {
  return (
    <Suspense fallback={<FinancialDocumentReviewLoading />}>
      <FinancialDocumentReviewContent />
    </Suspense>
  );
}

function FinancialDocumentReviewContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const documentId = searchParams.get("id") || "";
  const { profile, session } = useAuth();
  const mayManage = canManageFinancialDocuments(profile);
  const [action, setAction] = useState("");
  const [notice, setNotice] = useState("");
  const [state, setState] = useState({
    categories: [],
    document: null,
    error: "",
    loading: true,
    schools: []
  });

  useEffect(() => {
    let active = true;

    async function loadDocument() {
      const nextState = await readFinancialDocumentState(documentId, session, mayManage);
      if (!active) return;
      setState(nextState);
    }

    loadDocument();

    return () => {
      active = false;
    };
  }, [documentId, mayManage, session]);

  const initialExpenseForm = useMemo(
    () => (state.document ? createExpenseForm(buildExpenseDefaultsFromDocument(state.document)) : null),
    [state.document]
  );

  async function reloadDocument() {
    const nextState = await readFinancialDocumentState(documentId, session, mayManage);
    setState(nextState);
  }

  async function runAction(actionName, callback, successMessage) {
    const supabase = getSupabaseBrowserClient();
    if (!supabase || !session) {
      setState((current) => ({ ...current, error: "You must be signed in before updating this document." }));
      return null;
    }

    setAction(actionName);
    setNotice("");
    setState((current) => ({ ...current, error: "" }));
    const result = await callback(supabase);
    if (result.error) {
      setState((current) => ({ ...current, error: result.error.message }));
      setAction("");
      return null;
    }

    await reloadDocument();
    setNotice(successMessage);
    setAction("");
    return result.data;
  }

  async function handleMarkRead() {
    await runAction("read", (supabase) => markFinancialDocumentRead(supabase, documentId), "Document marked read.");
    notifyFinancialDocumentsUpdated();
  }

  async function handleDismiss() {
    await runAction("dismiss", (supabase) => dismissFinancialDocument(supabase, documentId), "Document dismissed.");
    notifyFinancialDocumentsUpdated();
  }

  async function handleCreateTodo() {
    await runAction("todo", (supabase) => createOfficeTodoForFinancialDocument(supabase, documentId), "To Do item created.");
    notifyOfficeTodosUpdated();
  }

  async function handleCreateExpense(form) {
    const expenseId = await runAction(
      "expense",
      (supabase) => createExpenseFromFinancialDocument(supabase, documentId, form),
      "Expense created from financial document."
    );

    if (expenseId) {
      notifyFinancialDocumentsUpdated();
      router.push(`/expenses/detail/?id=${expenseId}`);
    }
  }

  if (!mayManage) {
    return (
      <>
        <PageHeader eyebrow="Restricted admin" title="Financial document" />
        <DataSurface>
          <EmptyState title="Financial documents are restricted" description="Your current role cannot review financial documents." />
        </DataSurface>
      </>
    );
  }

  if (state.loading) {
    return <FinancialDocumentReviewLoading />;
  }

  if (state.error || !state.document) {
    return (
      <>
        <PageHeader eyebrow="Expenses" title="Financial document unavailable" />
        <p className="inline-alert">{state.error || "This financial document could not be found."}</p>
        <Link className="secondary-button" href="/expenses/financial-docs/">
          Back to financial docs
        </Link>
      </>
    );
  }

  const document = state.document;

  return (
    <>
      <PageHeader
        eyebrow="Financial docs to check"
        title={getFinancialDocumentTitle(document)}
        description={`${document.schools?.name || "Unknown school"} / ${document.vendor || document.sender || "Vendor not detected"}`}
        actions={
          <div className="form-actions">
            <StatusBadge value={document.status} />
            <Link className="secondary-button" href="/expenses/financial-docs/">
              Back to financial docs
            </Link>
          </div>
        }
      />

      {state.error ? <p className="inline-alert">{state.error}</p> : null}
      {notice ? <p className="inline-success">{notice}</p> : null}

      <DataSurface>
        <SurfaceHeader>
          <h2>Document</h2>
          <div className="table-actions">
            {!document.is_read ? (
              <button className="secondary-button" disabled={Boolean(action)} onClick={handleMarkRead} type="button">
                {action === "read" ? "Saving..." : "Mark read"}
              </button>
            ) : null}
            {document.status === "pending" ? (
              <>
                <button className="secondary-button" disabled={Boolean(action)} onClick={handleCreateTodo} type="button">
                  {action === "todo" ? "Creating..." : "Create To Do"}
                </button>
                <button className="danger-button" disabled={Boolean(action)} onClick={handleDismiss} type="button">
                  {action === "dismiss" ? "Dismissing..." : "Dismiss"}
                </button>
              </>
            ) : null}
          </div>
        </SurfaceHeader>
        <dl className="detail-list">
          <div>
            <dt>Received</dt>
            <dd>{formatDateTime(document.received_at || document.created_at)}</dd>
          </div>
          <div>
            <dt>Source</dt>
            <dd>{humanize(document.source)}</dd>
          </div>
          <div>
            <dt>Sender</dt>
            <dd>{document.sender || "Not set"}</dd>
          </div>
          <div>
            <dt>Subject</dt>
            <dd>{document.subject || "Not set"}</dd>
          </div>
          <div>
            <dt>Filename</dt>
            <dd>{document.document_filename || "No file"}</dd>
          </div>
          <div>
            <dt>Stored reference</dt>
            <dd>{document.document_file_path || document.gmail_message_id || document.id}</dd>
          </div>
          <div>
            <dt>Detected amount</dt>
            <dd>
              {document.detected_amount
                ? formatExpenseAmount(document.detected_amount, document.detected_currency || "JPY")
                : "Not detected"}
            </dd>
          </div>
          <div>
            <dt>Read state</dt>
            <dd>{document.is_read ? "Read" : "Unread"}</dd>
          </div>
          {document.linked_expense_id ? (
            <div>
              <dt>Linked expense</dt>
              <dd>
                <Link href={`/expenses/detail/?id=${document.linked_expense_id}`}>Open expense</Link>
              </dd>
            </div>
          ) : null}
        </dl>
        {document.raw_body ? (
          <details className="source-details">
            <summary>Source text</summary>
            <pre>{document.raw_body}</pre>
          </details>
        ) : null}
      </DataSurface>

      {document.status === "pending" && initialExpenseForm ? (
        <ExpenseForm
          cancelHref="/expenses/financial-docs/"
          categories={state.categories}
          initialForm={initialExpenseForm}
          key={`${document.id}-${document.updated_at}`}
          onSubmit={handleCreateExpense}
          schools={state.schools}
          submitting={action === "expense"}
        />
      ) : (
        <DataSurface>
          <EmptyState
            title="No expense action needed"
            description="Processed and dismissed documents remain available here for audit history."
          />
        </DataSurface>
      )}
    </>
  );
}

async function readFinancialDocumentState(documentId, session, mayManage) {
  const supabase = getSupabaseBrowserClient();
  if (!supabase || !session || !documentId || !mayManage) {
    return { categories: [], document: null, error: "", loading: false, schools: [] };
  }

  const [documentResult, categoriesResult, schoolsResult] = await Promise.all([
    fetchFinancialDocument(supabase, documentId),
    fetchExpenseCategories(supabase, { status: "active" }),
    fetchSchools(supabase)
  ]);

  const loadError = [documentResult.error, categoriesResult.error, schoolsResult.error]
    .filter(Boolean)
    .map((error) => error.message)
    .join(" ");

  return {
    categories: categoriesResult.data || [],
    document: documentResult.data || null,
    error: loadError,
    loading: false,
    schools: schoolsResult.data || []
  };
}

function buildExpenseDefaultsFromDocument(document) {
  return {
    school_id: document.school_id,
    expense_date: (document.received_at || document.created_at || new Date().toISOString()).slice(0, 10),
    category_id: document.category_id || "",
    vendor: document.vendor || document.sender || "",
    description: getFinancialDocumentTitle(document),
    amount: document.detected_amount || "",
    currency: document.detected_currency || "JPY",
    payment_method: "bank_transfer",
    reference: document.gmail_message_id || document.id,
    receipt_reference: document.document_filename || document.id,
    receipt_file_path: document.document_file_path || "",
    receipt_original_name: document.document_filename || "",
    notes: `Source financial document: ${document.id}`
  };
}

function FinancialDocumentReviewLoading() {
  return (
    <>
      <PageHeader eyebrow="Financial docs to check" title="Loading financial document" />
      <div className="table-placeholder">Loading financial document...</div>
    </>
  );
}
