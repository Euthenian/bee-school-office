"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";
import { DataSurface, ResponsiveTable, SurfaceHeader } from "@/components/Surface";
import { useAuth } from "@/components/AuthProvider";
import { fetchFinanceDashboardSummary, fetchOrganizations, fetchSchools } from "@/lib/data";
import {
  financeDateRangePresets,
  formatFinanceAmount,
  getFinanceDateRange,
  getFinanceOrganizationOptions,
  getFinanceResultTone,
  getFinanceSchoolOptions,
  getPrimaryFinanceSummary
} from "@/lib/finance";
import { formatDate } from "@/lib/format";
import { canManageFinance } from "@/lib/roles";
import { getSupabaseBrowserClient } from "@/lib/supabase";

const initialRange = getFinanceDateRange("current_month");

export default function FinancePage() {
  const { profile, session } = useAuth();
  const mayManage = canManageFinance(profile);
  const [filters, setFilters] = useState({
    dateFrom: initialRange.dateFrom,
    dateTo: initialRange.dateTo,
    organizationId: "",
    periodPreset: "current_month",
    schoolId: ""
  });
  const [foundation, setFoundation] = useState({ loading: true, organizations: [], schools: [] });
  const [state, setState] = useState({ loading: true, error: "", summaryRows: [] });

  useEffect(() => {
    let active = true;

    async function loadFoundation() {
      const supabase = getSupabaseBrowserClient();
      if (!supabase || !session || !mayManage) {
        setFoundation({ loading: false, organizations: [], schools: [] });
        return;
      }

      const [organizationsResult, schoolsResult] = await Promise.all([fetchOrganizations(supabase), fetchSchools(supabase)]);
      if (!active) return;

      const organizations = organizationsResult.data || [];
      const schools = schoolsResult.data || [];
      const organizationOptions = getFinanceOrganizationOptions(profile, organizations);
      const selectedOrganizationId = organizationOptions.some((organization) => organization.id === filters.organizationId)
        ? filters.organizationId
        : organizationOptions[0]?.id || "";

      setFoundation({ loading: false, organizations, schools });
      setFilters((current) =>
        current.organizationId === selectedOrganizationId
          ? current
          : {
              ...current,
              organizationId: selectedOrganizationId,
              schoolId: ""
            }
      );

      const loadError = [organizationsResult.error, schoolsResult.error]
        .filter(Boolean)
        .map((error) => error.message)
        .join(" ");
      if (loadError) {
        setState((current) => ({ ...current, error: loadError, loading: false }));
      }
    }

    loadFoundation();

    return () => {
      active = false;
    };
  }, [filters.organizationId, mayManage, profile, session]);

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(async () => {
      const supabase = getSupabaseBrowserClient();
      if (!supabase || !session || !mayManage || !filters.organizationId) {
        setState({ loading: false, error: "", summaryRows: [] });
        return;
      }

      setState((current) => ({ ...current, loading: true }));
      const { data, error } = await fetchFinanceDashboardSummary(supabase, {
        asOfDate: new Date().toISOString().slice(0, 10),
        dateFrom: filters.dateFrom,
        dateTo: filters.dateTo,
        organizationId: filters.organizationId,
        schoolId: filters.schoolId
      });
      if (!active) return;

      setState({
        loading: false,
        error: error ? error.message : "",
        summaryRows: data || []
      });
    }, 180);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [filters, mayManage, session]);

  const organizationOptions = useMemo(
    () => getFinanceOrganizationOptions(profile, foundation.organizations),
    [foundation.organizations, profile]
  );
  const schoolOptions = useMemo(
    () => getFinanceSchoolOptions(foundation.schools, filters.organizationId),
    [filters.organizationId, foundation.schools]
  );
  const selectedOrganization = organizationOptions.find((organization) => organization.id === filters.organizationId);
  const selectedSchool = schoolOptions.find((school) => school.id === filters.schoolId);
  const selectedTimeZone = selectedSchool?.timezone || schoolOptions[0]?.timezone || "Asia/Tokyo";
  const summary = getPrimaryFinanceSummary(state.summaryRows);
  const loading = foundation.loading || state.loading;
  const periodLabel = `${formatDate(filters.dateFrom)} - ${formatDate(filters.dateTo)}`;

  function updatePeriodPreset(value) {
    if (value === "custom") {
      setFilters((current) => ({ ...current, periodPreset: value }));
      return;
    }

    const range = getFinanceDateRange(value, new Date(), selectedTimeZone);
    setFilters((current) => ({
      ...current,
      dateFrom: range.dateFrom,
      dateTo: range.dateTo,
      periodPreset: value
    }));
  }

  function updateFilter(field, value) {
    setFilters((current) => ({
      ...current,
      [field]: value,
      ...(field === "organizationId" ? { schoolId: "" } : {})
    }));
  }

  function updateDateFilter(field, value) {
    setFilters((current) => ({
      ...current,
      [field]: value,
      periodPreset: "custom"
    }));
  }

  if (!mayManage) {
    return (
      <>
        <PageHeader eyebrow="Restricted admin" title="Finance" />
        <DataSurface>
          <EmptyState title="Finance is restricted" description="Your current role cannot access financial overview data." />
        </DataSurface>
      </>
    );
  }

  if (!foundation.loading && !organizationOptions.length) {
    return (
      <>
        <PageHeader eyebrow="Restricted admin" title="Finance" />
        <DataSurface>
          <EmptyState title="No finance organization" description="No super-admin organization is available for this account." />
        </DataSurface>
      </>
    );
  }

  return (
    <>
      <PageHeader
        eyebrow="Restricted admin"
        title="Finance"
        description="A management overview of student cash, payroll cash, and operating expenses."
      />

      <DataSurface>
        <SurfaceHeader>
          <h2>Filters</h2>
        </SurfaceHeader>
        <div className="form-grid">
          <label>
            Organization
            <select onChange={(event) => updateFilter("organizationId", event.target.value)} value={filters.organizationId}>
              {organizationOptions.map((organization) => (
                <option key={organization.id} value={organization.id}>
                  {organization.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            School
            <select onChange={(event) => updateFilter("schoolId", event.target.value)} value={filters.schoolId}>
              <option value="">All schools</option>
              {schoolOptions.map((school) => (
                <option key={school.id} value={school.id}>
                  {school.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Period
            <select onChange={(event) => updatePeriodPreset(event.target.value)} value={filters.periodPreset}>
              {financeDateRangePresets.map((preset) => (
                <option key={preset.value} value={preset.value}>
                  {preset.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Date from
            <input onChange={(event) => updateDateFilter("dateFrom", event.target.value)} type="date" value={filters.dateFrom} />
          </label>
          <label>
            Date to
            <input onChange={(event) => updateDateFilter("dateTo", event.target.value)} type="date" value={filters.dateTo} />
          </label>
        </div>
      </DataSurface>

      {state.error ? <p className="inline-alert">{state.error}</p> : null}

      <section className="metric-grid" aria-label="Finance metrics">
        <FinanceMetricCard
          href="/billing/"
          label="Student cash received"
          loading={loading}
          value={formatFinanceAmount(summary.student_cash_received, summary.currency)}
        />
        <FinanceMetricCard
          href="/billing/"
          label="Refunds"
          loading={loading}
          tone="negative"
          value={formatFinanceAmount(summary.student_refunds, summary.currency)}
        />
        <FinanceMetricCard
          href="/billing/"
          label="Net student revenue"
          loading={loading}
          tone={getFinanceResultTone(summary.net_student_cash_revenue)}
          value={formatFinanceAmount(summary.net_student_cash_revenue, summary.currency)}
        />
        <FinanceMetricCard
          href="/billing/"
          label="Outstanding receivables"
          loading={loading}
          value={formatFinanceAmount(summary.outstanding_receivables, summary.currency)}
        />
        <FinanceMetricCard
          href="/billing/"
          label="Overdue receivables"
          loading={loading}
          tone={summary.overdue_receivables > 0 ? "negative" : "neutral"}
          value={formatFinanceAmount(summary.overdue_receivables, summary.currency)}
        />
        <FinanceMetricCard
          href="/payroll/"
          label="Payroll paid"
          loading={loading}
          tone="negative"
          value={formatFinanceAmount(summary.payroll_paid, summary.currency)}
        />
        <FinanceMetricCard
          href="/payroll/"
          label="Payroll payable"
          loading={loading}
          value={formatFinanceAmount(summary.payroll_accrued_net_payable, summary.currency)}
        />
        <FinanceMetricCard
          href="/expenses/"
          label="Operating expenses"
          loading={loading}
          tone="negative"
          value={formatFinanceAmount(summary.operating_expenses, summary.currency)}
        />
        <FinanceMetricCard
          label="Cash operating result"
          loading={loading}
          tone={getFinanceResultTone(summary.cash_operating_result)}
          value={formatFinanceAmount(summary.cash_operating_result, summary.currency)}
        />
      </section>

      <div className="finance-breakdown-grid">
        <DataSurface>
          <SurfaceHeader
            actions={
              <Link className="secondary-button" href="/billing/">
                Billing
              </Link>
            }
          >
            <div>
              <p className="eyebrow">Revenue</p>
              <h2>Student Money</h2>
            </div>
          </SurfaceHeader>
          <BreakdownList
            currency={summary.currency}
            rows={[
              ["Payments received", summary.student_cash_received],
              ["Refunds", summary.student_refunds],
              ["Net cash revenue", summary.net_student_cash_revenue],
              ["Charges created", summary.student_charges_created],
              ["Service-period charges", summary.student_service_period_charges],
              ["Outstanding receivables", summary.outstanding_receivables],
              ["Overdue receivables", summary.overdue_receivables],
              ["Unallocated payments", summary.unallocated_student_payments]
            ]}
          />
        </DataSurface>

        <DataSurface>
          <SurfaceHeader
            actions={
              <Link className="secondary-button" href="/payroll/">
                Payroll
              </Link>
            }
          >
            <div>
              <p className="eyebrow">Payroll</p>
              <h2>Staff Pay</h2>
            </div>
          </SurfaceHeader>
          <BreakdownList
            currency={summary.currency}
            rows={[
              ["Paid in period", summary.payroll_paid],
              ["Accrued net payable", summary.payroll_accrued_net_payable],
              ["Payroll payments", summary.payroll_payment_count, "count"],
              ["Payroll entries", summary.payroll_entry_count, "count"]
            ]}
          />
        </DataSurface>

        <DataSurface>
          <SurfaceHeader
            actions={
              <Link className="secondary-button" href="/expenses/">
                Expenses
              </Link>
            }
          >
            <div>
              <p className="eyebrow">Expenses</p>
              <h2>Operating Costs</h2>
            </div>
          </SurfaceHeader>
          <BreakdownList
            currency={summary.currency}
            rows={[
              ["Active expenses", summary.operating_expenses],
              ["Tax amount", summary.operating_expense_tax],
              ["Expense rows", summary.expense_count, "count"]
            ]}
          />
        </DataSurface>
      </div>

      <DataSurface aria-label="Finance calculation">
        <SurfaceHeader>
          <div>
            <p className="eyebrow">{selectedOrganization?.name || "Organization"} / {summary.school_name}</p>
            <h2>Operating Result</h2>
          </div>
        </SurfaceHeader>
        <dl className="detail-list">
          <div>
            <dt>Selected period</dt>
            <dd>{periodLabel}</dd>
          </div>
          <div>
            <dt>Cash model</dt>
            <dd>
              {formatFinanceAmount(summary.net_student_cash_revenue, summary.currency)} -{" "}
              {formatFinanceAmount(summary.payroll_paid, summary.currency)} -{" "}
              {formatFinanceAmount(summary.operating_expenses, summary.currency)} ={" "}
              <strong className={`finance-result-text ${getFinanceResultTone(summary.cash_operating_result)}`}>
                {formatFinanceAmount(summary.cash_operating_result, summary.currency)}
              </strong>
            </dd>
          </div>
          <div>
            <dt>Accrual view</dt>
            <dd>
              {formatFinanceAmount(summary.student_service_period_charges, summary.currency)} -{" "}
              {formatFinanceAmount(summary.payroll_accrued_net_payable, summary.currency)} -{" "}
              {formatFinanceAmount(summary.operating_expenses, summary.currency)} ={" "}
              <strong className={`finance-result-text ${getFinanceResultTone(summary.accrual_operating_result)}`}>
                {formatFinanceAmount(summary.accrual_operating_result, summary.currency)}
              </strong>
            </dd>
          </div>
        </dl>
      </DataSurface>

      <DataSurface aria-label="Expense category breakdown">
        <SurfaceHeader>
          <h2>Expense Breakdown By Category</h2>
        </SurfaceHeader>
        <ExpenseCategoryBreakdown
          currency={summary.currency}
          loading={loading}
          rows={summary.expense_category_totals}
        />
      </DataSurface>
    </>
  );
}

function FinanceMetricCard({ href, label, loading, tone = "neutral", value }) {
  const content = (
    <>
      <p>{label}</p>
      <strong>{loading ? "..." : value}</strong>
    </>
  );
  const className = `metric-card finance-metric-card ${tone}`;

  if (href) {
    return (
      <Link aria-label={`${label} drilldown`} className={className} href={href}>
        {content}
      </Link>
    );
  }

  return <article className={className}>{content}</article>;
}

function BreakdownList({ currency, rows }) {
  return (
    <dl className="detail-list">
      {rows.map(([label, value, kind]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{kind === "count" ? value : formatFinanceAmount(value, currency)}</dd>
        </div>
      ))}
    </dl>
  );
}

function ExpenseCategoryBreakdown({ currency, loading, rows }) {
  if (loading) {
    return <div className="table-placeholder">Loading finance totals...</div>;
  }

  if (!rows.length) {
    return <EmptyState title="No expense categories" description="No active expenses match the current Finance filters." />;
  }

  return (
    <ResponsiveTable>
      <table>
        <thead>
          <tr>
            <th>Category</th>
            <th>Amount</th>
            <th>Tax</th>
            <th>Rows</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.category_id || row.category_code || row.category_name}>
              <td>{row.category_name}</td>
              <td>{formatFinanceAmount(row.amount, currency)}</td>
              <td>{formatFinanceAmount(row.tax_amount, currency)}</td>
              <td>{row.expense_count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </ResponsiveTable>
  );
}
