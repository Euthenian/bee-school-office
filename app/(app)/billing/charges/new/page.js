"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";
import { StudentChargeForm } from "@/components/StudentBillingForms";
import { DataSurface } from "@/components/Surface";
import { useAuth } from "@/components/AuthProvider";
import { createStudentCharge, fetchStudentProfile } from "@/lib/data";
import { createStudentChargeForm } from "@/lib/billing";
import { formatPersonName } from "@/lib/format";
import { canManageBilling } from "@/lib/roles";
import { getSupabaseBrowserClient } from "@/lib/supabase";

export default function NewStudentChargePage() {
  return (
    <Suspense fallback={<BillingActionLoading title="Loading charge form" />}>
      <NewStudentChargeContent />
    </Suspense>
  );
}

function NewStudentChargeContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const studentId = searchParams.get("studentId") || "";
  const requestedType = searchParams.get("type") || "";
  const { profile, session } = useAuth();
  const mayManage = canManageBilling(profile);
  const [state, setState] = useState({ loading: true, error: "", student: null });
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let active = true;

    async function loadStudent() {
      const supabase = getSupabaseBrowserClient();
      if (!supabase || !session || !studentId || !mayManage) {
        setState({ loading: false, error: "", student: null });
        return;
      }

      setState((current) => ({ ...current, loading: true }));
      const { data, error } = await fetchStudentProfile(supabase, studentId);
      if (!active) return;

      setState({
        loading: false,
        error: error ? error.message : "",
        student: data || null
      });
    }

    loadStudent();

    return () => {
      active = false;
    };
  }, [mayManage, session, studentId]);

  const initialForm = useMemo(
    () =>
      createStudentChargeForm(studentId, {
        chargeType: requestedType === "adjustment" ? "adjustment" : "tuition",
        description: requestedType === "adjustment" ? "Billing adjustment" : ""
      }),
    [requestedType, studentId]
  );
  const cancelHref = studentId ? `/students/profile/?id=${studentId}` : "/billing/";

  async function handleSubmit(form) {
    setState((current) => ({ ...current, error: "" }));
    setSubmitting(true);

    const supabase = getSupabaseBrowserClient();
    if (!supabase || !session) {
      setState((current) => ({ ...current, error: "You must be signed in before adding a charge." }));
      setSubmitting(false);
      return;
    }

    const { error } = await createStudentCharge(supabase, form);
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
        <PageHeader eyebrow="Restricted admin" title="Add Charge" />
        <DataSurface>
          <EmptyState title="Billing is restricted" description="Your current role cannot add student charges." />
        </DataSurface>
      </>
    );
  }

  if (!studentId && !state.loading) {
    return (
      <>
        <PageHeader eyebrow="Restricted admin" title="Student not selected" />
        <EmptyState title="No student ID was provided" description="Open a student profile before adding a charge." />
      </>
    );
  }

  if (state.loading) {
    return <BillingActionLoading title="Loading charge form" />;
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
        title="Add Charge"
        description={formatPersonName(state.student)}
        actions={
          <Link className="secondary-button" href={cancelHref}>
            Back to student
          </Link>
        }
      />

      {state.error ? <p className="inline-alert">{state.error}</p> : null}

      <StudentChargeForm cancelHref={cancelHref} initialForm={initialForm} onSubmit={handleSubmit} submitting={submitting} />
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
