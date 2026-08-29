"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";
import { PayrollEntryForm } from "@/components/PayrollEntryForm";
import { DataSurface } from "@/components/Surface";
import { useAuth } from "@/components/AuthProvider";
import {
  createPayrollEntry,
  fetchPayrollPeriods,
  fetchStaffCompensationTerms,
  fetchStaffMembers
} from "@/lib/data";
import { createPayrollEntryForm } from "@/lib/payroll";
import { canManagePayroll } from "@/lib/roles";
import { getSupabaseBrowserClient } from "@/lib/supabase";

export default function NewPayrollEntryPage() {
  return (
    <Suspense fallback={<PayrollEntryLoading />}>
      <NewPayrollEntryContent />
    </Suspense>
  );
}

function NewPayrollEntryContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const periodId = searchParams.get("periodId") || "";
  const { profile, session } = useAuth();
  const mayManage = canManagePayroll(profile);
  const [compensationTerms, setCompensationTerms] = useState([]);
  const [foundation, setFoundation] = useState({ periods: [], staff: [] });
  const [state, setState] = useState({ loading: true, error: "" });
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let active = true;

    async function loadFoundation() {
      const supabase = getSupabaseBrowserClient();
      if (!supabase || !session || !mayManage) {
        setFoundation({ periods: [], staff: [] });
        setState({ loading: false, error: "" });
        return;
      }

      const [periodsResult, staffResult] = await Promise.all([fetchPayrollPeriods(supabase), fetchStaffMembers(supabase)]);
      if (!active) return;

      const loadError = [periodsResult.error, staffResult.error]
        .filter(Boolean)
        .map((error) => error.message)
        .join(" ");

      setFoundation({
        periods: periodsResult.data || [],
        staff: staffResult.data || []
      });
      setState({ loading: false, error: loadError });
    }

    loadFoundation();

    return () => {
      active = false;
    };
  }, [mayManage, session]);

  const selectedPeriod = useMemo(
    () => foundation.periods.find((period) => period.id === periodId) || foundation.periods[0] || null,
    [foundation.periods, periodId]
  );
  const initialForm = useMemo(() => createPayrollEntryForm(null, selectedPeriod?.id || periodId), [periodId, selectedPeriod?.id]);
  const eligibleStaff = useMemo(() => filterStaffForPeriod(foundation.staff, selectedPeriod), [foundation.staff, selectedPeriod]);
  const cancelHref = selectedPeriod ? `/payroll/periods/detail/?id=${selectedPeriod.id}` : "/payroll/";

  async function handleStaffChange(staffId) {
    const supabase = getSupabaseBrowserClient();
    if (!supabase || !session || !staffId) {
      setCompensationTerms([]);
      return;
    }

    const { data, error } = await fetchStaffCompensationTerms(supabase, staffId);
    setCompensationTerms(error ? [] : data || []);
    if (error) {
      setState((current) => ({ ...current, error: error.message }));
    }
  }

  async function handleSubmit(form) {
    setState((current) => ({ ...current, error: "" }));
    setSubmitting(true);

    const supabase = getSupabaseBrowserClient();
    if (!supabase || !session) {
      setState((current) => ({ ...current, error: "You must be signed in before creating a payroll entry." }));
      setSubmitting(false);
      return;
    }

    const { error } = await createPayrollEntry(supabase, form);
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
        <PageHeader eyebrow="Restricted admin" title="New Payroll Entry" />
        <DataSurface>
          <EmptyState title="Payroll is restricted" description="Your current role cannot create payroll entries." />
        </DataSurface>
      </>
    );
  }

  if (state.loading) {
    return <PayrollEntryLoading />;
  }

  return (
    <>
      <PageHeader
        eyebrow="Restricted admin"
        title="New Payroll Entry"
        description="Create a historical payroll snapshot for a staff member."
        actions={
          <Link className="secondary-button" href={cancelHref}>
            Back to period
          </Link>
        }
      />

      {state.error ? <p className="inline-alert">{state.error}</p> : null}

      <PayrollEntryForm
        cancelHref={cancelHref}
        compensationTerms={compensationTerms}
        initialForm={initialForm}
        onStaffChange={handleStaffChange}
        onSubmit={handleSubmit}
        payrollPeriods={selectedPeriod ? [selectedPeriod] : foundation.periods}
        staff={eligibleStaff}
        submitting={submitting}
      />
    </>
  );
}

function filterStaffForPeriod(staff, period) {
  if (!period) return staff;

  return staff.filter((staffMember) => {
    if (staffMember.organization_id !== period.organization_id) return false;
    if (!period.school_id) return true;

    return (staffMember.staff_school_assignments || []).some(
      (assignment) => assignment.school_id === period.school_id && assignment.status === "active"
    );
  });
}

function PayrollEntryLoading() {
  return (
    <>
      <PageHeader eyebrow="Restricted admin" title="Loading payroll entry" />
      <div className="table-placeholder">Loading payroll entry form...</div>
    </>
  );
}
