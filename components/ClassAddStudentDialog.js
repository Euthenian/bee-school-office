"use client";

import { useEffect, useState } from "react";
import { formatClassName } from "@/lib/classes";
import { addExistingStudentToClass, searchClassStudentCandidates } from "@/lib/data";
import { formatPersonName } from "@/lib/format";
import { getSupabaseBrowserClient } from "@/lib/supabase";

export function ClassAddStudentDialog({ classRow, onAdded, onCancel }) {
  const [search, setSearch] = useState("");
  const [students, setStudents] = useState([]);
  const [studentId, setStudentId] = useState("");
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    if (!search.trim()) return undefined;
    const timer = setTimeout(async () => {
      const supabase = getSupabaseBrowserClient();
      if (!supabase) {
        setError("You must be signed in to search students.");
        setLoading(false);
        return;
      }
      setLoading(true);
      const { data, error: searchError } = await searchClassStudentCandidates(
        supabase, classRow, search
      );
      if (!active) return;
      setStudents(data || []);
      setError(searchError?.message || "");
      setLoading(false);
    }, 250);
    return () => { active = false; clearTimeout(timer); };
  }, [classRow, search]);

  async function handleSubmit(event) {
    event.preventDefault();
    if (!studentId || !students.some((student) => student.id === studentId)) {
      setError("Choose a student from the search results.");
      return;
    }
    setSubmitting(true);
    setError("");
    const supabase = getSupabaseBrowserClient();
    if (!supabase) {
      setError("You must be signed in to add a student.");
      setSubmitting(false);
      return;
    }
    const { error: addError } = await addExistingStudentToClass(
      supabase, classRow.id, studentId
    );
    if (addError) {
      setError(addError.message);
      setSubmitting(false);
      return;
    }
    const refreshError = await onAdded();
    if (refreshError) {
      setError(`Student was added. Refresh the page to update the list: ${refreshError}`);
      setSubmitting(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <section aria-labelledby="class-add-student-title" aria-modal="true" className="communication-modal" role="dialog">
        <header className="communication-modal-header">
          <div><p className="eyebrow">Class students</p><h2 id="class-add-student-title">Add Student</h2></div>
          <button className="ghost-button" disabled={submitting} onClick={onCancel} type="button">Cancel</button>
        </header>
        <form className="student-form" onSubmit={handleSubmit}>
          <div className="confirmation-modal-body">
            <p>Adding to {formatClassName(classRow)} at {classRow.schools?.name || "this school"}.</p>
            <label><span>Search student</span><input autoFocus onChange={(event) => {
              setSearch(event.target.value);
              setStudentId("");
              setStudents([]);
              setLoading(false);
              setError("");
            }} placeholder="Search by name" type="search" value={search} /></label>
            {loading ? <p>Searching students...</p> : null}
            {search.trim() && !loading && !students.length ? <p>No matching active students in this school.</p> : null}
            {students.length ? <fieldset><legend>Select student</legend>
              {students.map((student) => {
                const activeEnrollment = (student.student_enrollments || []).find((row) => row.status === "active");
                const assigned = Boolean(activeEnrollment);
                return <label className="communication-template-row" key={student.id}>
                  <input checked={studentId === student.id} disabled={assigned || submitting} name="student" onChange={() => setStudentId(student.id)} type="radio" />
                  <span><strong>{formatPersonName(student)}</strong><span>
                    {assigned ? activeEnrollment.class_id === classRow.id
                      ? "Already in this class"
                      : `Active in ${activeEnrollment.classes ? formatClassName(activeEnrollment.classes) : "another class"}`
                      : "Active student · No active class enrollment"}
                  </span></span>
                </label>;
              })}
            </fieldset> : null}
            {error ? <p className="inline-alert" role="alert">{error}</p> : null}
          </div>
          <div className="form-actions confirmation-modal-actions">
            <button className="secondary-button" disabled={submitting} onClick={onCancel} type="button">Cancel</button>
            <button className="primary-button" disabled={!studentId || submitting} type="submit">
              {submitting ? "Adding..." : "Add to Class"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
