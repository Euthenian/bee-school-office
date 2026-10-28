"use client";

import Link from "next/link";
import { formatTeacherOptionName } from "@/components/StudentClassAssignment";
import { lessonDays } from "@/lib/class-details";
import { classStatuses } from "@/lib/classes";

export function ClassEditor({
  cancelHref,
  form,
  loadingTeachers,
  onChange,
  onSubmit,
  schools = [],
  submitLabel = "Save class",
  submitting,
  teachers = []
}) {
  return (
    <form className="student-form" onSubmit={onSubmit}>
      <div className="form-grid">
        <label>
          School
          <select onChange={(event) => onChange("schoolId", event.target.value)} required value={form.schoolId}>
            <option value="">Select a school</option>
            {schools.map((school) => (
              <option key={school.id} value={school.id}>
                {school.name} - {school.organizations?.name || "Organization not shown"}
              </option>
            ))}
          </select>
        </label>
        <label>
          Lesson day
          <select onChange={(event) => onChange("lessonDay", event.target.value)} required value={form.lessonDay}>
            <option value="">Select a day</option>
            {lessonDays.map((day) => (
              <option key={day.value} value={day.value}>
                {day.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Lesson time
          <input onChange={(event) => onChange("lessonTime", event.target.value)} required type="time" value={form.lessonTime} />
        </label>
        <label>
          Teacher
          <select
            disabled={!form.schoolId || loadingTeachers}
            onChange={(event) => onChange("assignedTeacherStaffId", event.target.value)}
            value={form.assignedTeacherStaffId}
          >
            <option value="">{loadingTeachers ? "Loading teachers..." : "No class teacher"}</option>
            {teachers.map((teacher) => (
              <option key={teacher.staff_id} value={teacher.staff_id}>
                {formatTeacherOptionName(teacher)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Status
          <select onChange={(event) => onChange("status", event.target.value)} required value={form.status}>
            {classStatuses.map((status) => (
              <option key={status.value} value={status.value}>
                {status.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="form-actions">
        <Link className="secondary-button" href={cancelHref}>
          Cancel
        </Link>
        <button className="primary-button" disabled={submitting} type="submit">
          {submitting ? "Saving..." : submitLabel}
        </button>
      </div>
    </form>
  );
}
