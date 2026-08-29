"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";
import { StaffEditor } from "@/components/StaffEditor";
import { DataSurface } from "@/components/Surface";
import { useAuth } from "@/components/AuthProvider";
import {
  fetchOrganizations,
  fetchProfilesForStaff,
  fetchSchools,
  fetchStaffMember,
  updateStaffMember
} from "@/lib/data";
import { canManageStaff } from "@/lib/roles";
import { buildStaffAssignmentRows, createStaffFormState, formatStaffName } from "@/lib/staff";
import { getSupabaseBrowserClient } from "@/lib/supabase";

export default function EditStaffPage() {
  return (
    <Suspense fallback={<EditStaffLoading />}>
      <EditStaffContent />
    </Suspense>
  );
}

function EditStaffContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const staffId = searchParams.get("id") || "";
  const { profile, session } = useAuth();
  const mayManage = canManageStaff(profile);
  const [foundation, setFoundation] = useState({ organizations: [], profiles: [], schools: [] });
  const [state, setState] = useState({ loading: true, error: "", staffMember: null });
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let active = true;

    async function loadEditData() {
      const supabase = getSupabaseBrowserClient();
      if (!supabase || !session || !staffId || !mayManage) {
        setState({ loading: false, error: "", staffMember: null });
        return;
      }

      setState((current) => ({ ...current, loading: true }));
      const [staffResult, organizationsResult, profilesResult, schoolsResult] = await Promise.all([
        fetchStaffMember(supabase, staffId),
        fetchOrganizations(supabase),
        fetchProfilesForStaff(supabase),
        fetchSchools(supabase)
      ]);
      if (!active) return;

      const loadError = [staffResult.error, organizationsResult.error, profilesResult.error, schoolsResult.error]
        .filter(Boolean)
        .map((error) => error.message)
        .join(" ");

      setFoundation({
        organizations: organizationsResult.data || [],
        profiles: profilesResult.data || [],
        schools: schoolsResult.data || []
      });
      setState({
        loading: false,
        error: loadError,
        staffMember: staffResult.data || null
      });
    }

    loadEditData();

    return () => {
      active = false;
    };
  }, [mayManage, session, staffId]);

  const initialForm = useMemo(() => createStaffFormState(state.staffMember), [state.staffMember]);
  const initialAssignments = useMemo(
    () => buildStaffAssignmentRows(foundation.schools, state.staffMember, state.staffMember?.organization_id || ""),
    [foundation.schools, state.staffMember]
  );

  async function handleSubmit(form, assignments) {
    setState((current) => ({ ...current, error: "" }));
    setSubmitting(true);

    const supabase = getSupabaseBrowserClient();
    if (!supabase || !session || !staffId) {
      setState((current) => ({ ...current, error: "You must be signed in before editing a staff member." }));
      setSubmitting(false);
      return;
    }

    const { error } = await updateStaffMember(supabase, { staffId, ...form, assignments });
    if (error) {
      setState((current) => ({ ...current, error: error.message }));
      setSubmitting(false);
      return;
    }

    router.push(`/staff/profile/?id=${staffId}`);
  }

  if (!mayManage) {
    return (
      <>
        <PageHeader eyebrow="Staff management" title="Edit Staff" />
        <DataSurface>
          <EmptyState
            title="Staff editing is not available"
            description="Your current role can view teaching work but cannot edit staff records."
          />
        </DataSurface>
      </>
    );
  }

  if (!staffId && !state.loading) {
    return (
      <>
        <PageHeader eyebrow="Staff management" title="Staff not selected" />
        <EmptyState title="No staff ID was provided" description="Open a staff profile before editing." />
      </>
    );
  }

  if (state.loading) {
    return <EditStaffLoading />;
  }

  if (state.error && !state.staffMember) {
    return (
      <>
        <PageHeader eyebrow="Staff management" title="Staff unavailable" />
        <p className="inline-alert">{state.error}</p>
        <Link className="secondary-button" href="/staff/">
          Back to staff
        </Link>
      </>
    );
  }

  if (!state.staffMember) {
    return (
      <>
        <PageHeader eyebrow="Staff management" title="Staff unavailable" />
        <p className="inline-alert">This staff member could not be found or is not visible to your role.</p>
        <Link className="secondary-button" href="/staff/">
          Back to staff
        </Link>
      </>
    );
  }

  return (
    <>
      <PageHeader
        eyebrow="Staff management"
        title="Edit Staff"
        description={formatStaffName(state.staffMember)}
        actions={
          <Link className="secondary-button" href={`/staff/profile/?id=${staffId}`}>
            Back to profile
          </Link>
        }
      />

      {state.error ? <p className="inline-alert">{state.error}</p> : null}

      <StaffEditor
        cancelHref={`/staff/profile/?id=${staffId}`}
        initialAssignments={initialAssignments}
        initialForm={initialForm}
        mode="edit"
        onSubmit={handleSubmit}
        organizations={foundation.organizations}
        profiles={foundation.profiles}
        schools={foundation.schools}
        submitting={submitting}
      />
    </>
  );
}

function EditStaffLoading() {
  return (
    <>
      <PageHeader eyebrow="Staff management" title="Loading staff" />
      <div className="table-placeholder">Loading staff edit form...</div>
    </>
  );
}
