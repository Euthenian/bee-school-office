"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ClassDeleteDialog } from "@/components/ClassDeleteDialog";
import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { DataSurface, ResponsiveTable } from "@/components/Surface";
import { useAuth } from "@/components/AuthProvider";
import { formatClassLevel, formatLessonDay, formatLessonTime, formatLessonType, formatTeacherName, lessonTypes } from "@/lib/class-details";
import { classStatuses, filterClasses, formatClassName, getClassActiveStudentCount } from "@/lib/classes";
import { deleteClass, fetchClasses, fetchSchools, updateClass } from "@/lib/data";
import { canManageClasses } from "@/lib/roles";
import { getSupabaseBrowserClient } from "@/lib/supabase";

export default function ClassesPage() {
  const { profile, session } = useAuth();
  const mayManage = canManageClasses(profile);
  const [filters, setFilters] = useState({ lessonType: "all", schoolId: "all", search: "", status: "active" });
  const [state, setState] = useState({ classes: [], error: "", loading: true, schools: [] });
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleteError, setDeleteError] = useState("");
  const [deletingId, setDeletingId] = useState("");
  const [deactivatingId, setDeactivatingId] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let active = true;

    async function loadClasses() {
      const supabase = getSupabaseBrowserClient();
      if (!supabase || !session || !mayManage) {
        setState((current) => ({ ...current, loading: false }));
        return;
      }

      setState((current) => ({ ...current, loading: true }));
      const [classesResult, schoolsResult] = await Promise.all([fetchClasses(supabase), fetchSchools(supabase)]);
      if (!active) return;

      const loadError = [classesResult.error, schoolsResult.error]
        .filter(Boolean)
        .map((error) => error.message)
        .join(" ");

      setState({
        classes: classesResult.data || [],
        error: loadError,
        loading: false,
        schools: schoolsResult.data || []
      });
    }

    loadClasses();

    return () => {
      active = false;
    };
  }, [mayManage, session]);

  const classes = useMemo(() => filterClasses(state.classes, filters), [filters, state.classes]);

  function handleDeleteRequest(classRow) {
    setNotice("");
    setDeleteError("");
    setDeleteTarget(classRow);
  }

  function handleDeleteCancel() {
    if (deletingId || deactivatingId) return;
    setDeleteError("");
    setDeleteTarget(null);
  }

  async function handleDeleteConfirm() {
    if (!deleteTarget) return;

    const supabase = getSupabaseBrowserClient();
    if (!supabase || !session) {
      setDeleteError("You must be signed in before deleting a class.");
      return;
    }

    setDeletingId(deleteTarget.id);
    setDeleteError("");
    const { error } = await deleteClass(supabase, deleteTarget.id);
    if (error) {
      setDeleteError(error.message);
      setDeletingId("");
      return;
    }

    setState((current) => ({
      ...current,
      classes: current.classes.filter((classRow) => classRow.id !== deleteTarget.id)
    }));
    setNotice("Class deleted.");
    setDeletingId("");
    setDeleteTarget(null);
  }

  async function handleDeactivateConfirm() {
    if (!deleteTarget) return;

    const supabase = getSupabaseBrowserClient();
    if (!supabase || !session) {
      setDeleteError("You must be signed in before deactivating a class.");
      return;
    }

    setDeactivatingId(deleteTarget.id);
    setDeleteError("");
    const { error } = await updateClass(supabase, buildInactiveClassInput(deleteTarget));
    if (error) {
      setDeleteError(error.message);
      setDeactivatingId("");
      return;
    }

    setState((current) => ({
      ...current,
      classes: current.classes.map((classRow) => (classRow.id === deleteTarget.id ? { ...classRow, status: "inactive" } : classRow))
    }));
    setNotice("Class deactivated.");
    setDeactivatingId("");
    setDeleteTarget(null);
  }

  if (!mayManage) {
    return (
      <>
        <PageHeader eyebrow="Teaching operations" title="Classes" />
        <DataSurface>
          <EmptyState title="Classes are not available" description="Your current role cannot manage class records." />
        </DataSurface>
      </>
    );
  }

  return (
    <>
      <PageHeader
        eyebrow="Teaching operations"
        title="Classes"
        description="Manage scheduled teaching units separately from student enrollments and lesson packages."
        actions={
          <Link className="primary-button" href="/classes/new/">
            Add class
          </Link>
        }
      />

      <div className="toolbar">
        <label className="search-field">
          <span>Search classes</span>
          <input
            onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value }))}
            placeholder="Day, level, teacher, or school"
            type="search"
            value={filters.search}
          />
        </label>
        <label>
          School
          <select onChange={(event) => setFilters((current) => ({ ...current, schoolId: event.target.value }))} value={filters.schoolId}>
            <option value="all">All schools</option>
            {state.schools.map((school) => (
              <option key={school.id} value={school.id}>
                {school.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Lesson type
          <select onChange={(event) => setFilters((current) => ({ ...current, lessonType: event.target.value }))} value={filters.lessonType}>
            <option value="all">All lesson types</option>
            {lessonTypes.map((type) => (
              <option key={type.value} value={type.value}>
                {type.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Status
          <select onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value }))} value={filters.status}>
            <option value="all">All statuses</option>
            {classStatuses.map((status) => (
              <option key={status.value} value={status.value}>
                {status.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {state.error ? <p className="inline-alert">{state.error}</p> : null}
      {notice ? <p className="inline-success">{notice}</p> : null}

      {deleteTarget ? (
        <ClassDeleteDialog
          classRow={deleteTarget}
          deactivating={deactivatingId === deleteTarget.id}
          deleting={deletingId === deleteTarget.id}
          error={deleteError}
          onCancel={handleDeleteCancel}
          onConfirm={handleDeleteConfirm}
          onDeactivate={handleDeactivateConfirm}
        />
      ) : null}

      <DataSurface aria-label="Classes list">
        {state.loading ? (
          <div className="table-placeholder">Loading classes...</div>
        ) : classes.length ? (
          <ResponsiveTable>
            <table>
              <thead>
                <tr>
                  <th>Class</th>
                  <th>School</th>
                  <th>Lesson type</th>
                  <th>Level</th>
                  <th>Day</th>
                  <th>Time</th>
                  <th>Teacher</th>
                  <th>Status</th>
                  <th>Students</th>
                  <th className="classes-actions-column">Actions</th>
                </tr>
              </thead>
              <tbody>
                {classes.map((classRow) => (
                  <tr key={classRow.id}>
                    <td>
                      <Link href={`/classes/profile/?id=${classRow.id}`}>{formatClassName(classRow)}</Link>
                    </td>
                    <td>{classRow.schools?.name || "Not assigned"}</td>
                    <td>{formatLessonType(classRow.lesson_type)}</td>
                    <td>{formatClassLevel(classRow)}</td>
                    <td>{formatLessonDay(classRow.lesson_day)}</td>
                    <td>{formatLessonTime(classRow.lesson_time)}</td>
                    <td>{formatTeacherName(classRow.assigned_teacher)}</td>
                    <td>
                      <StatusBadge value={classRow.status} />
                    </td>
                    <td>{getClassActiveStudentCount(classRow)}</td>
                    <td className="classes-actions-cell">
                      <div className="table-actions classes-row-actions">
                        <Link className="secondary-button" href={`/classes/profile/?id=${classRow.id}`}>
                          View
                        </Link>
                        <Link className="secondary-button" href={`/classes/edit/?id=${classRow.id}`}>
                          Edit
                        </Link>
                        <button className="danger-button class-delete-button" onClick={() => handleDeleteRequest(classRow)} type="button">
                          <TrashIcon />
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ResponsiveTable>
        ) : (
          <EmptyState title="No classes found" description="No class records matched the current filters." />
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
