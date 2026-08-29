"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";
import { PayrollPaymentForm } from "@/components/PayrollPaymentForm";
import { DataSurface } from "@/components/Surface";
import { useAuth } from "@/components/AuthProvider";
import { fetchPayrollEntry, recordPayrollPayment } from "@/lib/data";
import { createPayrollPaymentForm } from "@/lib/payroll";
import { canManagePayroll } from "@/lib/roles";
import { getSupabaseBrowserClient } from "@/lib/supabase";

export default function NewPayrollPaymentPage() {
  return (
    <Suspense fallback={<PayrollPaymentLoading />}>
      <NewPayrollPaymentContent />
    </Suspense>
  );
}

function NewPayrollPaymentContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const entryId = searchParams.get("entryId") || "";
  const { profile, session } = useAuth();
  const mayManage = canManagePayroll(profile);
  const [state, setState] = useState({ loading: true, error: "", entry: null });
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let active = true;

    async function loadEntry() {
      const supabase = getSupabaseBrowserClient();
      if (!supabase || !session || !entryId || !mayManage) {
        setState({ loading: false, error: "", entry: null });
        return;
      }

      setState((current) => ({ ...current, loading: true }));
      const { data, error } = await fetchPayrollEntry(supabase, entryId);
      if (!active) return;

      setState({
        loading: false,
        error: error ? error.message : "",
        entry: data || null
      });
    }

    loadEntry();

    return () => {
      active = false;
    };
  }, [entryId, mayManage, session]);

  const entry = state.entry;
  const initialForm = useMemo(() => createPayrollPaymentForm(entry), [entry]);
  const cancelHref = entry ? `/payroll/entries/edit/?id=${entry.id}` : "/payroll/";

  async function handleSubmit(form) {
    setState((current) => ({ ...current, error: "" }));
    setSubmitting(true);

    const supabase = getSupabaseBrowserClient();
    if (!supabase || !session || !entryId) {
      setState((current) => ({ ...current, error: "You must be signed in before recording a payroll payment." }));
      setSubmitting(false);
      return;
    }

    const { error } = await recordPayrollPayment(supabase, form);
    if (error) {
      setState((current) => ({ ...current, error: error.message }));
      setSubmitting(false);
      return;
    }

    router.push(`/payroll/entries/edit/?id=${entryId}`);
  }

  if (!mayManage) {
    return (
      <>
        <PageHeader eyebrow="Restricted admin" title="Record Payroll Payment" />
        <DataSurface>
          <EmptyState title="Payroll is restricted" description="Your current role cannot record payroll payments." />
        </DataSurface>
      </>
    );
  }

  if (!entryId && !state.loading) {
    return (
      <>
        <PageHeader eyebrow="Restricted admin" title="Payroll entry not selected" />
        <EmptyState title="No payroll entry ID was provided" description="Open an entry before recording payment." />
      </>
    );
  }

  if (state.loading) {
    return <PayrollPaymentLoading />;
  }

  if (state.error && !entry) {
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
        title="Record Payroll Payment"
        description="Record an actual payment against a payroll entry."
        actions={
          <Link className="secondary-button" href={cancelHref}>
            Back to entry
          </Link>
        }
      />

      {state.error ? <p className="inline-alert">{state.error}</p> : null}

      <PayrollPaymentForm
        cancelHref={cancelHref}
        entry={entry}
        initialForm={initialForm}
        onSubmit={handleSubmit}
        submitting={submitting}
      />
    </>
  );
}

function PayrollPaymentLoading() {
  return (
    <>
      <PageHeader eyebrow="Restricted admin" title="Loading payroll payment" />
      <div className="table-placeholder">Loading payroll payment form...</div>
    </>
  );
}
