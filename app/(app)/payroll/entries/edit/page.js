"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";
import { PayrollEntryForm } from "@/components/PayrollEntryForm";
import { StatusBadge } from "@/components/StatusBadge";
import { DataSurface, ResponsiveTable, SurfaceHeader } from "@/components/Surface";
import { useAuth } from "@/components/AuthProvider";
import {
  fetchPayrollEntry,
  fetchPayrollPeriods,
  fetchStaffCompensationTerms,
  fetchStaffMembers,
  updatePayrollEntry
} from "@/lib/data";
import { formatDate, humanize } from "@/lib/format";
import {
  createPayrollEntryForm,
  formatPayrollAmount,
  getPayrollEntryPaidTotal,
  getPayrollEntryPaymentStatus
} from "@/lib/payroll";
import { canManagePayroll } from "@/lib/roles";
import { formatStaffName } from "@/lib/staff";
import { getSupabaseBrowserClient } from "@/lib/supabase";

export default function EditPayrollEntryPage() {
  return (
    <Suspense fallback={<PayrollEntryLoading />}>
      <EditPayrollEntryContent />
    </Suspense>
  );
}

function EditPayrollEntryContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const entryId = searchParams.get("id") || "";
  const { profile, session } = useAuth();
  const mayManage = canManagePayroll(profile);
  const [compensationTerms, setCompensationTerms] = useState([]);
  const [foundation, setFoundation] = useState({ periods: [], staff: [] });
  const [state, setState] = useState({ loading: true, error: "", entry: null });
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let active = true;

    async function loadEntry() {
      const supabase = getSupabaseBrowserClient();
      if (!supabase || !session || !entryId || !mayManage) {
        setFoundation({ periods: [], staff: [] });
        setCompensationTerms([]);
        setState({ loading: false, error: "", entry: null });
        return;
      }

      setState((current) => ({ ...current, loading: true }));
      const entryResult = await fetchPayrollEntry(supabase, entryId);
      const staffId = entryResult.data?.staff_id || "";
      const [periodsResult, staffResult, termsResult] = await Promise.all([
        fetchPayrollPeriods(supabase),
        fetchStaffMembers(supabase),
        staffId ? fetchStaffCompensationTerms(supabase, staffId) : Promise.resolve({ data: [], error: null })
      ]);
      if (!active) return;

      const loadError = [entryResult.error, periodsResult.error, staffResult.error, termsResult.error]
        .filter(Boolean)
        .map((error) => error.message)
        .join(" ");

      setFoundation({
        periods: periodsResult.data || [],
        staff: staffResult.data || []
      });
      setCompensationTerms(termsResult.data || []);
      setState({
        loading: false,
        error: loadError,
        entry: entryResult.data || null
      });
    }

    loadEntry();

    return () => {
      active = false;
    };
  }, [entryId, mayManage, session]);

  const entry = state.entry;
  const period = useMemo(
    () => foundation.periods.find((item) => item.id === entry?.payroll_period_id) || null,
    [entry?.payroll_period_id, foundation.periods]
  );
  const initialForm = useMemo(() => createPayrollEntryForm(entry), [entry]);
  const cancelHref = period ? `/payroll/periods/detail/?id=${period.id}` : "/payroll/";

  async function handleSubmit(form) {
    setState((current) => ({ ...current, error: "" }));
    setSubmitting(true);

    const supabase = getSupabaseBrowserClient();
    if (!supabase || !session || !entryId) {
      setState((current) => ({ ...current, error: "You must be signed in before editing a payroll entry." }));
      setSubmitting(false);
      return;
    }

    const { error } = await updatePayrollEntry(supabase, { payrollEntryId: entryId, ...form });
    if (error) {
      setState((current) => ({ ...current, error: error.message }));
      setSubmitting(false);
      return;
    }

    router.push(`/payroll/periods/detail/?id=${form.payrollPeriodId}`);
  }

  if (!mayManage) {
    return (
      <>
        <PageHeader eyebrow="Restricted admin" title="Edit Payroll Entry" />
        <DataSurface>
          <EmptyState title="Payroll is restricted" description="Your current role cannot edit payroll entries." />
        </DataSurface>
      </>
    );
  }

  if (!entryId && !state.loading) {
    return (
      <>
        <PageHeader eyebrow="Restricted admin" title="Payroll entry not selected" />
        <EmptyState title="No payroll entry ID was provided" description="Open an entry from a payroll period." />
      </>
    );
  }

  if (state.loading) {
    return <PayrollEntryLoading />;
  }

  if (state.error && !state.entry) {
    return (
      <>
        <PageHeader eyebrow="Restricted admin" title="Payroll entry unavailable" />
        <p className="inline-alert">{state.error}</p>
        <Link className="secondary-button" href="/payroll/">
          Back to payroll
        </Link>
      </>
    );
  }

  if (!entry) {
    return (
      <>
        <PageHeader eyebrow="Restricted admin" title="Payroll entry unavailable" />
        <p className="inline-alert">This payroll entry could not be found or is not visible to your role.</p>
        <Link className="secondary-button" href="/payroll/">
          Back to payroll
        </Link>
      </>
    );
  }

  return (
    <>
      <PageHeader
        eyebrow="Restricted admin"
        title="Edit Payroll Entry"
        description={formatStaffName(entry.staff)}
        actions={
          <div className="form-actions">
            <StatusBadge value={getPayrollEntryPaymentStatus(entry)} />
            <Link className="secondary-button" href={cancelHref}>
              Back to period
            </Link>
            <Link className="primary-button" href={`/payroll/payments/new/?entryId=${entry.id}`}>
              Record payment
            </Link>
          </div>
        }
      />

      {state.error ? <p className="inline-alert">{state.error}</p> : null}

      <DataSurface>
        <SurfaceHeader>
          <h2>Payment History</h2>
        </SurfaceHeader>
        {entry.payroll_payments?.length ? (
          <ResponsiveTable>
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Amount</th>
                  <th>Method</th>
                  <th>Reference</th>
                </tr>
              </thead>
              <tbody>
                {entry.payroll_payments.map((payment) => (
                  <tr key={payment.id}>
                    <td>{formatDate(payment.payment_date)}</td>
                    <td>{formatPayrollAmount(payment.amount, payment.currency)}</td>
                    <td>{humanize(payment.payment_method)}</td>
                    <td>{payment.reference || "Not set"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ResponsiveTable>
        ) : (
          <EmptyState title="No payments recorded" description="Payment records are tracked separately from payroll entries." />
        )}
        <dl className="detail-list">
          <DetailRow label="Paid total" value={formatPayrollAmount(getPayrollEntryPaidTotal(entry), entry.currency)} />
          <DetailRow label="Net payable" value={formatPayrollAmount(entry.net_payable, entry.currency)} />
        </dl>
      </DataSurface>

      <PayrollEntryForm
        cancelHref={cancelHref}
        compensationTerms={compensationTerms}
        initialForm={initialForm}
        mode="edit"
        onSubmit={handleSubmit}
        payrollPeriods={period ? [period] : foundation.periods}
        staff={foundation.staff}
        submitting={submitting}
      />
    </>
  );
}

function DetailRow({ label, value }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value || "Not set"}</dd>
    </div>
  );
}

function PayrollEntryLoading() {
  return (
    <>
      <PageHeader eyebrow="Restricted admin" title="Loading payroll entry" />
      <div className="table-placeholder">Loading payroll entry...</div>
    </>
  );
}
