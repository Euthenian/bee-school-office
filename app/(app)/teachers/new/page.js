"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";
import { StaffEditor } from "@/components/StaffEditor";
import { DataSurface } from "@/components/Surface";
import { useAuth } from "@/components/AuthProvider";
import { createStaffMember, fetchOrganizations, fetchProfilesForStaff, fetchSchools } from "@/lib/data";
import { canManageStaff } from "@/lib/roles";
import { buildStaffAssignmentRows, createStaffFormState } from "@/lib/staff";
import { getSupabaseBrowserClient } from "@/lib/supabase";

export default function NewTeacherPage() {
  const router = useRouter();
  const { profile, session } = useAuth();
  const mayManage = canManageStaff(profile);
  const [foundation, setFoundation] = useState({ organizations: [], profiles: [], schools: [] });
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

      const [organizationsResult, profilesResult, schoolsResult] = await Promise.all([
        fetchOrganizations(supabase),
        fetchProfilesForStaff(supabase),
        fetchSchools(supabase)
      ]);
      if (!active) return;

      const loadError = [organizationsResult.error, profilesResult.error, schoolsResult.error]
        .filter(Boolean)
        .map((error) => error.message)
        .join(" ");

      setFoundation({
        organizations: organizationsResult.data || [],
        profiles: profilesResult.data || [],
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
  const initialForm = useMemo(() => createStaffFormState(null, defaultOrganizationId), [defaultOrganizationId]);
  const initialAssignments = useMemo(
    () => buildStaffAssignmentRows(foundation.schools, null, defaultOrganizationId),
    [defaultOrganizationId, foundation.schools]
  );

  async function handleSubmit(form, assignments) {
    setState((current) => ({ ...current, error: "" }));
    setSubmitting(true);

    const supabase = getSupabaseBrowserClient();
    if (!supabase || !session) {
      setState((current) => ({ ...current, error: "You must be signed in before creating a teacher." }));
      setSubmitting(false);
      return;
    }

    const teacherAssignments = assignments.map((assignment) =>
      assignment.assigned ? { ...assignment, canTeach: true } : assignment
    );
    const { data: staffId, error } = await createStaffMember(supabase, { ...form, assignments: teacherAssignments });
    if (error) {
      setState((current) => ({ ...current, error: error.message }));
      setSubmitting(false);
      return;
    }

    router.push(`/teachers/profile/?id=${staffId}`);
  }

  if (!mayManage) {
    return (
      <>
        <PageHeader eyebrow="Teaching operations" title="Add Teacher" />
        <DataSurface>
          <EmptyState
            title="Teacher creation is not available"
            description="Your current role can view teaching work but cannot create staff records."
          />
        </DataSurface>
      </>
    );
  }

  if (state.loading) {
    return (
      <>
        <PageHeader eyebrow="Teaching operations" title="Loading teacher form" />
        <div className="table-placeholder">Loading teacher foundation...</div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        eyebrow="Teaching operations"
        title="Add Teacher"
        description="Create a normal staff record and mark selected school assignments as teaching assignments."
        actions={
          <Link className="secondary-button" href="/teachers/">
            Back to teachers
          </Link>
        }
      />

      {state.error ? <p className="inline-alert">{state.error}</p> : null}

      <StaffEditor
        assignmentHeading="Teaching Assignments"
        cancelHref="/teachers/"
        identityHeading="Teacher Identity"
        initialAssignments={initialAssignments}
        initialForm={initialForm}
        onSubmit={handleSubmit}
        organizations={foundation.organizations}
        profiles={foundation.profiles}
        schools={foundation.schools}
        submitting={submitting}
        submitLabel="Create teacher"
        teacherMode
      />
    </>
  );
}
