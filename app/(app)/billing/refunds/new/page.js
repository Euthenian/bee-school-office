"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";
import { StudentRefundForm } from "@/components/StudentBillingForms";
import { DataSurface } from "@/components/Surface";
import { useAuth } from "@/components/AuthProvider";
import { fetchStudentBilling, fetchStudentProfile, recordStudentRefund } from "@/lib/data";
import { createStudentRefundForm } from "@/lib/billing";
import { formatPersonName } from "@/lib/format";
import { canManageBilling } from "@/lib/roles";
import { getSupabaseBrowserClient } from "@/lib/supabase";

export default function NewStudentRefundPage() {
  return (
    <Suspense fallback={<BillingActionLoading title="Loading refund form" />}>
      <NewStudentRefundContent />
    </Suspense>
  );
}

function NewStudentRefundContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const studentId = searchParams.get("studentId") || "";
  const paymentId = searchParams.get("paymentId") || "";
  const { profile, session } = useAuth();
  const mayManage = canManageBilling(profile);
  const [billing, setBilling] = useState({ payments: [] });
  const [state, setState] = useState({ loading: true, error: "", student: null });
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let active = true;

    async function loadStudentBilling() {
      const supabase = getSupabaseBrowserClient();
      if (!supabase || !session || !studentId || !mayManage) {
        setBilling({ payments: [] });
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

      setBilling({ payments: billingResult.data?.payments || [] });
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

  const initialForm = useMemo(() => createStudentRefundForm(studentId, paymentId), [paymentId, studentId]);
  const cancelHref = studentId ? `/students/profile/?id=${studentId}` : "/billing/";

  async function handleSubmit(form) {
    setState((current) => ({ ...current, error: "" }));
    setSubmitting(true);

    const supabase = getSupabaseBrowserClient();
    if (!supabase || !session) {
      setState((current) => ({ ...current, error: "You must be signed in before recording a refund." }));
      setSubmitting(false);
      return;
    }

    const { error } = await recordStudentRefund(supabase, form);
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
        <PageHeader eyebrow="Restricted admin" title="Record Refund" />
        <DataSurface>
          <EmptyState title="Billing is restricted" description="Your current role cannot record student refunds." />
        </DataSurface>
      </>
    );
  }

  if (!studentId && !state.loading) {
    return (
      <>
        <PageHeader eyebrow="Restricted admin" title="Student not selected" />
        <EmptyState title="No student ID was provided" description="Open a student profile before recording a refund." />
      </>
    );
  }

  if (state.loading) {
    return <BillingActionLoading title="Loading refund form" />;
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
        title="Record Refund"
        description={formatPersonName(state.student)}
        actions={
          <Link className="secondary-button" href={cancelHref}>
            Back to student
          </Link>
        }
      />

      {state.error ? <p className="inline-alert">{state.error}</p> : null}

      <StudentRefundForm
        cancelHref={cancelHref}
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
