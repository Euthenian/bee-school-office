"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ClassDeleteDialog } from "@/components/ClassDeleteDialog";
import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { DataSurface, ResponsiveTable, SurfaceHeader } from "@/components/Surface";
import { useAuth } from "@/components/AuthProvider";
import { formatClassLevel, formatLessonDay, formatLessonTime, formatLessonType, formatTeacherName } from "@/lib/class-details";
import { formatClassName } from "@/lib/classes";
import { deleteClass, fetchClassProfile, updateClass } from "@/lib/data";
import { formatDate, formatPersonName } from "@/lib/format";
import { canManageClasses } from "@/lib/roles";
import { getSupabaseBrowserClient } from "@/lib/supabase";

export default function ClassProfilePage() {
  return (
    <Suspense fallback={<ClassProfileLoading />}>
      <ClassProfileContent />
    </Suspense>
  );
}

function ClassProfileContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const classId = searchParams.get("id") || "";
  const { profile, session } = useAuth();
  const mayManage = canManageClasses(profile);
  const [state, setState] = useState({ classRow: null, error: "", loading: true });
  const [deleteError, setDeleteError] = useState("");
  const [deactivating, setDeactivating] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  useEffect(() => {
    let active = true;

    async function loadClass() {
      const supabase = getSupabaseBrowserClient();
      if (!supabase || !session || !classId || !mayManage) {
        setState({ classRow: null, error: "", loading: false });
        return;
      }

      setState((current) => ({ ...current, loading: true }));
      const { data, error } = await fetchClassProfile(supabase, classId);
      if (!active) return;

      setState({
        classRow: data || null,
        error: error?.message || "",
        loading: false
      });
    }

    loadClass();

    return () => {
      active = false;
    };
  }, [classId, mayManage, session]);

  if (!mayManage) {
    return (
      <>
        <PageHeader eyebrow="Teaching operations" title="Class" />
        <DataSurface>
          <EmptyState title="Class details are not available" description="Your current role cannot view class management records." />
        </DataSurface>
      </>
    );
  }

  if (!classId && !state.loading) {
    return (
      <>
        <PageHeader eyebrow="Teaching operations" title="Class not selected" />
        <EmptyState title="No class ID was provided" description="Open a class from the Classes list." />
      </>
    );
  }

  if (state.loading) return <ClassProfileLoading />;

  if (!state.classRow) {
    return (
      <>
        <PageHeader eyebrow="Teaching operations" title="Class unavailable" />
        <p className="inline-alert">{state.error || "This class could not be found or is not visible to your role."}</p>
        <Link className="secondary-button" href="/classes/">
          Back to classes
        </Link>
      </>
    );
  }

  const classRow = state.classRow;
  const enrollments = classRow.student_enrollments || [];

  function handleDeleteRequest() {
    setDeleteError("");
    setShowDeleteDialog(true);
  }

  function handleDeleteCancel() {
    if (deleting || deactivating) return;
    setDeleteError("");
    setShowDeleteDialog(false);
  }

  async function handleDeleteConfirm() {
    const supabase = getSupabaseBrowserClient();
    if (!supabase || !session) {
      setDeleteError("You must be signed in before deleting a class.");
      return;
    }

    setDeleting(true);
    setDeleteError("");
    const { error } = await deleteClass(supabase, classRow.id);
    if (error) {
      setDeleteError(error.message);
      setDeleting(false);
      return;
    }

    router.push("/classes/");
  }

  async function handleDeactivateConfirm() {
    const supabase = getSupabaseBrowserClient();
    if (!supabase || !session) {
      setDeleteError("You must be signed in before deactivating a class.");
      return;
    }

    setDeactivating(true);
    setDeleteError("");
    const { error } = await updateClass(supabase, buildInactiveClassInput(classRow));
    if (error) {
      setDeleteError(error.message);
      setDeactivating(false);
      return;
    }

    setState((current) => ({
      ...current,
      classRow: current.classRow ? { ...current.classRow, status: "inactive" } : current.classRow
    }));
    setDeactivating(false);
    setShowDeleteDialog(false);
  }

  return (
    <>
      <PageHeader
        eyebrow="Teaching operations"
        title={formatClassName(classRow)}
        description={`${classRow.schools?.name || "School not set"} · ${formatLessonType(classRow.lesson_type)}`}
        actions={
          <div className="form-actions">
            <StatusBadge value={classRow.status} />
            <Link className="secondary-button" href={`/classes/edit/?id=${classRow.id}`}>
              Edit class
            </Link>
            <button className="danger-button class-delete-button" onClick={handleDeleteRequest} type="button">
              <TrashIcon />
              Delete class
            </button>
            <Link className="secondary-button" href="/classes/">
              Back to classes
            </Link>
          </div>
        }
      />

      {state.error ? <p className="inline-alert">{state.error}</p> : null}

      {showDeleteDialog ? (
        <ClassDeleteDialog
          classRow={classRow}
          deactivating={deactivating}
          deleting={deleting}
          error={deleteError}
          onCancel={handleDeleteCancel}
          onConfirm={handleDeleteConfirm}
          onDeactivate={handleDeactivateConfirm}
        />
      ) : null}

      <DataSurface>
        <SurfaceHeader>
          <h2>Class Details</h2>
        </SurfaceHeader>
        <dl className="detail-list">
          <div>
            <dt>School</dt>
            <dd>{classRow.schools?.name || "Not assigned"}</dd>
          </div>
          <div>
            <dt>Lesson type</dt>
            <dd>{formatLessonType(classRow.lesson_type)}</dd>
          </div>
          <div>
            <dt>Level</dt>
            <dd>{formatClassLevel(classRow)}</dd>
          </div>
          <div>
            <dt>Day</dt>
            <dd>{formatLessonDay(classRow.lesson_day)}</dd>
          </div>
          <div>
            <dt>Time</dt>
            <dd>{formatLessonTime(classRow.lesson_time)}</dd>
          </div>
          <div>
            <dt>Teacher</dt>
            <dd>{formatTeacherName(classRow.assigned_teacher)}</dd>
          </div>
          <div>
            <dt>Status</dt>
            <dd>{classRow.status}</dd>
          </div>
        </dl>
      </DataSurface>

      <DataSurface>
        <SurfaceHeader>
          <h2>Students</h2>
        </SurfaceHeader>
        {enrollments.length ? (
          <ResponsiveTable>
            <table>
              <thead>
                <tr>
                  <th>Student</th>
                  <th>Student status</th>
                  <th>Enrollment status</th>
                  <th>Start date</th>
                  <th>End date</th>
                </tr>
              </thead>
              <tbody>
                {enrollments.map((enrollment) => (
                  <tr key={enrollment.id}>
                    <td>
                      {enrollment.students ? (
                        <Link href={`/students/profile/?id=${enrollment.students.id}`}>{formatPersonName(enrollment.students)}</Link>
                      ) : (
                        "Student unavailable"
                      )}
                    </td>
                    <td>{enrollment.students?.status || "Unknown"}</td>
                    <td>
                      <StatusBadge value={enrollment.status} />
                    </td>
                    <td>{formatDate(enrollment.start_date)}</td>
                    <td>{formatDate(enrollment.end_date)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ResponsiveTable>
        ) : (
          <EmptyState title="No enrolled students" description="Students can be assigned to this class from the student create/edit form." />
        )}
      </DataSurface>
    </>
  );
}

function buildInactiveClassInput(classRow) {
  return {
    assignedTeacherProfileId: classRow.assigned_teacher_profile_id,
    classId: classRow.id,
    classLevelId: classRow.level_id,
    lessonDay: classRow.lesson_day,
    lessonTime: classRow.lesson_time,
    lessonType: classRow.lesson_type,
    schoolId: classRow.school_id,
    status: "inactive"
  };
}

function TrashIcon() {
  return (
    <svg aria-hidden="true" className="action-icon" focusable="false" viewBox="0 0 24 24">
      <path d="M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3M5 7h14" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
    </svg>
  );
}

function ClassProfileLoading() {
  return (
    <>
      <PageHeader eyebrow="Teaching operations" title="Loading class" />
      <div className="table-placeholder">Loading class details...</div>
    </>
  );
}
