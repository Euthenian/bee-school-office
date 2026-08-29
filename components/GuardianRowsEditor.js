"use client";

import { addGuardianRow, removeGuardianRow, updateGuardianRow } from "@/lib/student-form";

export function GuardianRowsEditor({ rows, onChange }) {
  return (
    <div className="stack-list">
      {rows.map((row, index) => (
        <article className="list-card" key={row.id}>
          <div className="list-card-header">
            <strong>Guardian {index + 1}</strong>
            <button
              className="ghost-button contact-remove-button"
              disabled={rows.length === 1}
              onClick={() => onChange(removeGuardianRow(rows, row.id))}
              type="button"
            >
              Remove
            </button>
          </div>
          <div className="form-grid nested-form-grid">
            <label>
              Guardian name
              <input
                autoComplete="name"
                onChange={(event) => onChange(updateGuardianRow(rows, row.id, "fullName", event.target.value))}
                value={row.fullName}
              />
            </label>
            <label>
              Relationship
              <input onChange={(event) => onChange(updateGuardianRow(rows, row.id, "relationship", event.target.value))} value={row.relationship} />
            </label>
            <label>
              Guardian email
              <input
                autoComplete="email"
                onChange={(event) => onChange(updateGuardianRow(rows, row.id, "email", event.target.value))}
                type="email"
                value={row.email}
              />
            </label>
            <label>
              Guardian phone
              <input
                autoComplete="tel"
                onChange={(event) => onChange(updateGuardianRow(rows, row.id, "phone", event.target.value))}
                value={row.phone}
              />
            </label>
            <label>
              Guardian notes
              <textarea onChange={(event) => onChange(updateGuardianRow(rows, row.id, "notes", event.target.value))} rows="3" value={row.notes} />
            </label>
          </div>
        </article>
      ))}
      <button className="ghost-button contact-add-button" onClick={() => onChange(addGuardianRow(rows))} type="button">
        + Add guardian
      </button>
    </div>
  );
}
