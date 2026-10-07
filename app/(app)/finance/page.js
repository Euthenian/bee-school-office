"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";
import { DataSurface, ResponsiveTable, SurfaceHeader } from "@/components/Surface";
import { useAuth } from "@/components/AuthProvider";
import {
  createStudentMonthlyBillingSnapshots,
  fetchFinanceDashboardSummary,
  fetchOrganizations,
  fetchSchools,
  fetchStudentMonthlyBillingSnapshots,
  fetchStudentMonthlyCollectionCharges,
  fetchStudentMonthlyBillingStopAlerts,
  fetchUnverifiedRicoCancellations,
  verifyRicoCancellation,
  updateStudentMonthlyBillingSnapshot
} from "@/lib/data";
import { formatBillingAmount } from "@/lib/billing";
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
import {
  attachRicoCancellationAlerts,
  createMonthlyBillingFilters,
  filterMonthlyBillingRows,
  getBillingStopAlertLabel,
  getFirstUnbillableMonthLabel,
  getMonthOptions,
  getMonthlyCollectionBreakdown,
  getUpcomingBillingChangeCount,
  getYearOptions,
  monthlyBillingStatusFilters,
  shouldZeroMonthlyBilling,
  syncBillingMonthFromParts
} from "@/lib/monthly-billing";
import { ricoCancellationFilterRequestedEvent, ricoCancellationUpdatedEvent } from "@/lib/navigation-badges";
import { canManageFinance } from "@/lib/roles";
import { getSupabaseBrowserClient } from "@/lib/supabase";

