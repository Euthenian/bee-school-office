"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";
import { StudentChargeForm } from "@/components/StudentBillingForms";
import { DataSurface } from "@/components/Surface";
import { canEditStudentCharge, createStudentChargeEditForm } from "@/lib/billing";
import { fetchStudentCharge, updateStudentCharge } from "@/lib/data";
import { formatPersonName } from "@/lib/format";
import { canManageBilling } from "@/lib/roles";
import { getSupabaseBrowserClient } from "@/lib/supabase";

export default function EditStudentChargePage() {
  return (
    <Suspense fallback={<PageHeader eyebrow="Restricted admin" title="Loading charge" />}>
      <EditStudentChargeContent />
    </Suspense>
  );
}

function EditStudentChargeContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const studentId = searchParams.get("studentId") || "";
  const chargeId = searchParams.get("chargeId") || "";
  const cancelHref = studentId ? `/students/profile/?id=${studentId}` : "/billing/";
  const { profile, session } = useAuth();
  const mayManage = canManageBilling(profile);
  const [state, setState] = useState({ charge: null, error: "", loading: true });
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let active = true;
    async function loadCharge() {
      const supabase = getSupabaseBrowserClient();
      if (!supabase || !session || !mayManage || !studentId || !chargeId) {
        setState({ charge: null, error: "", loading: false });
        return;
      }
      const { data, error } = await fetchStudentCharge(supabase, studentId, chargeId);
      if (active) setState({ charge: data || null, error: error?.message || "", loading: false });
    }
    loadCharge();
    return () => { active = false; };
  }, [chargeId, mayManage, session, studentId]);

  async function handleSubmit(form) {
    const supabase = getSupabaseBrowserClient();
    if (!supabase || !session) {
      setState((current) => ({ ...current, error: "You must be signed in before editing a charge." }));
      return;
    }
    setSubmitting(true);
    setState((current) => ({ ...current, error: "" }));
    const { error } = await updateStudentCharge(supabase, chargeId, form);
    if (error) {
      setState((current) => ({ ...current, error: error.message }));
      setSubmitting(false);
      return;
    }
    router.push(cancelHref);
  }

  if (!mayManage) {
    return (
      <>
        <PageHeader eyebrow="Restricted admin" title="Edit Charge" />
        <DataSurface><EmptyState title="Billing is restricted" description="Your current role cannot edit student charges." /></DataSurface>
      </>
    );
  }
  if (state.loading) return <PageHeader eyebrow="Restricted admin" title="Loading charge" />;

  if (!state.charge || !canEditStudentCharge(state.charge)) {
    return (
      <>
        <PageHeader eyebrow="Restricted admin" title="Charge unavailable for editing" />
        <p className="inline-alert">{state.error || "Only open charges with no payment allocations can be edited."}</p>
        <Link className="secondary-button" href={cancelHref}>Back to student</Link>
      </>
    );
  }

  return (
    <>
      <PageHeader eyebrow="Restricted admin" title="Edit Charge" description={formatPersonName(state.charge.students)} />
      {state.error ? <p className="inline-alert">{state.error}</p> : null}
      <StudentChargeForm
        cancelHref={cancelHref}
        initialForm={createStudentChargeEditForm(state.charge)}
        mode="edit"
        onSubmit={handleSubmit}
        submitting={submitting}
      />
    </>
  );
}
