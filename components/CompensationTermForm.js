"use client";

import { useState } from "react";
import Link from "next/link";
import { EmptyState } from "@/components/EmptyState";
import { DataSurface, SurfaceHeader } from "@/components/Surface";
import {
  compensationTypes,
  compensationUnits,
  defaultUnitForCompensationType,
  validateCompensationTermForm
} from "@/lib/payroll";

export function CompensationTermForm({
  cancelHref,
  initialForm,
  mode = "standalone",
  onSubmit,
  schools = [],
  submitting = false
}) {
  const [form, setForm] = useState(initialForm);
  const [localError, setLocalError] = useState("");
  const activeSchools = schools.filter((school) => school.status === "active" || school.schools?.status === "active");

  function updateField(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function updateCompensationType(value) {
    setForm((current) => ({
      ...current,
      compensationType: value,
      unit: defaultUnitForCompensationType(value)
    }));
  }

  function handleSubmit(event) {
    event.preventDefault();
    setLocalError("");

    const validationError = validateCompensationTermForm(form);
    if (validationError) {
      setLocalError(validationError);
      return;
    }

    onSubmit(form);
  }

  const fields = (
    <>
      <SurfaceHeader>
        <h2>Compensation Term</h2>
      </SurfaceHeader>
      <div className="form-grid">
        <label>
          School scope
          <select onChange={(event) => updateField("schoolId", event.target.value)} value={form.schoolId}>
            <option value="">Organization-wide</option>
            {activeSchools.map((school) => (
              <option key={school.id || school.school_id} value={school.id || school.school_id}>
                {school.name || school.schools?.name || "Unnamed school"}
              </option>
            ))}
          </select>
        </label>
        <label>
          Compensation type
          <select
            onChange={(event) => updateCompensationType(event.target.value)}
            required
            value={form.compensationType}
          >
            {compensationTypes.map((type) => (
              <option key={type.value} value={type.value}>
                {type.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Rate or amount
          <input
            inputMode="decimal"
            min="0"
            onChange={(event) => updateField("amount", event.target.value)}
            step="0.01"
            type="number"
            value={form.amount}
          />
        </label>
        <label>
          Unit
          <select onChange={(event) => updateField("unit", event.target.value)} required value={form.unit}>
            {compensationUnits.map((unit) => (
              <option key={unit.value} value={unit.value}>
                {unit.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Currency
          <input
            maxLength="3"
            onChange={(event) => updateField("currency", event.target.value.toUpperCase())}
            required
            value={form.currency}
          />
        </label>
        <label>
          Effective from
          <input onChange={(event) => updateField("effectiveFrom", event.target.value)} required type="date" value={form.effectiveFrom} />
        </label>
        <label>
          Effective to
          <input onChange={(event) => updateField("effectiveTo", event.target.value)} type="date" value={form.effectiveTo} />
        </label>
      </div>
      <div className="form-grid single-column">
        <label>
          Notes
          <textarea onChange={(event) => updateField("notes", event.target.value)} rows="3" value={form.notes} />
        </label>
      </div>
    </>
  );

  return (
    <form className="student-form" onSubmit={handleSubmit}>
      {localError ? <p className="inline-alert">{localError}</p> : null}

      {mode === "inline" ? fields : <DataSurface>{fields}</DataSurface>}

      <div className="form-actions">
        {mode === "inline" ? null : (
          <Link className="secondary-button" href={cancelHref}>
            Cancel
          </Link>
        )}
        <button className="primary-button" disabled={submitting} type="submit">
          {submitting ? "Saving..." : "Add compensation term"}
        </button>
      </div>
    </form>
  );
}

export function CompensationTermsList({ terms = [] }) {
  if (!terms.length) {
    return <EmptyState title="No compensation terms" description="No restricted compensation history has been recorded for this staff member." />;
  }

  return (
    <div className="stack-list">
      {terms.map((term) => (
        <article className="list-card" key={term.id}>
          <div className="list-card-header">
            <strong>{term.compensation_type}</strong>
            <span>
              {term.amount} {term.currency} / {term.unit}
            </span>
          </div>
          <span>{term.schools?.name || "Organization-wide"}</span>
          <span>
            {term.effective_from || "Not set"} - {term.effective_to || "Present"}
          </span>
          {term.notes ? <p>{term.notes}</p> : null}
        </article>
      ))}
    </div>
  );
}
