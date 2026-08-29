"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";
import { StudentPaymentAllocationForm } from "@/components/StudentBillingForms";
import { DataSurface } from "@/components/Surface";
import { useAuth } from "@/components/AuthProvider";
import { allocateStudentPayment, fetchStudentBilling, fetchStudentProfile } from "@/lib/data";
import { createStudentPaymentAllocationForm } from "@/lib/billing";
import { formatPersonName } from "@/lib/format";
import { canManageBilling } from "@/lib/roles";
import { getSupabaseBrowserClient } from "@/lib/supabase";

export default function NewStudentPaymentAllocationPage() {
  return (
    <Suspense fallback={<BillingActionLoading title="Loading allocation form" />}>
      <NewStudentPaymentAllocationContent />
    </Suspense>
  );
}

function NewStudentPaymentAllocationContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const studentId = searchParams.get("studentId") || "";
  const paymentId = searchParams.get("paymentId") || "";
  const chargeId = searchParams.get("chargeId") || "";
  const { profile, session } = useAuth();
  const mayManage = canManageBilling(profile);
  const [billing, setBilling] = useState({ charges: [], payments: [] });
  const [state, setState] = useState({ loading: true, error: "", student: null });
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let active = true;

    async function loadStudentBilling() {
      const supabase = getSupabaseBrowserClient();
      if (!supabase || !session || !studentId || !mayManage) {
        setBilling({ charges: [], payments: [] });
        setState({ loading: false, error: "", student: null });
        return;
      }

      setState((current) => ({ ...current, loading: true }));
      const [studentResult, billingResult] = await Promise.all([
        fetchStudentProfile(supabase, studentId),
        fetchStudentBilling(supabase, studentId)
      ]);
      if (!active) return;

      const loadError = [studentResult.error, billingResult.error]
        .filter(Boolean)
        .map((error) => error.message)
        .join(" ");

      setBilling({
        charges: billingResult.data?.charges || [],
        payments: billingResult.data?.payments || []
      });
      setState({
        loading: false,
        error: loadError,
        student: studentResult.data || null
      });
    }

    loadStudentBilling();

    return () => {
      active = false;
    };
  }, [mayManage, session, studentId]);

  const initialForm = useMemo(
    () => createStudentPaymentAllocationForm(studentId, paymentId, chargeId),
    [chargeId, paymentId, studentId]
  );
  const cancelHref = studentId ? `/students/profile/?id=${studentId}` : "/billing/";

  async function handleSubmit(form) {
    setState((current) => ({ ...current, error: "" }));
    setSubmitting(true);

    const supabase = getSupabaseBrowserClient();
    if (!supabase || !session) {
      setState((current) => ({ ...current, error: "You must be signed in before allocating payment." }));
      setSubmitting(false);
      return;
    }

    const { error } = await allocateStudentPayment(supabase, form);
    if (error) {
      setState((current) => ({ ...current, error: error.message }));
      setSubmitting(false);
      return;
    }

    router.push(`/students/profile/?id=${form.studentId}`);
  }

  if (!mayManage) {
    return (
      <>
        <PageHeader eyebrow="Restricted admin" title="Allocate Payment" />
        <DataSurface>
          <EmptyState title="Billing is restricted" description="Your current role cannot allocate student payments." />
        </DataSurface>
      </>
    );
  }

  if (!studentId && !state.loading) {
    return (
      <>
        <PageHeader eyebrow="Restricted admin" title="Student not selected" />
        <EmptyState title="No student ID was provided" description="Open a student profile before allocating payment." />
      </>
    );
  }

  if (state.loading) {
    return <BillingActionLoading title="Loading allocation form" />;
  }

  if (state.error || !state.student) {
    return (
      <>
        <PageHeader eyebrow="Restricted admin" title="Student unavailable" />
        <p className="inline-alert">{state.error || "This student could not be found or is not visible to your role."}</p>
        <Link className="secondary-button" href="/billing/">
          Back to billing
        </Link>
      </>
    );
  }

  return (
    <>
      <PageHeader
        eyebrow="Restricted admin"
        title="Allocate Payment"
        description={formatPersonName(state.student)}
        actions={
          <Link className="secondary-button" href={cancelHref}>
            Back to student
          </Link>
        }
      />

      {state.error ? <p className="inline-alert">{state.error}</p> : null}

      <StudentPaymentAllocationForm
        cancelHref={cancelHref}
        charges={billing.charges}
        initialForm={initialForm}
        onSubmit={handleSubmit}
        payments={billing.payments}
        submitting={submitting}
      />
    </>
  );
}

function BillingActionLoading({ title }) {
  return (
    <>
      <PageHeader eyebrow="Restricted admin" title={title} />
      <div className="table-placeholder">{title}...</div>
    </>
  );
}
