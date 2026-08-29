"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { EmptyState } from "@/components/EmptyState";
import { ExpenseForm } from "@/components/ExpenseForm";
import { PageHeader } from "@/components/PageHeader";
import { DataSurface } from "@/components/Surface";
import { useAuth } from "@/components/AuthProvider";
import { createExpense, fetchExpenseCategories, fetchSchools } from "@/lib/data";
import { createExpenseForm } from "@/lib/expenses";
import { canManageExpenses } from "@/lib/roles";
import { getSupabaseBrowserClient } from "@/lib/supabase";

export default function NewExpensePage() {
  const router = useRouter();
  const { profile, session } = useAuth();
  const mayManage = canManageExpenses(profile);
  const [state, setState] = useState({ categories: [], error: "", loading: true, schools: [] });
  const [submitting, setSubmitting] = useState(false);
  const initialForm = useMemo(() => createExpenseForm(), []);

  useEffect(() => {
    let active = true;

    async function loadFoundation() {
      const supabase = getSupabaseBrowserClient();
      if (!supabase || !session || !mayManage) {
        setState({ categories: [], error: "", loading: false, schools: [] });
        return;
      }

      setState((current) => ({ ...current, loading: true }));
      const [categoriesResult, schoolsResult] = await Promise.all([
        fetchExpenseCategories(supabase, { status: "active" }),
        fetchSchools(supabase)
      ]);
      if (!active) return;

      const loadError = [categoriesResult.error, schoolsResult.error]
        .filter(Boolean)
        .map((error) => error.message)
        .join(" ");

      setState({
        categories: categoriesResult.data || [],
        error: loadError,
        loading: false,
        schools: schoolsResult.data || []
      });
    }

    loadFoundation();

    return () => {
      active = false;
    };
  }, [mayManage, session]);

  async function handleSubmit(form) {
    setState((current) => ({ ...current, error: "" }));
    setSubmitting(true);

    const supabase = getSupabaseBrowserClient();
    if (!supabase || !session) {
      setState((current) => ({ ...current, error: "You must be signed in before adding an expense." }));
      setSubmitting(false);
      return;
    }

    const { data, error } = await createExpense(supabase, form);
    if (error) {
      setState((current) => ({ ...current, error: error.message }));
      setSubmitting(false);
      return;
    }

    router.push(data ? `/expenses/detail/?id=${data}` : "/expenses/");
  }

  if (!mayManage) {
    return (
      <>
        <PageHeader eyebrow="Restricted admin" title="Add Expense" />
        <DataSurface>
          <EmptyState title="Expenses are restricted" description="Your current role cannot add expense records." />
        </DataSurface>
      </>
    );
  }

  if (state.loading) {
    return (
      <>
        <PageHeader eyebrow="Restricted admin" title="Loading expense form" />
        <div className="table-placeholder">Loading expense form...</div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        eyebrow="Restricted admin"
        title="Add Expense"
        actions={
          <Link className="secondary-button" href="/expenses/">
            Back to expenses
          </Link>
        }
      />

      {state.error ? <p className="inline-alert">{state.error}</p> : null}

      <ExpenseForm
        cancelHref="/expenses/"
        categories={state.categories}
        initialForm={initialForm}
        onSubmit={handleSubmit}
        schools={state.schools}
        submitting={submitting}
      />
    </>
  );
}
