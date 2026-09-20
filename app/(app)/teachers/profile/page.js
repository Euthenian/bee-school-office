"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { DataSurface, SurfaceHeader } from "@/components/Surface";
import { useAuth } from "@/components/AuthProvider";
import { fetchStaffMember, fetchTeacherAssignedClasses, fetchTeacherUpcomingTrialLessons } from "@/lib/data";
import { formatLessonDay, formatLessonTime, formatLessonType } from "@/lib/class-details";
import { formatDate } from "@/lib/format";
import { canManageStaff } from "@/lib/roles";
import { formatStaffName } from "@/lib/staff";
import { formatProspectName } from "@/lib/trial-lessons";
import { getTeachingAssignments, getTeacherContactEmail, getTeacherLinkedAccountLabel } from "@/lib/teachers";
import { getSupabaseBrowserClient } from "@/lib/supabase";

export default function TeacherProfilePage() {
  return (
    <Suspense fallback={<TeacherProfileLoading />}>
      <TeacherProfileContent />
    </Suspense>
  );
}

function TeacherProfileContent() {
  const { profile, session } = useAuth();
  const searchParams = useSearchParams();
  const staffId = searchParams.get("id") || "";
  const mayManage = canManageStaff(profile);
  const [state, setState] = useState({
    assignedClasses: [],
    error: "",
    loading: true,
    staffMember: null,
    trialLessons: []
  });

  useEffect(() => {
    let active = true;

    async function loadTeacherProfile() {
      const supabase = getSupabaseBrowserClient();
      if (!supabase || !session || !staffId || !mayManage) {
        setState((current) => ({ ...current, loading: false }));
        return;
      }

      setState((current) => ({ ...current, loading: true }));
      const staffResult = await fetchStaffMember(supabase, staffId);
      if (!active) return;

      const staffMember = staffResult.data || null;
      const profileId = staffMember?.profile_id || "";
      const [classesResult, trialLessonsResult] = await Promise.all([
        fetchTeacherAssignedClasses(supabase, profileId),
        fetchTeacherUpcomingTrialLessons(supabase, profileId)
      ]);
      if (!active) return;

      const loadError = [staffResult.error, classesResult.error, trialLessonsResult.error]
        .filter(Boolean)
        .map((error) => error.message)
        .join(" ");

      setState({
        assignedClasses: classesResult.data || [],
        error: loadError,
        loading: false,
        staffMember,
        trialLessons: trialLessonsResult.data || []
      });
    }

    loadTeacherProfile();

    return () => {
      active = false;
    };
  }, [mayManage, session, staffId]);

  if (!mayManage) {
    return (
      <>
        <PageHeader eyebrow="Teaching operations" title="Teacher Profile" />
        <DataSurface>
          <EmptyState
            title="Teacher profiles are not available"
            description="Your current role can view teaching work but cannot manage staff records."
          />
        </DataSurface>
      </>
    );
  }

  if (!staffId && !state.loading) {
    return (
      <>
        <PageHeader eyebrow="Teaching operations" title="Teacher not selected" />
        <EmptyState title="No staff ID was provided" description="Open a teacher from the Teachers list." />
      </>
    );
  }

  if (state.loading) {
    return <TeacherProfileLoading />;
  }

  if (state.error || !state.staffMember) {
    return (
      <>
        <PageHeader eyebrow="Teaching operations" title="Teacher unavailable" />
        <p className="inline-alert">{state.error || "This teacher could not be found or is not visible to your role."}</p>
        <Link className="secondary-button" href="/teachers/">
          Back to teachers
        </Link>
      </>
    );
  }

  const staffMember = state.staffMember;
  const teachingAssignments = getTeachingAssignments(staffMember);

  return (
    <>
      <PageHeader
        eyebrow="Teaching operations"
        title={formatStaffName(staffMember)}
        description={staffMember.organizations?.name || "Organization not shown"}
        actions={
          <div className="form-actions">
            <StatusBadge value={staffMember.status} />
            <Link className="secondary-button" href="/teachers/">
              Back to teachers
            </Link>
            <Link className="primary-button" href={`/teachers/edit/?id=${staffMember.id}`}>
              Edit teacher
            </Link>
          </div>
        }
      />

      <div className="profile-grid">
        <DataSurface>
          <SurfaceHeader>
            <h2>Teacher Details</h2>
          </SurfaceHeader>
          <dl className="detail-list">
            <DetailRow label="Display name" value={staffMember.display_name || formatStaffName(staffMember)} />
            <DetailRow label="Legal name" value={staffMember.legal_name} />
            <DetailRow label="Email" value={getTeacherContactEmail(staffMember)} />
            <DetailRow label="Phone" value={staffMember.phone} />
            <DetailRow label="Status" value={<StatusBadge value={staffMember.status} />} />
          </dl>
        </DataSurface>

        <DataSurface>
          <SurfaceHeader>
            <h2>Linked Account</h2>
          </SurfaceHeader>
          <dl className="detail-list">
            <DetailRow label="Account status" value={getTeacherLinkedAccountLabel(staffMember)} />
            <DetailRow label="Profile name" value={staffMember.profiles?.full_name} />
            <DetailRow label="Profile email" value={staffMember.profiles?.email} />
          </dl>
        </DataSurface>

        <DataSurface className="span-two">
          <SurfaceHeader>
            <h2>Teaching Assignments</h2>
          </SurfaceHeader>
          {teachingAssignments.length ? (
            <div className="stack-list">
              {teachingAssignments.map((assignment) => (
                <article className="list-card" key={assignment.id}>
                  <div className="list-card-header">
                    <strong>{assignment.schools?.name || "Unknown school"}</strong>
                    <StatusBadge value={assignment.status} />
                  </div>
                  <span>Can teach</span>
                  <span>
                    {formatDate(assignment.start_date)} - {formatDate(assignment.end_date)}
                  </span>
                </article>
              ))}
            </div>
          ) : (
            <EmptyState title="No teaching assignments" description="This staff record is not marked can teach at any school." />
          )}
        </DataSurface>

        <DataSurface>
          <SurfaceHeader>
            <h2>Current Classes</h2>
          </SurfaceHeader>
          {state.assignedClasses.length ? (
            <div className="stack-list">
              {state.assignedClasses.map((classRow) => (
                <article className="list-card" key={classRow.id}>
                  <div className="list-card-header">
                    <strong>{classRow.class_levels?.label || "Class"}</strong>
                    <StatusBadge value={classRow.status} />
                  </div>
                  <span>{classRow.schools?.name || "Unknown school"}</span>
                  <span>
                    {[formatLessonType(classRow.lesson_type), formatLessonDay(classRow.lesson_day), formatLessonTime(classRow.lesson_time)]
                      .filter((item) => item && item !== "Not set")
                      .join(" / ") || "Schedule not set"}
                  </span>
                </article>
              ))}
            </div>
          ) : (
            <EmptyState title="No assigned classes" description="No current class records are assigned to this teacher account." />
          )}
        </DataSurface>

        <DataSurface>
          <SurfaceHeader>
            <h2>Upcoming Trial Lessons</h2>
          </SurfaceHeader>
          {state.trialLessons.length ? (
            <div className="stack-list">
              {state.trialLessons.map((trialLesson) => (
                <article className="list-card" key={trialLesson.id}>
                  <div className="list-card-header">
                    <strong>{formatProspectName(trialLesson.prospects)}</strong>
                    <StatusBadge value={trialLesson.status} />
                  </div>
                  <span>{trialLesson.schools?.name || "Unknown school"}</span>
                  <span>
                    {formatDate(trialLesson.trial_date)} {formatLessonTime(trialLesson.trial_time)}
                  </span>
                  <span>
                    {[trialLesson.class_levels?.label, formatLessonType(trialLesson.lesson_type)]
                      .filter((item) => item && item !== "Not set")
                      .join(" / ") || "Class details not set"}
                  </span>
                </article>
              ))}
            </div>
          ) : (
            <EmptyState title="No upcoming trial lessons" description="No upcoming trial lessons are assigned to this teacher account." />
          )}
        </DataSurface>
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

function TeacherProfileLoading() {
  return (
    <>
      <PageHeader eyebrow="Teaching operations" title="Loading teacher" />
      <div className="table-placeholder">Loading teacher profile...</div>
    </>
  );
}
