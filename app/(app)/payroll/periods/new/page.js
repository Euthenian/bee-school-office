"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";
import { PayrollPeriodForm } from "@/components/PayrollPeriodForm";
import { DataSurface } from "@/components/Surface";
import { useAuth } from "@/components/AuthProvider";
import { createPayrollPeriod, fetchOrganizations, fetchSchools } from "@/lib/data";
import { createPayrollPeriodForm } from "@/lib/payroll";
import { canManagePayroll } from "@/lib/roles";
import { getSupabaseBrowserClient } from "@/lib/supabase";

export default function NewPayrollPeriodPage() {
  const router = useRouter();
  const { profile, session } = useAuth();
  const mayManage = canManagePayroll(profile);
  const [foundation, setFoundation] = useState({ organizations: [], schools: [] });
  const [state, setState] = useState({ loading: true, error: "" });
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let active = true;

    async function loadFoundation() {
      const supabase = getSupabaseBrowserClient();
      if (!supabase || !session || !mayManage) {
        setState({ loading: false, error: "" });
        return;
      }

      const [organizationsResult, schoolsResult] = await Promise.all([fetchOrganizations(supabase), fetchSchools(supabase)]);
      if (!active) return;

      const loadError = [organizationsResult.error, schoolsResult.error]
        .filter(Boolean)
        .map((error) => error.message)
        .join(" ");

      setFoundation({
        organizations: organizationsResult.data || [],
        schools: schoolsResult.data || []
      });
      setState({ loading: false, error: loadError });
    }

    loadFoundation();

    return () => {
      active = false;
    };
  }, [mayManage, session]);

  const activeOrganizations = useMemo(
    () => foundation.organizations.filter((organization) => organization.status === "active"),
    [foundation.organizations]
  );
  const defaultOrganizationId = activeOrganizations.length === 1 ? activeOrganizations[0].id : "";
  const initialForm = useMemo(() => createPayrollPeriodForm(null, defaultOrganizationId), [defaultOrganizationId]);

  async function handleSubmit(form) {
    setState((current) => ({ ...current, error: "" }));
    setSubmitting(true);

    const supabase = getSupabaseBrowserClient();
    if (!supabase || !session) {
      setState((current) => ({ ...current, error: "You must be signed in before creating a payroll period." }));
      setSubmitting(false);
      return;
    }

    const { data: periodId, error } = await createPayrollPeriod(supabase, form);
    if (error) {
      setState((current) => ({ ...current, error: error.message }));
      setSubmitting(false);
      return;
    }

    router.push(`/payroll/periods/detail/?id=${periodId}`);
  }

  if (!mayManage) {
    return (
      <>
        <PageHeader eyebrow="Restricted admin" title="New Payroll Period" />
        <DataSurface>
          <EmptyState title="Payroll is restricted" description="Your current role cannot create payroll periods." />
        </DataSurface>
      </>
    );
  }

  if (state.loading) {
    return (
      <>
        <PageHeader eyebrow="Restricted admin" title="Loading payroll form" />
        <div className="table-placeholder">Loading payroll foundation...</div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        eyebrow="Restricted admin"
        title="New Payroll Period"
        description="Create a payroll calculation period before adding staff entries."
        actions={
          <Link className="secondary-button" href="/payroll/">
            Back to payroll
          </Link>
        }
      />

      {state.error ? <p className="inline-alert">{state.error}</p> : null}

      <PayrollPeriodForm
        cancelHref="/payroll/"
        initialForm={initialForm}
        onSubmit={handleSubmit}
        organizations={foundation.organizations}
        schools={foundation.schools}
        submitting={submitting}
      />
    </>
  );
}
