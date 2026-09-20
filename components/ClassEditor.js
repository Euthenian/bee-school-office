"use client";

import Link from "next/link";
import { lessonDays, lessonTypes } from "@/lib/class-details";
import { classStatuses } from "@/lib/classes";

export function ClassEditor({
  cancelHref,
  classLevels = [],
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
          Lesson type
          <select onChange={(event) => onChange("lessonType", event.target.value)} required value={form.lessonType}>
            {lessonTypes.map((type) => (
              <option key={type.value} value={type.value}>
                {type.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Level
          <select onChange={(event) => onChange("classLevelId", event.target.value)} required value={form.classLevelId}>
            <option value="">Select a level</option>
            {classLevels.map((level) => (
              <option key={level.id} value={level.id}>
                {level.label}
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
          Assigned teacher
          <select
            disabled={!form.schoolId || loadingTeachers}
            onChange={(event) => onChange("assignedTeacherProfileId", event.target.value)}
            value={form.assignedTeacherProfileId}
          >
            <option value="">{loadingTeachers ? "Loading teachers..." : "No teacher assigned"}</option>
            {teachers.map((teacher) => (
              <option key={teacher.profile_id} value={teacher.profile_id}>
                {teacher.full_name || teacher.email}
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
