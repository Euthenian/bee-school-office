"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { DataSurface, MetricCard, ResponsiveTable, SurfaceHeader } from "@/components/Surface";
import { useAuth } from "@/components/AuthProvider";
import {
  expensePaymentMethods,
  expenseStatuses,
  formatExpenseAmount,
  getPrimaryExpenseSummary,
  isExpenseCategoryAvailableForSchool
} from "@/lib/expenses";
import { fetchExpenseCategories, fetchExpenses, fetchExpenseSummary, fetchSchools } from "@/lib/data";
import { formatDate, humanize } from "@/lib/format";
import { canManageExpenses } from "@/lib/roles";
import { getSupabaseBrowserClient } from "@/lib/supabase";

export default function ExpensesPage() {
  const { profile, session } = useAuth();
  const mayManage = canManageExpenses(profile);
  const [filters, setFilters] = useState({
    categoryId: "",
    dateFrom: "",
    dateTo: "",
    paymentMethod: "all",
    schoolId: "",
    search: "",
    status: "active",
    vendor: ""
  });
  const [state, setState] = useState({
    categories: [],
    error: "",
    expenses: [],
    loading: true,
    schools: [],
    summary: []
  });

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(async () => {
      const supabase = getSupabaseBrowserClient();
      if (!supabase || !session || !mayManage) {
        setState({ categories: [], error: "", expenses: [], loading: false, schools: [], summary: [] });
        return;
      }

      setState((current) => ({ ...current, loading: true }));
      const [expensesResult, categoriesResult, schoolsResult, summaryResult] = await Promise.all([
        fetchExpenses(supabase, filters),
        fetchExpenseCategories(supabase, { status: "active" }),
        fetchSchools(supabase),
        fetchExpenseSummary(supabase, filters)
      ]);
      if (!active) return;

      const loadError = [expensesResult.error, categoriesResult.error, schoolsResult.error, summaryResult.error]
        .filter(Boolean)
        .map((error) => error.message)
        .join(" ");

      setState({
        categories: categoriesResult.data || [],
        error: loadError,
        expenses: expensesResult.data || [],
        loading: false,
        schools: schoolsResult.data || [],
        summary: summaryResult.data || []
      });
    }, 180);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [filters, mayManage, session]);

  const summary = getPrimaryExpenseSummary(state.summary);
  const categoryTotals = Array.isArray(summary.category_totals) ? summary.category_totals : [];
  const schoolTotals = Array.isArray(summary.school_totals) ? summary.school_totals : [];
  const availableCategories = useMemo(
    () =>
      state.categories.filter(
        (category) => !filters.schoolId || isExpenseCategoryAvailableForSchool(category, filters.schoolId)
      ),
    [filters.schoolId, state.categories]
  );

  function updateFilter(field, value) {
    setFilters((current) => {
      const next = { ...current, [field]: value };
      if (field === "schoolId") {
        const categoryStillAvailable = state.categories.some(
          (category) => category.id === current.categoryId && isExpenseCategoryAvailableForSchool(category, value)
        );
        if (!categoryStillAvailable) {
          next.categoryId = "";
        }
      }
      return next;
    });
  }

  if (!mayManage) {
    return (
      <>
        <PageHeader eyebrow="Restricted admin" title="Expenses" />
        <DataSurface>
          <EmptyState title="Expenses are restricted" description="Your current role cannot access expense records." />
        </DataSurface>
      </>
    );
  }

  return (
    <>
      <PageHeader
        eyebrow="Restricted admin"
        title="Expenses"
        description="Manage operational expenses separately from Payroll and Student Billing."
        actions={
          <Link className="primary-button" href="/expenses/new/">
            Add expense
          </Link>
        }
      />

      <DataSurface>
        <SurfaceHeader>
          <h2>Filters</h2>
        </SurfaceHeader>
        <div className="form-grid">
          <label>
            Search
            <input
              onChange={(event) => updateFilter("search", event.target.value)}
              placeholder="Description, vendor, reference"
              type="search"
              value={filters.search}
            />
          </label>
          <label>
            Vendor
            <input onChange={(event) => updateFilter("vendor", event.target.value)} value={filters.vendor} />
          </label>
          <label>
            School
            <select onChange={(event) => updateFilter("schoolId", event.target.value)} value={filters.schoolId}>
              <option value="">All schools</option>
              {state.schools.map((school) => (
                <option key={school.id} value={school.id}>
                  {school.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Category
            <select onChange={(event) => updateFilter("categoryId", event.target.value)} value={filters.categoryId}>
              <option value="">All categories</option>
              {availableCategories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Payment method
            <select onChange={(event) => updateFilter("paymentMethod", event.target.value)} value={filters.paymentMethod}>
              <option value="all">All methods</option>
              {expensePaymentMethods.map((method) => (
                <option key={method.value} value={method.value}>
                  {method.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Status
            <select onChange={(event) => updateFilter("status", event.target.value)} value={filters.status}>
              <option value="all">All statuses</option>
              {expenseStatuses.map((status) => (
                <option key={status.value} value={status.value}>
                  {status.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Date from
            <input onChange={(event) => updateFilter("dateFrom", event.target.value)} type="date" value={filters.dateFrom} />
          </label>
          <label>
            Date to
            <input onChange={(event) => updateFilter("dateTo", event.target.value)} type="date" value={filters.dateTo} />
          </label>
        </div>
      </DataSurface>

      {state.error ? <p className="inline-alert">{state.error}</p> : null}

      <div className="metric-grid">
        <MetricCard label="Total expenses" loading={state.loading} value={formatExpenseAmount(summary.total_expenses, summary.currency)} />
        <MetricCard label="Total tax" loading={state.loading} value={formatExpenseAmount(summary.total_tax, summary.currency)} />
        <MetricCard label="Expense rows" loading={state.loading} value={summary.expense_count || 0} />
      </div>

      <DataSurface aria-label="Expense list">
        <SurfaceHeader>
          <h2>Expense List</h2>
        </SurfaceHeader>
        {state.loading ? (
          <div className="table-placeholder">Loading expenses...</div>
        ) : state.expenses.length ? (
          <ResponsiveTable>
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>School</th>
                  <th>Category</th>
                  <th>Vendor</th>
                  <th>Description</th>
                  <th>Amount</th>
                  <th>Tax</th>
                  <th>Payment method</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {state.expenses.map((expense) => (
                  <tr key={expense.id}>
                    <td>{formatDate(expense.expense_date)}</td>
                    <td>{expense.schools?.name || "Unknown school"}</td>
                    <td>{expense.expense_categories?.name || "Uncategorized"}</td>
                    <td>{expense.vendor || "Not set"}</td>
                    <td>{expense.description}</td>
                    <td>{formatExpenseAmount(expense.amount, expense.currency)}</td>
                    <td>{formatExpenseAmount(expense.tax_amount || 0, expense.currency)}</td>
                    <td>{humanize(expense.payment_method)}</td>
                    <td>
                      <StatusBadge value={expense.status} />
                    </td>
                    <td>
                      <Link className="secondary-button" href={`/expenses/detail/?id=${expense.id}`}>
                        Open
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ResponsiveTable>
        ) : (
          <EmptyState title="No expenses" description="No visible expenses match the current filters." />
        )}
      </DataSurface>

      <div className="profile-grid">
        <DataSurface>
          <SurfaceHeader>
            <h2>By Category</h2>
          </SurfaceHeader>
          <TotalsList rows={categoryTotals} labelKey="category_name" currency={summary.currency} />
        </DataSurface>

        <DataSurface>
          <SurfaceHeader>
            <h2>By School</h2>
          </SurfaceHeader>
          <TotalsList rows={schoolTotals} labelKey="school_name" currency={summary.currency} />
        </DataSurface>
      </div>
    </>
  );
}

function TotalsList({ currency, labelKey, rows }) {
  if (!rows.length) {
    return <EmptyState title="No totals" description="No summary rows are available for the current filters." />;
  }

  return (
    <div className="stack-list">
      {rows.map((row) => (
        <article className="list-card" key={row.category_id || row.school_id || row[labelKey]}>
          <div className="list-card-header">
            <strong>{row[labelKey]}</strong>
            <span>{formatExpenseAmount(row.amount, currency)}</span>
          </div>
          <span>{row.expense_count} rows / tax {formatExpenseAmount(row.tax_amount, currency)}</span>
        </article>
      ))}
    </div>
  );
}
