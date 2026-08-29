"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { CompensationTermForm, CompensationTermsList } from "@/components/CompensationTermForm";
import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { DataSurface, SurfaceHeader } from "@/components/Surface";
import { useAuth } from "@/components/AuthProvider";
import { createStaffCompensationTerm, fetchStaffCompensationTerms, fetchStaffMember } from "@/lib/data";
import { formatDate, humanize } from "@/lib/format";
import { createCompensationTermForm } from "@/lib/payroll";
import { canManagePayroll, canManageStaff } from "@/lib/roles";
import { formatStaffName } from "@/lib/staff";
import { getSupabaseBrowserClient } from "@/lib/supabase";
import { useSearchParams } from "next/navigation";

export default function StaffProfilePage() {
  return (
    <Suspense fallback={<StaffProfileLoading />}>
      <StaffProfileContent />
    </Suspense>
  );
}

function StaffProfileContent() {
  const { profile, session } = useAuth();
  const searchParams = useSearchParams();
  const staffId = searchParams.get("id") || "";
  const mayManage = canManageStaff(profile);
  const mayManagePayroll = canManagePayroll(profile);
  const [compensation, setCompensation] = useState({ error: "", loading: false, terms: [] });
  const [showCompensationForm, setShowCompensationForm] = useState(false);
  const [state, setState] = useState({ loading: true, error: "", staffMember: null });
  const [submittingTerm, setSubmittingTerm] = useState(false);

  useEffect(() => {
    let active = true;

    async function loadStaffMember() {
      const supabase = getSupabaseBrowserClient();
      if (!supabase || !session || !staffId || !mayManage) {
        setState({ loading: false, error: "", staffMember: null });
        return;
      }

      setState((current) => ({ ...current, loading: true }));
      const { data, error } = await fetchStaffMember(supabase, staffId);
      if (!active) return;

      let terms = [];
      let termsError = null;
      if (data && mayManagePayroll) {
        setCompensation((current) => ({ ...current, loading: true, error: "" }));
        const termsResult = await fetchStaffCompensationTerms(supabase, staffId);
        if (!active) return;
        terms = termsResult.data || [];
        termsError = termsResult.error;
      }

      setState({
        loading: false,
        error: error ? error.message : "",
        staffMember: data || null
      });
      setCompensation({
        error: termsError ? termsError.message : "",
        loading: false,
        terms
      });
    }

    loadStaffMember();

    return () => {
      active = false;
    };
  }, [mayManage, mayManagePayroll, session, staffId]);

  async function handleCompensationSubmit(form) {
    setSubmittingTerm(true);
    setCompensation((current) => ({ ...current, error: "" }));

    const supabase = getSupabaseBrowserClient();
    if (!supabase || !session || !staffId || !mayManagePayroll) {
      setCompensation((current) => ({
        ...current,
        error: "You must be signed in with payroll access before adding compensation terms."
      }));
      setSubmittingTerm(false);
      return;
    }

    const { error } = await createStaffCompensationTerm(supabase, form);
    if (error) {
      setCompensation((current) => ({ ...current, error: error.message }));
      setSubmittingTerm(false);
      return;
    }

    const termsResult = await fetchStaffCompensationTerms(supabase, staffId);
    setCompensation({
      error: termsResult.error ? termsResult.error.message : "",
      loading: false,
      terms: termsResult.data || []
    });
    setShowCompensationForm(false);
    setSubmittingTerm(false);
  }

  if (!mayManage) {
    return (
      <>
        <PageHeader eyebrow="Staff management" title="Staff Profile" />
        <DataSurface>
          <EmptyState
            title="Staff profiles are not available"
            description="Your current role can view teaching work but cannot access staff administration."
          />
        </DataSurface>
      </>
    );
  }

  if (!staffId && !state.loading) {
    return (
      <>
        <PageHeader eyebrow="Staff management" title="Staff not selected" />
        <EmptyState title="No staff ID was provided" description="Open a staff member from the Staff list." />
      </>
    );
  }

  if (state.loading) {
    return <StaffProfileLoading />;
  }

  if (state.error || !state.staffMember) {
    return (
      <>
        <PageHeader eyebrow="Staff management" title="Staff unavailable" />
        <p className="inline-alert">{state.error || "This staff member could not be found or is not visible to your role."}</p>
        <Link className="secondary-button" href="/staff/">
          Back to staff
        </Link>
      </>
    );
  }

  const staffMember = state.staffMember;

  return (
    <>
      <PageHeader
        eyebrow="Staff management"
        title={formatStaffName(staffMember)}
        description={staffMember.organizations?.name || "Organization not shown"}
        actions={
          <div className="form-actions">
            <StatusBadge value={staffMember.status} />
            <Link className="secondary-button" href="/staff/">
              Back to staff
            </Link>
            <Link className="primary-button" href={`/staff/edit/?id=${staffMember.id}`}>
              Edit staff
            </Link>
          </div>
        }
      />

      <div className="profile-grid">
        <DataSurface>
          <SurfaceHeader>
            <h2>Staff Identity</h2>
          </SurfaceHeader>
          <dl className="detail-list">
            <DetailRow label="Legal name" value={staffMember.legal_name} />
            <DetailRow label="Display name" value={staffMember.display_name} />
            <DetailRow label="Email" value={staffMember.email} />
            <DetailRow label="Phone" value={staffMember.phone} />
            <DetailRow label="Address" value={staffMember.address} />
          </dl>
        </DataSurface>

        <DataSurface>
          <SurfaceHeader>
            <h2>Employment</h2>
          </SurfaceHeader>
          <dl className="detail-list">
            <DetailRow label="Employment type" value={humanize(staffMember.employment_type)} />
            <DetailRow label="Status" value={<StatusBadge value={staffMember.status} />} />
            <DetailRow label="Start date" value={formatDate(staffMember.employment_start_date)} />
            <DetailRow label="End date" value={formatDate(staffMember.employment_end_date)} />
          </dl>
        </DataSurface>

        <DataSurface>
          <SurfaceHeader>
            <h2>Linked Account</h2>
          </SurfaceHeader>
          <dl className="detail-list">
            <DetailRow label="Profile name" value={staffMember.profiles?.full_name} />
            <DetailRow label="Profile email" value={staffMember.profiles?.email} />
            <DetailRow label="Profile status" value={staffMember.profiles ? <StatusBadge value={staffMember.profiles.status} /> : "Not linked"} />
          </dl>
        </DataSurface>

        <DataSurface>
          <SurfaceHeader>
            <h2>School Assignments</h2>
          </SurfaceHeader>
          {staffMember.staff_school_assignments?.length ? (
            <div className="stack-list">
              {staffMember.staff_school_assignments.map((assignment) => (
                <article className="list-card" key={assignment.id}>
                  <div className="list-card-header">
                    <strong>{assignment.schools?.name || "Unknown school"}</strong>
                    <StatusBadge value={assignment.status} />
                  </div>
                  <span>{assignment.can_teach ? "Can teach" : "Non-teaching assignment"}</span>
                  <span>
                    {formatDate(assignment.start_date)} - {formatDate(assignment.end_date)}
                  </span>
                </article>
              ))}
            </div>
          ) : (
            <EmptyState title="No school assignments" description="This staff member has not been assigned to a school yet." />
          )}
        </DataSurface>

        <DataSurface className="span-two">
          <SurfaceHeader>
            <h2>Notes</h2>
          </SurfaceHeader>
          <dl className="detail-list">
            <DetailRow label="Notes" value={staffMember.notes} />
          </dl>
        </DataSurface>

        {mayManagePayroll ? (
          <DataSurface className="span-two">
            <SurfaceHeader
              actions={
                <button
                  className="secondary-button"
                  onClick={() => setShowCompensationForm((current) => !current)}
                  type="button"
                >
                  {showCompensationForm ? "Close" : "Add term"}
                </button>
              }
            >
              <h2>Restricted Compensation History</h2>
            </SurfaceHeader>
            {compensation.error ? <p className="inline-alert">{compensation.error}</p> : null}
            {compensation.loading ? (
              <div className="table-placeholder">Loading compensation history...</div>
            ) : (
              <CompensationTermsList terms={compensation.terms} />
            )}
            {showCompensationForm ? (
              <div className="contact-editor">
                <CompensationTermForm
                  cancelHref={`/staff/profile/?id=${staffMember.id}`}
                  initialForm={createCompensationTermForm(null, staffMember.id)}
                  mode="inline"
                  onSubmit={handleCompensationSubmit}
                  schools={staffMember.staff_school_assignments || []}
                  submitting={submittingTerm}
                />
              </div>
            ) : null}
          </DataSurface>
        ) : null}
      </div>
    </>
  );
}

function DetailRow({ label, value }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value || "Not set"}</dd>
    </div>
  );
}

function StaffProfileLoading() {
  return (
    <>
      <PageHeader eyebrow="Staff management" title="Loading staff" />
      <div className="table-placeholder">Loading staff profile...</div>
    </>
  );
}
