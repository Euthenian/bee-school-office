"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { DataSurface, SurfaceHeader } from "@/components/Surface";
import { payrollPeriodStatuses, validatePayrollPeriodForm } from "@/lib/payroll";

export function PayrollPeriodForm({
  cancelHref,
  initialForm,
  mode = "create",
  onSubmit,
  organizations = [],
  schools = [],
  submitting = false
}) {
  const [form, setForm] = useState(initialForm);
  const [localError, setLocalError] = useState("");
  const activeOrganizations = organizations.filter((organization) => organization.status === "active");
  const filteredSchools = useMemo(
    () =>
      schools.filter((school) => {
        const organizationId = school.organization_id || school.organizations?.id || "";
        return school.status === "active" && (!organizationId || organizationId === form.organizationId);
      }),
    [form.organizationId, schools]
  );

  function updateField(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function updateOrganization(value) {
    setForm((current) => ({ ...current, organizationId: value, schoolId: "" }));
  }

  function updateScope(value) {
    setForm((current) => ({ ...current, scope: value, schoolId: value === "organization" ? "" : current.schoolId }));
  }

  function handleSubmit(event) {
    event.preventDefault();
    setLocalError("");

    const validationError = validatePayrollPeriodForm(form);
    if (validationError) {
      setLocalError(validationError);
      return;
    }

    onSubmit(form);
  }

  return (
    <form className="student-form" onSubmit={handleSubmit}>
      {localError ? <p className="inline-alert">{localError}</p> : null}

      <DataSurface>
        <SurfaceHeader>
          <h2>Payroll Period</h2>
        </SurfaceHeader>
        <div className="form-grid">
          <label>
            Organization
            <select
              disabled={mode === "edit"}
              onChange={(event) => updateOrganization(event.target.value)}
              required
              value={form.organizationId}
            >
              <option value="">Select an organization</option>
              {activeOrganizations.map((organization) => (
                <option key={organization.id} value={organization.id}>
                  {organization.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Scope
            <select disabled={mode === "edit"} onChange={(event) => updateScope(event.target.value)} required value={form.scope}>
              <option value="organization">Organization-wide</option>
              <option value="school">School</option>
            </select>
          </label>
          {form.scope === "school" ? (
            <label>
              School
              <select disabled={mode === "edit"} onChange={(event) => updateField("schoolId", event.target.value)} required value={form.schoolId}>
                <option value="">Select a school</option>
                {filteredSchools.map((school) => (
                  <option key={school.id} value={school.id}>
                    {school.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <label>
            Period start
            <input
              disabled={mode === "edit"}
              onChange={(event) => updateField("periodStart", event.target.value)}
              required
              type="date"
              value={form.periodStart}
            />
          </label>
          <label>
            Period end
            <input
              disabled={mode === "edit"}
              onChange={(event) => updateField("periodEnd", event.target.value)}
              required
              type="date"
              value={form.periodEnd}
            />
          </label>
          <label>
            Status
            <select onChange={(event) => updateField("status", event.target.value)} required value={form.status}>
              {payrollPeriodStatuses.map((status) => (
                <option key={status.value} value={status.value}>
                  {status.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="form-grid single-column">
          <label>
            Notes
            <textarea onChange={(event) => updateField("notes", event.target.value)} rows="4" value={form.notes} />
          </label>
        </div>
      </DataSurface>

      <div className="form-actions">
        <Link className="secondary-button" href={cancelHref}>
          Cancel
        </Link>
        <button className="primary-button" disabled={submitting} type="submit">
          {submitting ? "Saving..." : mode === "edit" ? "Save period" : "Create period"}
        </button>
      </div>
    </form>
  );
}
