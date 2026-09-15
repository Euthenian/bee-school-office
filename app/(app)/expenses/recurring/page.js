"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { DataSurface, ResponsiveTable, SurfaceHeader } from "@/components/Surface";
import { useAuth } from "@/components/AuthProvider";
import {
  createRecurringExpenseTemplate,
  fetchExpenseCategories,
  fetchRecurringExpenseTemplates,
  fetchSchools,
  generateRecurringExpenses
} from "@/lib/data";
import { expensePaymentMethods, formatExpenseAmount, isExpenseCategoryAvailableForSchool } from "@/lib/expenses";
import { formatDate, humanize } from "@/lib/format";
import { canManageExpenses } from "@/lib/roles";
import {
  createRecurringExpenseTemplateForm,
  getMonthStartDate,
  recurringExpenseRecurrences,
  validateRecurringExpenseTemplateForm
} from "@/lib/recurring-expenses";
import { getSupabaseBrowserClient } from "@/lib/supabase";

export default function RecurringExpensesPage() {
  const { profile, session } = useAuth();
  const mayManage = canManageExpenses(profile);
  const [form, setForm] = useState(() => createRecurringExpenseTemplateForm());
  const [generationMonth, setGenerationMonth] = useState(() => getMonthStartDate());
  const [notice, setNotice] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [state, setState] = useState({
    categories: [],
    error: "",
    loading: true,
    schools: [],
    templates: []
  });

  const availableCategories = useMemo(
    () => state.categories.filter((category) => isExpenseCategoryAvailableForSchool(category, form.schoolId)),
    [form.schoolId, state.categories]
  );

  useEffect(() => {
    let active = true;

    async function loadData() {
      const supabase = getSupabaseBrowserClient();
      if (!supabase || !session || !mayManage) {
        setState({ categories: [], error: "", loading: false, schools: [], templates: [] });
        return;
      }

      setState((current) => ({ ...current, loading: true }));
      const [templatesResult, categoriesResult, schoolsResult] = await Promise.all([
        fetchRecurringExpenseTemplates(supabase),
        fetchExpenseCategories(supabase, { status: "active" }),
        fetchSchools(supabase)
      ]);
      if (!active) return;

      const loadError = [templatesResult.error, categoriesResult.error, schoolsResult.error]
        .filter(Boolean)
        .map((error) => error.message)
        .join(" ");

      setState({
        categories: categoriesResult.data || [],
        error: loadError,
        loading: false,
        schools: schoolsResult.data || [],
        templates: templatesResult.data || []
      });
    }

    loadData();

    return () => {
      active = false;
    };
  }, [mayManage, session]);

  function updateField(field, value) {
    setForm((current) => {
      const next = { ...current, [field]: value };
      if (field === "schoolId") {
        const categoryStillAvailable = state.categories.some(
          (category) => category.id === current.categoryId && isExpenseCategoryAvailableForSchool(category, value)
        );
        if (!categoryStillAvailable) next.categoryId = "";
      }
      if (field === "currency") next.currency = value.toUpperCase();
      return next;
    });
  }

  async function reloadTemplates() {
    const supabase = getSupabaseBrowserClient();
    if (!supabase || !session) return;
    const { data, error } = await fetchRecurringExpenseTemplates(supabase);
    setState((current) => ({
      ...current,
      error: error ? error.message : "",
      templates: data || []
    }));
  }

  async function handleCreateTemplate(event) {
    event.preventDefault();
    setNotice("");

    const validationError = validateRecurringExpenseTemplateForm(form);
    if (validationError) {
      setState((current) => ({ ...current, error: validationError }));
      return;
    }

    const supabase = getSupabaseBrowserClient();
    if (!supabase || !session) {
      setState((current) => ({ ...current, error: "You must be signed in before creating a recurring template." }));
      return;
    }

    setSubmitting(true);
    const { error } = await createRecurringExpenseTemplate(supabase, form);
    if (error) {
      setState((current) => ({ ...current, error: error.message }));
      setSubmitting(false);
      return;
    }

    setForm(createRecurringExpenseTemplateForm());
    await reloadTemplates();
    setNotice("Recurring template saved.");
    setSubmitting(false);
  }

  async function handleGenerate(event) {
    event.preventDefault();
    setNotice("");

    const supabase = getSupabaseBrowserClient();
    if (!supabase || !session) {
      setState((current) => ({ ...current, error: "You must be signed in before generating expenses." }));
      return;
    }

    setGenerating(true);
    const { data, error } = await generateRecurringExpenses(supabase, generationMonth);
    if (error) {
      setState((current) => ({ ...current, error: error.message }));
      setGenerating(false);
      return;
    }

    const generatedCount = (data || []).filter((row) => row.generation_status === "generated").length;
    const existingCount = (data || []).filter((row) => row.generation_status === "existing").length;
    setNotice(`Generated ${generatedCount} expense rows. ${existingCount} already existed.`);
    setGenerating(false);
  }

  if (!mayManage) {
    return (
      <>
        <PageHeader eyebrow="Restricted admin" title="Recurring expenses" />
        <DataSurface>
          <EmptyState title="Recurring expenses are restricted" description="Your current role cannot manage expenses." />
        </DataSurface>
      </>
    );
  }

  return (
    <>
      <PageHeader
        eyebrow="Expenses"
        title="Recurring expenses"
        description="Create monthly expense templates and generate exactly one persisted expense per template per month."
        actions={
          <Link className="secondary-button" href="/expenses/">
            Back to expenses
          </Link>
        }
      />

      {state.error ? <p className="inline-alert">{state.error}</p> : null}
      {notice ? <p className="inline-success">{notice}</p> : null}

      <DataSurface>
        <SurfaceHeader>
          <h2>Monthly Generation</h2>
        </SurfaceHeader>
        <form className="form-grid" onSubmit={handleGenerate}>
          <label>
            Month
            <input onChange={(event) => setGenerationMonth(event.target.value)} required type="date" value={generationMonth} />
          </label>
          <div className="toolbar-filter-actions">
            <button className="primary-button" disabled={generating} type="submit">
              {generating ? "Generating..." : "Generate month"}
            </button>
          </div>
        </form>
      </DataSurface>

      <form className="student-form" onSubmit={handleCreateTemplate}>
        <DataSurface>
          <SurfaceHeader>
            <h2>New Template</h2>
          </SurfaceHeader>
          <div className="form-grid">
            <label>
              School
              <select onChange={(event) => updateField("schoolId", event.target.value)} required value={form.schoolId}>
                <option value="">Select school</option>
                {state.schools.map((school) => (
                  <option key={school.id} value={school.id}>
                    {school.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Category
              <select onChange={(event) => updateField("categoryId", event.target.value)} required value={form.categoryId}>
                <option value="">Select category</option>
                {availableCategories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Expense name
              <input onChange={(event) => updateField("name", event.target.value)} required value={form.name} />
            </label>
            <label>
              Vendor
              <input onChange={(event) => updateField("vendor", event.target.value)} value={form.vendor} />
            </label>
            <label>
              Amount
              <input
                inputMode="decimal"
                min="0"
                onChange={(event) => updateField("amount", event.target.value)}
                required
                step="0.01"
                type="number"
                value={form.amount}
              />
            </label>
            <label>
              Currency
              <input maxLength="3" onChange={(event) => updateField("currency", event.target.value)} required value={form.currency} />
            </label>
            <label>
              Tax amount
              <input
                inputMode="decimal"
                min="0"
                onChange={(event) => updateField("taxAmount", event.target.value)}
                step="0.01"
                type="number"
                value={form.taxAmount}
              />
            </label>
            <label>
              Payment method
              <select onChange={(event) => updateField("paymentMethod", event.target.value)} required value={form.paymentMethod}>
                {expensePaymentMethods.map((method) => (
                  <option key={method.value} value={method.value}>
                    {method.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Recurrence
              <select onChange={(event) => updateField("recurrence", event.target.value)} required value={form.recurrence}>
                {recurringExpenseRecurrences.map((recurrence) => (
                  <option key={recurrence.value} value={recurrence.value}>
                    {recurrence.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Start date
              <input onChange={(event) => updateField("startDate", event.target.value)} required type="date" value={form.startDate} />
            </label>
            <label>
              End date
              <input onChange={(event) => updateField("endDate", event.target.value)} type="date" value={form.endDate} />
            </label>
          </div>
          <div className="form-grid single-column">
            <label>
              Notes
              <textarea onChange={(event) => updateField("notes", event.target.value)} rows="3" value={form.notes} />
            </label>
          </div>
        </DataSurface>
        <div className="form-actions">
          <button className="primary-button" disabled={submitting} type="submit">
            {submitting ? "Saving..." : "Save template"}
          </button>
        </div>
      </form>

      <DataSurface aria-label="Recurring expense templates">
        <SurfaceHeader>
          <h2>Templates</h2>
        </SurfaceHeader>
        {state.loading ? (
          <div className="table-placeholder">Loading recurring templates...</div>
        ) : state.templates.length ? (
          <ResponsiveTable>
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>School</th>
                  <th>Category</th>
                  <th>Vendor</th>
                  <th>Amount</th>
                  <th>Recurrence</th>
                  <th>Starts</th>
                  <th>Ends</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {state.templates.map((template) => (
                  <tr key={template.id}>
                    <td>{template.name}</td>
                    <td>{template.schools?.name || "Unknown school"}</td>
                    <td>{template.expense_categories?.name || "Uncategorized"}</td>
                    <td>{template.vendor || "Not set"}</td>
                    <td>{formatExpenseAmount(template.amount, template.currency)}</td>
                    <td>{humanize(template.recurrence)}</td>
                    <td>{formatDate(template.start_date)}</td>
                    <td>{template.end_date ? formatDate(template.end_date) : "No end"}</td>
                    <td>
                      <StatusBadge value={template.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ResponsiveTable>
        ) : (
          <EmptyState title="No recurring templates" description="Rent, YouTube, Microsoft 365, and subscriptions can be added here." />
        )}
      </DataSurface>
    </>
  );
}