const initialRange = getFinanceDateRange("current_month");
const initialMonthlyFilters = createMonthlyBillingFilters();
const monthOptions = getMonthOptions();
const yearOptions = getYearOptions();

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
  const [monthlyFilters, setMonthlyFilters] = useState(initialMonthlyFilters);
  const [monthlyState, setMonthlyState] = useState({
    alerts: [],
    createResult: null,
    creating: false,
    error: "",
    loading: true,
    savingId: "",
    snapshots: [],
    collectionCharges: [],
    collectionError: "",
    ricoCancellations: [],
    verifyingId: ""
  });
  const [snapshotEdits, setSnapshotEdits] = useState({});
  const [foundation, setFoundation] = useState({ loading: true, organizations: [], schools: [] });
  const [state, setState] = useState({ loading: true, error: "", summaryRows: [] });

  useEffect(() => {
    function showRicoCancellations() {
      setMonthlyFilters((current) => ({ ...current, status: "rico-cancellation" }));
      document.getElementById("monthly-billing")?.scrollIntoView();
    }
    const timer = window.setTimeout(() => {
      if (new URLSearchParams(window.location.search).get("filter") === "rico-cancellation") {
        showRicoCancellations();
      }
    }, 0);
    window.addEventListener(ricoCancellationFilterRequestedEvent, showRicoCancellations);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener(ricoCancellationFilterRequestedEvent, showRicoCancellations);
    };
  }, []);

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
      setMonthlyFilters((current) =>
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

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(async () => {
      const supabase = getSupabaseBrowserClient();
      if (!supabase || !session || !mayManage || !monthlyFilters.organizationId) {
        setMonthlyState((current) => ({ ...current, alerts: [], collectionCharges: [], collectionError: "", loading: false, ricoCancellations: [], snapshots: [] }));
        return;
      }

      setMonthlyState((current) => ({ ...current, loading: true }));
      const [snapshotsResult, alertsResult, ricoResult, chargesResult] = await Promise.all([
        fetchStudentMonthlyBillingSnapshots(supabase, monthlyFilters),
        fetchStudentMonthlyBillingStopAlerts(supabase, monthlyFilters),
        fetchUnverifiedRicoCancellations(supabase, monthlyFilters),
        fetchStudentMonthlyCollectionCharges(supabase, monthlyFilters)
      ]);
      if (!active) return;

      setSnapshotEdits({});
      setMonthlyState((current) => ({
        ...current,
        alerts: alertsResult.data || [],
        collectionCharges: chargesResult.data || [],
        collectionError: chargesResult.error?.message || "",
        error: [snapshotsResult.error, alertsResult.error, ricoResult.error, chargesResult.error]
          .filter(Boolean)
          .map((error) => error.message)
          .join(" "),
        loading: false,
        ricoCancellations: ricoResult.data || [],
        snapshots: snapshotsResult.data || []
      }));
    }, 180);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [mayManage, monthlyFilters, session]);

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
  const monthlyRows = useMemo(
    () => filterMonthlyBillingRows(
      attachRicoCancellationAlerts(monthlyState.snapshots, monthlyState.ricoCancellations, monthlyFilters.billingMonth),
      monthlyFilters
    ),
    [monthlyFilters, monthlyState.snapshots, monthlyState.ricoCancellations]
  );
  const upcomingBillingChangeCount = monthlyState.alerts.length || getUpcomingBillingChangeCount(monthlyState.snapshots);
  const selectedMonthLabel = formatDate(monthlyFilters.billingMonth);

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

  function updateMonthlyFilter(field, value) {
    setMonthlyState((current) => ({ ...current, createResult: null }));
    setMonthlyFilters((current) => {
      const next = {
        ...current,
        [field]: value,
        ...(field === "organizationId" ? { schoolId: "" } : {})
      };

      if (field === "year" || field === "month") {
        return {
          ...next,
          billingMonth: syncBillingMonthFromParts(next)
        };
      }

      return next;
    });
  }

  function updateSnapshotEdit(snapshotId, field, value) {
    setSnapshotEdits((current) => ({
      ...current,
      [snapshotId]: {
        ...(current[snapshotId] || {}),
        [field]: value
      }
    }));
  }

  async function handleCreateMonthlyBilling() {
    const supabase = getSupabaseBrowserClient();
    if (!supabase || !monthlyFilters.organizationId) return;

    const alertPreview = monthlyState.alerts.length
      ? `\n\nUpcoming billing changes:\n${monthlyState.alerts
          .slice(0, 8)
          .map((alert) => `- ${alert.student_name}: ${alert.billing_end_date}`)
          .join("\n")}`
      : "";

    const confirmed = window.confirm(`Create ${selectedMonthLabel} billing snapshots? Existing student/month rows will be skipped.${alertPreview}`);
    if (!confirmed) return;

    setMonthlyState((current) => ({ ...current, creating: true, error: "" }));
    const result = await createStudentMonthlyBillingSnapshots(supabase, monthlyFilters);
    if (result.error) {
      setMonthlyState((current) => ({ ...current, createResult: null, creating: false, error: result.error.message }));
      return;
    }

    const [snapshotsResult, alertsResult, ricoResult, chargesResult] = await Promise.all([
      fetchStudentMonthlyBillingSnapshots(supabase, monthlyFilters),
      fetchStudentMonthlyBillingStopAlerts(supabase, monthlyFilters),
      fetchUnverifiedRicoCancellations(supabase, monthlyFilters),
      fetchStudentMonthlyCollectionCharges(supabase, monthlyFilters)
    ]);

    setSnapshotEdits({});
    setMonthlyState((current) => ({
      ...current,
      alerts: alertsResult.data || [],
      collectionCharges: chargesResult.data || [],
      collectionError: chargesResult.error?.message || "",
      createResult: result.data,
      creating: false,
      error: [snapshotsResult.error, alertsResult.error, ricoResult.error, chargesResult.error]
        .filter(Boolean)
        .map((error) => error.message)
        .join(" "),
      ricoCancellations: ricoResult.data || [],
      snapshots: snapshotsResult.data || []
    }));
  }

  async function handleVerifyRicoCancellation(row) {
    if (!row.ricoCancellation || !mayManage) return;
    const studentName = [row.student_last_name, row.student_first_name].filter(Boolean).join(" ") || row.student_preferred_name;
    if (!window.confirm(`Confirm that RICO direct debit cancellation has been checked for ${studentName}?`)) return;

    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;
    setMonthlyState((current) => ({ ...current, error: "", verifyingId: row.ricoCancellation.profile_id }));
    const result = await verifyRicoCancellation(supabase, row.ricoCancellation.profile_id, monthlyFilters.billingMonth);
    if (result.error) {
      setMonthlyState((current) => ({ ...current, error: result.error.message, verifyingId: "" }));
      return;
    }

    const refreshed = await fetchUnverifiedRicoCancellations(supabase, monthlyFilters);
    setMonthlyState((current) => ({
      ...current,
      error: refreshed.error?.message || "",
      ricoCancellations: refreshed.data || [],
      verifyingId: ""
    }));
    window.dispatchEvent(new Event(ricoCancellationUpdatedEvent));
  }

  async function handleSaveMonthlySnapshot(row) {
    const supabase = getSupabaseBrowserClient();
    if (!supabase || !row.id) return;

    const edit = snapshotEdits[row.id] || {};
    setMonthlyState((current) => ({ ...current, error: "", savingId: row.id }));
    const result = await updateStudentMonthlyBillingSnapshot(supabase, row.id, {
      comment: edit.comment ?? row.comment ?? "",
      finalAmount: edit.finalAmount ?? row.final_amount,
      overrideReason: edit.overrideReason ?? row.override_reason ?? "",
      refundAmount: edit.refundAmount ?? row.refund_amount
    });

    if (result.error) {
      setMonthlyState((current) => ({ ...current, error: result.error.message, savingId: "" }));
      return;
    }

    const snapshotsResult = await fetchStudentMonthlyBillingSnapshots(supabase, monthlyFilters);
    setSnapshotEdits((current) => {
      const next = { ...current };
      delete next[row.id];
      return next;
    });
    setMonthlyState((current) => ({
      ...current,
      error: snapshotsResult.error ? snapshotsResult.error.message : "",
      savingId: "",
      snapshots: snapshotsResult.data || []
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
        actions={
          <Link className="secondary-button" href="/finance/monthly-payments/">
            Monthly payments
          </Link>
        }
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
      {monthlyState.error ? <p className="inline-alert">{monthlyState.error}</p> : null}

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

      <DataSurface aria-label="Monthly student billing" id="monthly-billing">
        <SurfaceHeader
          actions={
            <button className="primary-button" disabled={monthlyState.creating || !monthlyFilters.organizationId} onClick={handleCreateMonthlyBilling} type="button">
              {monthlyState.creating ? "Creating..." : `Create ${selectedMonthLabel} billing`}
            </button>
          }
        >
          <div>
            <p className="eyebrow">Student billing snapshots</p>
            <h2>Monthly Billing</h2>
          </div>
        </SurfaceHeader>

        {upcomingBillingChangeCount ? (
          <button
            className="billing-alert-button"
            onClick={() => updateMonthlyFilter("status", "upcoming_change")}
            type="button"
          >
            <span className="upcoming-trial-lesson-indicator">
              <span aria-hidden="true" className="upcoming-trial-lesson-star">
                ★
              </span>
              <span className="status-badge upcoming-trial-lesson-pill">
                ★ {upcomingBillingChangeCount} upcoming billing changes
              </span>
            </span>
          </button>
        ) : null}

        <div className="form-grid monthly-billing-filters">
          <label>
            Organization
            <select onChange={(event) => updateMonthlyFilter("organizationId", event.target.value)} value={monthlyFilters.organizationId}>
              {organizationOptions.map((organization) => (
                <option key={organization.id} value={organization.id}>
                  {organization.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            School
            <select onChange={(event) => updateMonthlyFilter("schoolId", event.target.value)} value={monthlyFilters.schoolId}>
              <option value="">All schools</option>
              {schoolOptions.map((school) => (
                <option key={school.id} value={school.id}>
                  {school.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Year
            <select onChange={(event) => updateMonthlyFilter("year", event.target.value)} value={monthlyFilters.year}>
              {yearOptions.map((year) => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </select>
          </label>
          <label>
            Month
            <select onChange={(event) => updateMonthlyFilter("month", event.target.value)} value={monthlyFilters.month}>
              {monthOptions.map((month) => (
                <option key={month.value} value={month.value}>
                  {month.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Search
            <input onChange={(event) => updateMonthlyFilter("search", event.target.value)} value={monthlyFilters.search} />
          </label>
          <label>
            Filter
            <select onChange={(event) => updateMonthlyFilter("status", event.target.value)} value={monthlyFilters.status}>
              {monthlyBillingStatusFilters.map((status) => (
                <option key={status.value} value={status.value}>
                  {status.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        {monthlyState.createResult ? (
          <p className="inline-success">
            Created {monthlyState.createResult.inserted_count} new rows, skipped {monthlyState.createResult.existing_count} existing rows,
            and generated {monthlyState.createResult.zero_amount_count} zero-yen rows.
          </p>
        ) : null}

        {monthlyState.loading ? (
          <div className="table-placeholder">Loading monthly billing...</div>
        ) : monthlyRows.length ? (
          <ResponsiveTable>
            <table>
              <thead>
                <tr>
                  <th>Student</th>
                  <th>Default fee</th>
                  <th>{selectedMonthLabel} payment</th>
                  <th>Amount to charge</th>
                  <th>Comment</th>
                  <th>Refund</th>
                  <th>Status / alerts</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {monthlyRows.map((row) => {
                  const edit = snapshotEdits[row.id] || {};
                  const alertLabel = getBillingStopAlertLabel(row.billing_change_timing);
                  const studentName = [row.student_last_name, row.student_first_name].filter(Boolean).join(" ") || row.student_preferred_name;
                  const collection = getMonthlyCollectionBreakdown(row, monthlyState.collectionCharges);

                  return (
                    <tr className={row.ricoCancellation ? "monthly-billing-rico-warning" : ""} key={row.id || `rico-${row.student_id}`}>
                      <td>
                        <strong>{studentName}</strong>
                        <br />
                        <span className="muted-text">{row.school_name}</span>
                      </td>
                      <td>
                        <div>{formatBillingAmount(row.default_monthly_fee_yen, row.currency)}</div>
                        <span className="muted-text">Snapshot base {formatBillingAmount(row.base_amount, row.currency)}</span>
                      </td>
                      <td>
                        {row.id ? (
                          <input
                            className="monthly-billing-amount-input"
                            inputMode="decimal"
                            onChange={(event) => updateSnapshotEdit(row.id, "finalAmount", event.target.value)}
                            value={edit.finalAmount ?? row.final_amount}
                          />
                        ) : formatBillingAmount(row.final_amount, row.currency)}
                      </td>
                      <td>
                        {monthlyState.collectionError ? <span className="inline-alert">Amount unavailable</span> : (
                          <>
                            <strong>{formatBillingAmount(collection.amountToCharge, row.currency)}</strong>
                            <details>
                              <summary>Breakdown</summary>
                              <div>Monthly tuition: {formatBillingAmount(collection.monthlyTuition, row.currency)}</div>
                              {collection.additionalCharges.map((charge) => (
                                <div key={charge.charge_id}>{charge.description}: {formatBillingAmount(charge.balance, row.currency)}</div>
                              ))}
                              <div>Additional charges: {formatBillingAmount(collection.additionalAmount, row.currency)}</div>
                              <strong>Amount to charge: {formatBillingAmount(collection.amountToCharge, row.currency)}</strong>
                            </details>
                            {collection.legacyCharges.length ? (
                              <div className="muted-text">
                                {collection.legacyCharges.length} unclassified charge(s) excluded. Review in student billing.
                              </div>
                            ) : null}
                          </>
                        )}
                      </td>
                      <td>
                        {row.id ? (
                          <textarea
                            className="monthly-billing-comment"
                            onChange={(event) => updateSnapshotEdit(row.id, "comment", event.target.value)}
                            rows="2"
                            value={edit.comment ?? row.comment ?? ""}
                          />
                        ) : <span className="muted-text">No snapshot for this month</span>}
                      </td>
                      <td>
                        {row.id ? (
                          <input
                            className="monthly-billing-amount-input"
                            inputMode="decimal"
                            onChange={(event) => updateSnapshotEdit(row.id, "refundAmount", event.target.value)}
                            value={edit.refundAmount ?? row.refund_amount}
                          />
                        ) : formatBillingAmount(0, row.currency)}
                      </td>
                      <td>
                        <StatusStack alertLabel={alertLabel} row={row} />
                      </td>
                      <td>
                        {row.id ? (
                          <button
                            className="secondary-button"
                            disabled={monthlyState.savingId === row.id}
                            onClick={() => handleSaveMonthlySnapshot(row)}
                            type="button"
                          >
                            {monthlyState.savingId === row.id ? "Saving..." : "Save"}
                          </button>
                        ) : null}
                        {row.ricoCancellation ? (
                          <button
                            className="secondary-button"
                            disabled={monthlyState.verifyingId === row.ricoCancellation.profile_id}
                            onClick={() => handleVerifyRicoCancellation(row)}
                            type="button"
                          >
                            {monthlyState.verifyingId === row.ricoCancellation.profile_id ? "Verifying..." : "Mark RICO cancellation verified"}
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </ResponsiveTable>
        ) : (
          <EmptyState
            title="No monthly billing snapshots"
            description="Create the selected month to copy each student's current default fee into editable monthly records."
          />
        )}
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

function StatusStack({ alertLabel, row }) {
  return (
    <div className="monthly-billing-status-stack">
      {row.ricoCancellation ? <span className="status-badge rico-cancellation-status">RICO cancellation to verify</span> : null}
      {row.ricoCancellation ? (
        <span className="rico-cancellation-instruction">
          Do not charge from {getFirstUnbillableMonthLabel(row.ricoCancellation.billing_end_date)}
        </span>
      ) : null}
      {alertLabel ? (
        <span className="upcoming-trial-lesson-indicator">
          <span aria-hidden="true" className="upcoming-trial-lesson-star">
            ★
          </span>
          <span className="status-badge upcoming-trial-lesson-pill">{alertLabel}</span>
        </span>
      ) : null}
      <span className={`status-badge ${row.student_status}`}>{row.student_status}</span>
      {row.manual_override ? <span className="status-badge manual_review">Manual override</span> : null}
      {row.current_billing_end_date ? (
        <span className="muted-text">
          Billing {shouldZeroMonthlyBilling(row.current_billing_end_date, row.billing_month) ? "ended" : "ends"} {formatDate(row.current_billing_end_date)}
        </span>
      ) : null}
    </div>
  );
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
