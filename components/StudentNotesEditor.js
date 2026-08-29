"use client";

import { addNoteRow, noteVisibilities, removeNoteRow, updateNoteRow } from "@/lib/student-form";

export function StudentNotesEditor({ rows, onChange }) {
  return (
    <div className="stack-list">
      {rows.map((row, index) => (
        <article className="list-card" key={row.id}>
          <div className="list-card-header">
            <strong>Note {index + 1}</strong>
            <button
              className="ghost-button contact-remove-button"
              disabled={rows.length === 1}
              onClick={() => onChange(removeNoteRow(rows, row.id))}
              type="button"
            >
              Remove
            </button>
          </div>
          <div className="form-grid nested-form-grid">
            <label>
              Visibility
              <select onChange={(event) => onChange(updateNoteRow(rows, row.id, "visibility", event.target.value))} value={row.visibility}>
                {noteVisibilities.map((visibility) => (
                  <option key={visibility.value} value={visibility.value}>
                    {visibility.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Note
              <textarea onChange={(event) => onChange(updateNoteRow(rows, row.id, "note", event.target.value))} rows="4" value={row.note} />
            </label>
          </div>
        </article>
      ))}
      <button className="ghost-button contact-add-button" onClick={() => onChange(addNoteRow(rows))} type="button">
        + Add note
      </button>
    </div>
  );
}
