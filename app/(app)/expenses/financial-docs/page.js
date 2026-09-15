"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { DataSurface, MetricCard, ResponsiveTable, SurfaceHeader } from "@/components/Surface";
import { useAuth } from "@/components/AuthProvider";
import {
  createFinancialDocumentRule,
  createOfficeTodoForFinancialDocument,
  dismissFinancialDocument,
  fetchExpenseCategories,
  fetchFinancialDocumentRules,
  fetchFinancialDocuments,
  fetchOrganizations,
  fetchSchools,
  markFinancialDocumentRead
} from "@/lib/data";
import {
  createFinancialDocumentRuleForm,
  financialDocumentProcessingModes,
  financialDocumentStatuses,
  getFinancialDocumentTitle,
  notifyFinancialDocumentsUpdated,
  validateFinancialDocumentRuleForm
} from "@/lib/financial-documents";
import { formatExpenseAmount, isExpenseCategoryAvailableForSchool } from "@/lib/expenses";
import { formatDateTime, humanize } from "@/lib/format";
import { notifyOfficeTodosUpdated } from "@/lib/office-todos";
import { canManageFinancialDocuments } from "@/lib/roles";
import { getSupabaseBrowserClient } from "@/lib/supabase";

export default function FinancialDocumentsPage() {
  const { profile, session } = useAuth();
  const mayManage = canManageFinancialDocuments(profile);
  const [filters, setFilters] = useState({ search: "", status: "pending" });
  const [ruleForm, setRuleForm] = useState(() => createFinancialDocumentRuleForm());
  const [notice, setNotice] = useState("");
  const [actionId, setActionId] = useState("");
  const [ruleSubmitting, setRuleSubmitting] = useState(false);
  const [state, setState] = useState({
    categories: [],
    documents: [],
    error: "",
    loading: true,
    organizations: [],
    rules: [],
    schools: []
  });

  const pendingUnreadCount = state.documents.filter((document) => document.status === "pending" && !document.is_read).length;
  const pendingCount = state.documents.filter((document) => document.status === "pending").length;
  const availableRuleCategories = useMemo(
    () =>
      state.categories.filter(
        (category) =>
          category.status === "active" &&
          (!ruleForm.schoolId || isExpenseCategoryAvailableForSchool(category, ruleForm.schoolId)) &&
          (!ruleForm.organizationId || category.organization_id === ruleForm.organizationId)
      ),
    [ruleForm.organizationId, ruleForm.schoolId, state.categories]
  );
  const schoolsForRuleOrganization = useMemo(
    () => state.schools.filter((school) => !ruleForm.organizationId || school.organization_id === ruleForm.organizationId),
    [ruleForm.organizationId, state.schools]
  );

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(async () => {
      const supabase = getSupabaseBrowserClient();
      if (!supabase || !session || !mayManage) {
        setState({ categories: [], documents: [], error: "", loading: false, organizations: [], rules: [], schools: [] });
        return;
      }

      setState((current) => ({ ...current, loading: true }));
      const [documentsResult, rulesResult, categoriesResult, schoolsResult, organizationsResult] = await Promise.all([
        fetchFinancialDocuments(supabase, filters),
        fetchFinancialDocumentRules(supabase),
        fetchExpenseCategories(supabase, { status: "active" }),
        fetchSchools(supabase),
        fetchOrganizations(supabase)
      ]);
      if (!active) return;

      const loadError = [
        documentsResult.error,
        rulesResult.error,
        categoriesResult.error,
        schoolsResult.error,
        organizationsResult.error
      ]
        .filter(Boolean)
        .map((error) => error.message)
        .join(" ");

      setState({
        categories: categoriesResult.data || [],
        documents: documentsResult.data || [],
        error: loadError,
        loading: false,
        organizations: organizationsResult.data || [],
        rules: rulesResult.data || [],
        schools: schoolsResult.data || []
      });

      if (!ruleForm.organizationId && organizationsResult.data?.length === 1) {
        setRuleForm((current) => ({ ...current, organizationId: organizationsResult.data[0].id }));
      }
    }, 180);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [filters, mayManage, ruleForm.organizationId, session]);

  async function reloadDocuments() {
    const supabase = getSupabaseBrowserClient();
    if (!supabase || !session) return;
    const [documentsResult, rulesResult] = await Promise.all([
      fetchFinancialDocuments(supabase, filters),
      fetchFinancialDocumentRules(supabase)
    ]);
    setState((current) => ({
      ...current,
      documents: documentsResult.data || [],
      error: [documentsResult.error, rulesResult.error]
        .filter(Boolean)
        .map((error) => error.message)
        .join(" "),
      rules: rulesResult.data || []
    }));
  }

  async function handleMarkRead(document) {
    await runDocumentAction(document.id, async (supabase) => markFinancialDocumentRead(supabase, document.id), "Document marked read.");
    notifyFinancialDocumentsUpdated();
  }

  async function handleDismiss(document) {
    await runDocumentAction(document.id, async (supabase) => dismissFinancialDocument(supabase, document.id), "Document dismissed.");
    notifyFinancialDocumentsUpdated();
  }

  async function handleCreateTodo(document) {
    await runDocumentAction(
      document.id,
      async (supabase) => createOfficeTodoForFinancialDocument(supabase, document.id),
      "To Do item created."
    );
    notifyOfficeTodosUpdated();
  }

  async function runDocumentAction(documentId, action, successMessage) {
    const supabase = getSupabaseBrowserClient();
    if (!supabase || !session) {
      setState((current) => ({ ...current, error: "You must be signed in before updating financial documents." }));
      return;
    }

    setActionId(documentId);
    setNotice("");
    setState((current) => ({ ...current, error: "" }));
    const { error } = await action(supabase);
    if (error) {
      setState((current) => ({ ...current, error: error.message }));
      setActionId("");
      return;
    }

    await reloadDocuments();
    setNotice(successMessage);
    setActionId("");
  }

  function updateRuleField(field, value) {
    setRuleForm((current) => {
      const next = { ...current, [field]: field === "currency" ? value.toUpperCase() : value };
      if (field === "organizationId") {
        next.schoolId = "";
        next.categoryId = "";
      }
      if (field === "schoolId") {
        const categoryStillAvailable = state.categories.some(
          (category) => category.id === current.categoryId && isExpenseCategoryAvailableForSchool(category, value)
        );
        if (!categoryStillAvailable) next.categoryId = "";
      }
      return next;
    });
  }

  async function handleCreateRule(event) {
    event.preventDefault();
    setNotice("");

    const validationError = validateFinancialDocumentRuleForm(ruleForm);
    if (validationError) {
      setState((current) => ({ ...current, error: validationError }));
      return;
    }

    const supabase = getSupabaseBrowserClient();
    if (!supabase || !session) {
      setState((current) => ({ ...current, error: "You must be signed in before creating financial document rules." }));
      return;
    }

    setRuleSubmitting(true);
    const { error } = await createFinancialDocumentRule(supabase, ruleForm);
    if (error) {
      setState((current) => ({ ...current, error: error.message }));
      setRuleSubmitting(false);
      return;
    }

    setRuleForm(createFinancialDocumentRuleForm({ organizationId: ruleForm.organizationId }));
    await reloadDocuments();
    setNotice("Trusted vendor rule saved.");
    setRuleSubmitting(false);
  }

  if (!mayManage) {
    return (
      <>
        <PageHeader eyebrow="Restricted admin" title="Financial docs to check" />
        <DataSurface>
          <EmptyState title="Financial documents are restricted" description="Your current role cannot access financial documents." />
        </DataSurface>
      </>
    );
  }

  return (
    <>
      <PageHeader
        eyebrow="Expenses"
        title="Financial docs to check"
        description="Review incoming invoices, receipts, bills, and payment notices before they become expenses."
        actions={
          <Link className="secondary-button" href="/expenses/">
            Back to expenses
          </Link>
        }
      />

      {state.error ? <p className="inline-alert">{state.error}</p> : null}
      {notice ? <p className="inline-success">{notice}</p> : null}

      <div className="metric-grid">
        <MetricCard label="Unread pending" loading={state.loading} value={pendingUnreadCount} />
        <MetricCard label="Pending" loading={state.loading} value={pendingCount} />
        <MetricCard label="Rules" loading={state.loading} value={state.rules.length} />
      </div>

      <DataSurface>
        <SurfaceHeader>
          <h2>Filters</h2>
        </SurfaceHeader>
        <div className="form-grid">
          <label>
            Search
            <input
              onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value }))}
              placeholder="Sender, vendor, subject, filename"
              type="search"
              value={filters.search}
            />
          </label>
          <label>
            Status
            <select onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value }))} value={filters.status}>
              <option value="all">All statuses</option>
              {financialDocumentStatuses.map((status) => (
                <option key={status.value} value={status.value}>
                  {status.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </DataSurface>

      <DataSurface aria-label="Financial documents list">
        <SurfaceHeader>
          <h2>Documents</h2>
        </SurfaceHeader>
        {state.loading ? (
          <div className="table-placeholder">Loading financial documents...</div>
        ) : state.documents.length ? (
          <ResponsiveTable>
            <table>
              <thead>
                <tr>
                  <th>Received</th>
                  <th>Source</th>
                  <th>Sender / Vendor</th>
                  <th>Title</th>
                  <th>File</th>
                  <th>Amount</th>
                  <th>Status</th>
                  <th>Unread</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {state.documents.map((document) => (
                  <tr key={document.id}>
                    <td>{formatDateTime(document.received_at || document.created_at)}</td>
                    <td>{humanize(document.source)}</td>
                    <td>{document.vendor || document.sender || "Not detected"}</td>
                    <td>{getFinancialDocumentTitle(document)}</td>
                    <td>{document.document_filename || "No file"}</td>
                    <td>{document.detected_amount ? formatExpenseAmount(document.detected_amount, document.detected_currency || "JPY") : "Not detected"}</td>
                    <td>
                      <StatusBadge value={document.status} />
                    </td>
                    <td>{document.is_read ? "Read" : "Unread"}</td>
                    <td>
                      <div className="table-actions">
                        <Link className="secondary-button" href={`/expenses/financial-docs/review/?id=${document.id}`}>
                          View
                        </Link>
                        {!document.is_read ? (
                          <button
                            className="secondary-button"
                            disabled={actionId === document.id}
                            onClick={() => handleMarkRead(document)}
                            type="button"
                          >
                            Mark read
                          </button>
                        ) : null}
                        {document.status === "pending" ? (
                          <>
                            <button
                              className="secondary-button"
                              disabled={actionId === document.id}
                              onClick={() => handleCreateTodo(document)}
                              type="button"
                            >
                              Create To Do
                            </button>
                            <button
                              className="danger-button"
                              disabled={actionId === document.id}
                              onClick={() => handleDismiss(document)}
                              type="button"
                            >
                              Dismiss
                            </button>
                          </>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ResponsiveTable>
        ) : (
          <EmptyState title="No financial documents" description="Pending invoices, receipts, bills, and payment notices will appear here." />
        )}
      </DataSurface>

      <DataSurface>
        <SurfaceHeader>
          <h2>Trusted Vendor Rules</h2>
        </SurfaceHeader>
        <form className="form-grid" onSubmit={handleCreateRule}>
          <label>
            Organization
            <select onChange={(event) => updateRuleField("organizationId", event.target.value)} required value={ruleForm.organizationId}>
              <option value="">Select organization</option>
              {state.organizations.map((organization) => (
                <option key={organization.id} value={organization.id}>
                  {organization.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            School scope
            <select onChange={(event) => updateRuleField("schoolId", event.target.value)} value={ruleForm.schoolId}>
              <option value="">All schools in organization</option>
              {schoolsForRuleOrganization.map((school) => (
                <option key={school.id} value={school.id}>
                  {school.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Sender/domain contains
            <input onChange={(event) => updateRuleField("senderDomain", event.target.value)} value={ruleForm.senderDomain} />
          </label>
          <label>
            Subject contains
            <input onChange={(event) => updateRuleField("subjectContains", event.target.value)} value={ruleForm.subjectContains} />
          </label>
          <label>
            Vendor
            <input onChange={(event) => updateRuleField("vendor", event.target.value)} required value={ruleForm.vendor} />
          </label>
          <label>
            Category
            <select onChange={(event) => updateRuleField("categoryId", event.target.value)} value={ruleForm.categoryId}>
              <option value="">Select category</option>
              {availableRuleCategories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Expected amount
            <input
              inputMode="decimal"
              min="0"
              onChange={(event) => updateRuleField("expectedAmount", event.target.value)}
              step="0.01"
              type="number"
              value={ruleForm.expectedAmount}
            />
          </label>
          <label>
            Currency
            <input maxLength="3" onChange={(event) => updateRuleField("currency", event.target.value)} required value={ruleForm.currency} />
          </label>
          <label>
            Processing mode
            <select onChange={(event) => updateRuleField("processingMode", event.target.value)} required value={ruleForm.processingMode}>
              {financialDocumentProcessingModes.map((mode) => (
                <option key={mode.value} value={mode.value}>
                  {mode.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Notes
            <input onChange={(event) => updateRuleField("notes", event.target.value)} value={ruleForm.notes} />
          </label>
          <div className="toolbar-filter-actions">
            <button className="primary-button" disabled={ruleSubmitting} type="submit">
              {ruleSubmitting ? "Saving..." : "Add rule"}
            </button>
          </div>
        </form>

        {state.rules.length ? (
          <ResponsiveTable>
            <table>
              <thead>
                <tr>
                  <th>Vendor</th>
                  <th>Scope</th>
                  <th>Sender/domain</th>
                  <th>Subject</th>
                  <th>Mode</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {state.rules.map((rule) => (
                  <tr key={rule.id}>
                    <td>{rule.vendor}</td>
                    <td>{rule.schools?.name || "All schools"}</td>
                    <td>{rule.sender_domain || "Any"}</td>
                    <td>{rule.subject_contains || "Any"}</td>
                    <td>{humanize(rule.processing_mode)}</td>
                    <td>
                      <StatusBadge value={rule.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ResponsiveTable>
        ) : null}
      </DataSurface>
    </>
  );
}
