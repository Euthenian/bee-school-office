"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { EmptyState } from "@/components/EmptyState";
import { ExpenseForm, VoidExpenseForm } from "@/components/ExpenseForm";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { DataSurface, SurfaceHeader } from "@/components/Surface";
import { useAuth } from "@/components/AuthProvider";
import { fetchExpense, fetchExpenseCategories, fetchSchools, updateExpense, voidExpense } from "@/lib/data";
import { createExpenseForm, formatExpenseAmount } from "@/lib/expenses";
import { formatDate, formatDateTime, humanize } from "@/lib/format";
import { canManageExpenses } from "@/lib/roles";
import { getSupabaseBrowserClient } from "@/lib/supabase";

export default function ExpenseDetailPage() {
  return (
    <Suspense fallback={<ExpenseDetailLoading />}>
      <ExpenseDetailContent />
    </Suspense>
  );
}

function ExpenseDetailContent() {
  const searchParams = useSearchParams();
  const expenseId = searchParams.get("id") || "";
  const { profile, session } = useAuth();
  const mayManage = canManageExpenses(profile);
  const [notice, setNotice] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [voidSubmitting, setVoidSubmitting] = useState(false);
  const [state, setState] = useState({
    categories: [],
    error: "",
    expense: null,
    loading: true,
    schools: []
  });

  useEffect(() => {
    let active = true;

    async function loadExpense() {
      const nextState = await readExpenseState(expenseId, session, mayManage);
      if (!active) return;
      setState(nextState);
    }

    loadExpense();

    return () => {
      active = false;
    };
  }, [expenseId, mayManage, session]);

  const initialForm = useMemo(() => (state.expense ? createExpenseForm(state.expense) : null), [state.expense]);

  async function reloadExpense() {
    const nextState = await readExpenseState(expenseId, session, mayManage);
    setState(nextState);
  }

  async function handleUpdate(form) {
    setNotice("");
    setState((current) => ({ ...current, error: "" }));
    setSubmitting(true);

    const supabase = getSupabaseBrowserClient();
    if (!supabase || !session) {
      setState((current) => ({ ...current, error: "You must be signed in before editing an expense." }));
      setSubmitting(false);
      return;
    }

    const { error } = await updateExpense(supabase, { expenseId, ...form });
    if (error) {
      setState((current) => ({ ...current, error: error.message }));
      setSubmitting(false);
      return;
    }

    await reloadExpense();
    setNotice("Expense saved.");
    setSubmitting(false);
  }

  async function handleVoid(voidReason) {
    setNotice("");
    setState((current) => ({ ...current, error: "" }));
    setVoidSubmitting(true);

    const supabase = getSupabaseBrowserClient();
    if (!supabase || !session) {
      setState((current) => ({ ...current, error: "You must be signed in before voiding an expense." }));
      setVoidSubmitting(false);
      return;
    }

    const { error } = await voidExpense(supabase, expenseId, voidReason);
    if (error) {
      setState((current) => ({ ...current, error: error.message }));
      setVoidSubmitting(false);
      return;
    }

    await reloadExpense();
    setNotice("Expense voided.");
    setVoidSubmitting(false);
  }

  if (!mayManage) {
    return (
      <>
        <PageHeader eyebrow="Restricted admin" title="Expense Detail" />
        <DataSurface>
          <EmptyState title="Expenses are restricted" description="Your current role cannot access expense records." />
        </DataSurface>
      </>
    );
  }

  if (!expenseId && !state.loading) {
    return (
      <>
        <PageHeader eyebrow="Restricted admin" title="Expense not selected" />
        <EmptyState title="No expense ID was provided" description="Open an expense from the Expenses list." />
      </>
    );
  }

  if (state.loading) {
    return <ExpenseDetailLoading />;
  }

  if (state.error || !state.expense) {
    return (
      <>
        <PageHeader eyebrow="Restricted admin" title="Expense unavailable" />
        <p className="inline-alert">{state.error || "This expense could not be found or is not visible to your role."}</p>
        <Link className="secondary-button" href="/expenses/">
          Back to expenses
        </Link>
      </>
    );
  }

  const expense = state.expense;

  return (
    <>
      <PageHeader
        eyebrow="Restricted admin"
        title={expense.description}
        description={`${expense.schools?.name || "Unknown school"} / ${expense.expense_categories?.name || "Uncategorized"}`}
        actions={
          <div className="form-actions">
            <StatusBadge value={expense.status} />
            <Link className="secondary-button" href="/expenses/">
              Back to expenses
            </Link>
          </div>
        }
      />

      {notice ? <p className="inline-success">{notice}</p> : null}
      {state.error ? <p className="inline-alert">{state.error}</p> : null}

      <DataSurface>
        <SurfaceHeader>
          <h2>Expense Details</h2>
        </SurfaceHeader>
        <dl className="detail-list">
          <div>
            <dt>Date</dt>
            <dd>{formatDate(expense.expense_date)}</dd>
          </div>
          <div>
            <dt>Amount</dt>
            <dd>{formatExpenseAmount(expense.amount, expense.currency)}</dd>
          </div>
          <div>
            <dt>Tax</dt>
            <dd>{formatExpenseAmount(expense.tax_amount || 0, expense.currency)}</dd>
          </div>
          <div>
            <dt>Payment method</dt>
            <dd>{humanize(expense.payment_method)}</dd>
          </div>
          <div>
            <dt>Vendor</dt>
            <dd>{expense.vendor || "Not set"}</dd>
          </div>
          <div>
            <dt>Reference</dt>
            <dd>{expense.reference || "Not set"}</dd>
          </div>
          <div>
            <dt>Receipt reference</dt>
            <dd>{expense.receipt_reference || "Not set"}</dd>
          </div>
          <div>
            <dt>Receipt file path</dt>
            <dd>{expense.receipt_file_path || "Not set"}</dd>
          </div>
          <div>
            <dt>Receipt original name</dt>
            <dd>{expense.receipt_original_name || "Not set"}</dd>
          </div>
          <div>
            <dt>Created by</dt>
            <dd>{formatProfile(expense.created_by_profile)}</dd>
          </div>
          <div>
            <dt>Created at</dt>
            <dd>{formatDateTime(expense.created_at)}</dd>
          </div>
          <div>
            <dt>Updated at</dt>
            <dd>{formatDateTime(expense.updated_at)}</dd>
          </div>
          {expense.status === "void" ? (
            <>
              <div>
                <dt>Voided by</dt>
                <dd>{formatProfile(expense.voided_by_profile)}</dd>
              </div>
              <div>
                <dt>Voided at</dt>
                <dd>{formatDateTime(expense.voided_at)}</dd>
              </div>
              <div>
                <dt>Void reason</dt>
                <dd>{expense.void_reason || "Not set"}</dd>
              </div>
            </>
          ) : null}
        </dl>
      </DataSurface>

      {expense.status === "active" && initialForm ? (
        <ExpenseForm
          cancelHref="/expenses/"
          categories={state.categories}
          initialForm={initialForm}
          key={`${expense.id}-${expense.updated_at}`}
          mode="edit"
          onSubmit={handleUpdate}
          schools={state.schools}
          submitting={submitting}
        />
      ) : (
        <DataSurface>
          <EmptyState title="Expense is void" description="Voided expenses remain visible for audit history and cannot be edited." />
        </DataSurface>
      )}

      {expense.status === "active" ? <VoidExpenseForm onSubmit={handleVoid} submitting={voidSubmitting} /> : null}
    </>
  );
}

async function readExpenseState(expenseId, session, mayManage) {
  const supabase = getSupabaseBrowserClient();
  if (!supabase || !session || !expenseId || !mayManage) {
    return { categories: [], error: "", expense: null, loading: false, schools: [] };
  }

  const [expenseResult, categoriesResult, schoolsResult] = await Promise.all([
    fetchExpense(supabase, expenseId),
    fetchExpenseCategories(supabase, { status: "active" }),
    fetchSchools(supabase)
  ]);

  const loadError = [expenseResult.error, categoriesResult.error, schoolsResult.error]
    .filter(Boolean)
    .map((error) => error.message)
    .join(" ");

  return {
    categories: categoriesResult.data || [],
    error: loadError,
    expense: expenseResult.data || null,
    loading: false,
    schools: schoolsResult.data || []
  };
}

function formatProfile(profile) {
  return profile?.full_name || profile?.email || "Not set";
}

function ExpenseDetailLoading() {
  return (
    <>
      <PageHeader eyebrow="Restricted admin" title="Loading expense" />
      <div className="table-placeholder">Loading expense...</div>
    </>
  );
}
