"use client";

import { formatClassLevel, formatLessonDay, formatLessonTime, formatLessonType, formatTeacherName } from "@/lib/class-details";
import { getClassEnrollmentCount } from "@/lib/classes";

export function ClassDeleteDialog({ classRow, deactivating = false, deleting, error, onCancel, onConfirm, onDeactivate }) {
  if (!classRow) return null;

  const enrollmentHistoryCount = getClassEnrollmentCount(classRow);
  const hasEnrollmentHistory = enrollmentHistoryCount > 0;
  const canDeactivate = hasEnrollmentHistory && classRow.status === "active" && onDeactivate;
  const busy = deleting || deactivating;

  return (
    <div className="modal-backdrop" role="presentation">
      <section
        aria-describedby="delete-class-description"
        aria-labelledby="delete-class-title"
        aria-modal="true"
        className="communication-modal confirmation-modal"
        role="dialog"
      >
        <header className="communication-modal-header">
          <h2 id="delete-class-title">Delete class?</h2>
        </header>
        <div className="confirmation-modal-body">
          <div id="delete-class-description" className="table-cell-stack">
            <strong>{[formatLessonDay(classRow.lesson_day), formatLessonTime(classRow.lesson_time), formatClassLevel(classRow), formatLessonType(classRow.lesson_type)].filter(Boolean).join(" - ")}</strong>
            <span>Teacher: {formatTeacherName(classRow.assigned_teacher)}</span>
            <span>Enrolled student history: {enrollmentHistoryCount}</span>
          </div>
          {hasEnrollmentHistory ? (
            <p className="inline-alert">
              This class cannot be deleted because it has student enrollment history. You can deactivate the class instead.
            </p>
          ) : (
            <p>This action cannot be undone.</p>
          )}
          {error ? <p className="inline-alert">{error}</p> : null}
        </div>
        <div className="form-actions confirmation-modal-actions">
          <button className="secondary-button" disabled={busy} onClick={onCancel} type="button">
            {hasEnrollmentHistory ? "Close" : "Cancel"}
          </button>
          {canDeactivate ? (
            <button className="primary-button" disabled={busy} onClick={onDeactivate} type="button">
              {deactivating ? "Deactivating..." : "Deactivate class"}
            </button>
          ) : null}
          {!hasEnrollmentHistory ? (
            <button className="danger-button" disabled={busy} onClick={onConfirm} type="button">
              {deleting ? "Deleting..." : "Delete class"}
            </button>
          ) : null}
        </div>
      </section>
    </div>
  );
}
