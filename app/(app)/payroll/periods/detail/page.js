"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";
import { PayrollPeriodForm } from "@/components/PayrollPeriodForm";
import { StatusBadge } from "@/components/StatusBadge";
import { DataSurface, ResponsiveTable, SurfaceHeader } from "@/components/Surface";
import { useAuth } from "@/components/AuthProvider";
import { fetchPayrollPeriod, updatePayrollPeriod } from "@/lib/data";
import { formatDate, humanize } from "@/lib/format";
import {
  createPayrollPeriodForm,
  formatPayrollAmount,
  getPayrollEntryPaidTotal,
  getPayrollEntryPaymentStatus
} from "@/lib/payroll";
import { canManagePayroll } from "@/lib/roles";
import { formatStaffName } from "@/lib/staff";
import { getSupabaseBrowserClient } from "@/lib/supabase";

export default function PayrollPeriodDetailPage() {
  return (
    <Suspense fallback={<PayrollPeriodLoading />}>
      <PayrollPeriodDetailContent />
    </Suspense>
  );
}

function PayrollPeriodDetailContent() {
  const { profile, session } = useAuth();
  const searchParams = useSearchParams();
  const periodId = searchParams.get("id") || "";
  const mayManage = canManagePayroll(profile);
  const [state, setState] = useState({ loading: true, error: "", success: "", period: null });
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let active = true;

    async function loadPeriod() {
      const supabase = getSupabaseBrowserClient();
      if (!supabase || !session || !periodId || !mayManage) {
        setState({ loading: false, error: "", success: "", period: null });
        return;
      }

      setState((current) => ({ ...current, loading: true, error: "", success: "" }));
      const { data, error } = await fetchPayrollPeriod(supabase, periodId);
      if (!active) return;

      setState({
        loading: false,
        error: error ? error.message : "",
        success: "",
        period: data || null
      });
    }

    loadPeriod();

    return () => {
      active = false;
    };
  }, [mayManage, periodId, session]);

  async function reloadPeriod(supabase, successMessage = "") {
    const { data, error } = await fetchPayrollPeriod(supabase, periodId);
    setState({
      loading: false,
      error: error ? error.message : "",
      success: successMessage,
      period: data || null
    });
  }

  async function handlePeriodUpdate(form) {
    setSubmitting(true);
    setState((current) => ({ ...current, error: "", success: "" }));

    const supabase = getSupabaseBrowserClient();
    if (!supabase || !session || !periodId) {
      setState((current) => ({ ...current, error: "You must be signed in before editing a payroll period." }));
      setSubmitting(false);
      return;
    }

    const { error } = await updatePayrollPeriod(supabase, { payrollPeriodId: periodId, ...form });
    if (error) {
      setState((current) => ({ ...current, error: error.message }));
      setSubmitting(false);
      return;
    }

    await reloadPeriod(supabase, "Payroll period saved.");
    setSubmitting(false);
  }

  if (!mayManage) {
    return (
      <>
        <PageHeader eyebrow="Restricted admin" title="Payroll Period" />
        <DataSurface>
          <EmptyState title="Payroll is restricted" description="Your current role cannot access payroll periods." />
        </DataSurface>
      </>
    );
  }

  if (!periodId && !state.loading) {
    return (
      <>
        <PageHeader eyebrow="Restricted admin" title="Payroll period not selected" />
        <EmptyState title="No payroll period ID was provided" description="Open a period from Payroll." />
      </>
    );
  }

  if (state.loading) {
    return <PayrollPeriodLoading />;
  }

  if (state.error && !state.period) {
    return (
      <>
        <PageHeader eyebrow="Restricted admin" title="Payroll period unavailable" />
        <p className="inline-alert">{state.error}</p>
        <Link className="secondary-button" href="/payroll/">
          Back to payroll
        </Link>
      </>
    );
  }

  if (!state.period) {
    return (
      <>
        <PageHeader eyebrow="Restricted admin" title="Payroll period unavailable" />
        <p className="inline-alert">This payroll period could not be found or is not visible to your role.</p>
        <Link className="secondary-button" href="/payroll/">
          Back to payroll
        </Link>
      </>
    );
  }

  const period = state.period;
  const entries = period.payroll_entries || [];
  const periodForm = createPayrollPeriodForm(period, period.organization_id);
  const totals = getPeriodTotals(period);

  return (
    <>
      <PageHeader
        eyebrow="Restricted admin"
        title={`${formatDate(period.period_start)} - ${formatDate(period.period_end)}`}
        description={period.scope === "school" ? period.schools?.name || "School payroll period" : period.organizations?.name || "Organization payroll period"}
        actions={
          <div className="form-actions">
            <StatusBadge value={period.status} />
            <Link className="secondary-button" href="/payroll/">
              Back to payroll
            </Link>
            <Link className="primary-button" href={`/payroll/entries/new/?periodId=${period.id}`}>
              Add entry
            </Link>
          </div>
        }
      />

      {state.error ? <p className="inline-alert">{state.error}</p> : null}
      {state.success ? <p className="inline-success">{state.success}</p> : null}

      <div className="metric-grid">
        <article className="metric-card">
          <p>Entries</p>
          <strong>{entries.length}</strong>
        </article>
        <article className="metric-card">
          <p>Net payable</p>
          <strong>{formatPayrollAmount(totals.net, totals.currency)}</strong>
        </article>
        <article className="metric-card">
          <p>Paid</p>
          <strong>{formatPayrollAmount(totals.paid, totals.currency)}</strong>
        </article>
      </div>

      <DataSurface aria-label="Payroll entries">
        <SurfaceHeader>
          <h2>Staff Payroll Entries</h2>
        </SurfaceHeader>
        {entries.length ? (
          <ResponsiveTable>
            <table>
              <thead>
                <tr>
                  <th>Staff</th>
                  <th>Compensation</th>
                  <th>Gross</th>
                  <th>Deductions</th>
                  <th>Net payable</th>
                  <th>Paid</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr key={entry.id}>
                    <td>{formatStaffName(entry.staff)}</td>
                    <td>
                      <div className="table-cell-stack">
                        <strong>{humanize(entry.compensation_type)}</strong>
                        <span>
                          {formatPayrollAmount(entry.compensation_amount, entry.currency)} / {humanize(entry.compensation_unit)}
                        </span>
                      </div>
                    </td>
                    <td>{formatPayrollAmount(entry.gross_amount, entry.currency)}</td>
                    <td>{formatPayrollAmount(entry.deductions_amount, entry.currency)}</td>
                    <td>{formatPayrollAmount(entry.net_payable, entry.currency)}</td>
                    <td>{formatPayrollAmount(getPayrollEntryPaidTotal(entry), entry.currency)}</td>
                    <td>
                      <StatusBadge value={getPayrollEntryPaymentStatus(entry)} />
                    </td>
                    <td>
                      <div className="table-actions">
                        <Link className="secondary-button" href={`/payroll/entries/edit/?id=${entry.id}`}>
                          Edit
                        </Link>
                        <Link className="primary-button" href={`/payroll/payments/new/?entryId=${entry.id}`}>
                          Record payment
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ResponsiveTable>
        ) : (
          <EmptyState title="No payroll entries" description="Add staff payroll entries for this period." />
        )}
      </DataSurface>

      <PayrollPeriodForm
        cancelHref={`/payroll/periods/detail/?id=${period.id}`}
        initialForm={periodForm}
        mode="edit"
        onSubmit={handlePeriodUpdate}
        organizations={period.organizations ? [period.organizations] : []}
        schools={period.schools ? [period.schools] : []}
        submitting={submitting}
      />
    </>
  );
}

function getPeriodTotals(period) {
  const entries = period?.payroll_entries || [];
  const currency = entries[0]?.currency || "JPY";

  return entries.reduce(
    (totals, entry) => ({
      currency,
      gross: totals.gross + Number(entry.gross_amount || 0),
      net: totals.net + Number(entry.net_payable || 0),
      paid: totals.paid + getPayrollEntryPaidTotal(entry)
    }),
    { currency, gross: 0, net: 0, paid: 0 }
  );
}

function PayrollPeriodLoading() {
  return (
    <>
      <PageHeader eyebrow="Restricted admin" title="Loading payroll period" />
      <div className="table-placeholder">Loading payroll period...</div>
    </>
  );
}
