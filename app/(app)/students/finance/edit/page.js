"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";
import { StudentFinanceForm } from "@/components/StudentFinanceForm";
import { DataSurface } from "@/components/Surface";
import { useAuth } from "@/components/AuthProvider";
import { fetchStudentBankDetails, fetchStudentFinance, fetchStudentProfile, updateStudentFinance } from "@/lib/data";
import { formatPersonName } from "@/lib/format";
import { canEditStudentBankDetails, canEditStudentFinance } from "@/lib/roles";
import { createStudentFinanceForm, hasStudentFinanceData } from "@/lib/student-finance";
import { getSupabaseBrowserClient } from "@/lib/supabase";

export default function EditStudentFinancePage() {
  return (
    <Suspense fallback={<EditStudentFinanceLoading />}>
      <EditStudentFinanceContent />
    </Suspense>
  );
}

function EditStudentFinanceContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const studentId = searchParams.get("id") || "";
  const { loading: authLoading, profile, session } = useAuth();
  const mayEdit = canEditStudentFinance(profile);
  const mayEditBankDetails = canEditStudentBankDetails(profile);
  const [state, setState] = useState({
    bankDetails: null,
    error: "",
    finance: null,
    loading: true,
    student: null
  });
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let active = true;

    async function loadFinance() {
      if (authLoading) return;

      const supabase = getSupabaseBrowserClient();
      if (!supabase || !session || !studentId || !mayEdit) {
        setState((current) => ({ ...current, loading: false }));
        return;
      }

      setState((current) => ({ ...current, error: "", loading: true }));
      const [studentResult, financeResult, bankDetailsResult] = await Promise.all([
        fetchStudentProfile(supabase, studentId),
        fetchStudentFinance(supabase, studentId),
        mayEditBankDetails ? fetchStudentBankDetails(supabase, studentId) : { data: null, error: null }
      ]);
      if (!active) return;

      const loadError = [studentResult.error, financeResult.error, bankDetailsResult.error]
        .filter(Boolean)
        .map((item) => item.message)
        .join(" ");

      setState({
        bankDetails: bankDetailsResult.data || null,
        error: loadError || "",
        finance: financeResult.data || null,
        loading: false,
        student: studentResult.data || null
      });
    }

    loadFinance();

    return () => {
      active = false;
    };
  }, [authLoading, mayEdit, mayEditBankDetails, session, studentId]);

  const canEditBankDetails = Boolean(state.finance?.can_edit_bank_details && mayEditBankDetails);
  const initialForm = useMemo(
    () => createStudentFinanceForm(state.finance || {}, state.bankDetails || {}),
    [state.bankDetails, state.finance]
  );
  const cancelHref = studentId ? `/students/profile/?id=${studentId}` : "/students/";
  const hasFinance = hasStudentFinanceData(state.finance);

  async function handleSubmit(form) {
    setState((current) => ({ ...current, error: "" }));
    setSubmitting(true);

    const supabase = getSupabaseBrowserClient();
    if (!supabase || !session) {
      setState((current) => ({ ...current, error: "You must be signed in before editing finance details." }));
      setSubmitting(false);
      return;
    }

    const { error } = await updateStudentFinance(supabase, {
      canEditBankDetails,
      form,
      studentId
    });

    if (error) {
      setState((current) => ({ ...current, error: error.message }));
      setSubmitting(false);
      return;
    }

    router.push(`/students/profile/?id=${studentId}`);
  }

  if (!studentId && !state.loading) {
    return (
      <>
        <PageHeader eyebrow="Restricted finance" title="Student not selected" />
        <EmptyState title="No student ID was provided" description="Open a student profile before editing finance details." />
      </>
    );
  }

  if (!authLoading && !mayEdit) {
    return (
      <>
        <PageHeader eyebrow="Restricted finance" title="Finance Details" />
        <DataSurface>
          <EmptyState title="Finance is restricted" description="Your current role cannot edit student finance details." />
        </DataSurface>
      </>
    );
  }

  if (state.loading || authLoading) {
    return <EditStudentFinanceLoading />;
  }

  if (state.error && !state.student) {
    return (
      <>
        <PageHeader eyebrow="Restricted finance" title="Student unavailable" />
        <p className="inline-alert">{state.error}</p>
        <Link className="secondary-button" href="/students/">
          Back to students
        </Link>
      </>
    );
  }

  return (
    <>
      <PageHeader
        eyebrow="Restricted finance"
        title={hasFinance ? "Edit Finance Details" : "Add Finance Details"}
        description={formatPersonName(state.student)}
        actions={
          <Link className="secondary-button" href={cancelHref}>
            Back to profile
          </Link>
        }
      />

      {state.error ? <p className="inline-alert">{state.error}</p> : null}

      <StudentFinanceForm
        cancelHref={cancelHref}
        canEditBankDetails={canEditBankDetails}
        initialForm={initialForm}
        onSubmit={handleSubmit}
        submitting={submitting}
      />
    </>
  );
}

function EditStudentFinanceLoading() {
  return (
    <>
      <PageHeader eyebrow="Restricted finance" title="Loading finance details" />
      <div className="table-placeholder">Loading finance details...</div>
    </>
  );
}
