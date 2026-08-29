"use client";

import { useState } from "react";
import Link from "next/link";
import { EmptyState } from "@/components/EmptyState";
import { DataSurface, ResponsiveTable, SurfaceHeader } from "@/components/Surface";
import {
  buildStaffAssignmentRows,
  staffAssignmentStatuses,
  staffEmploymentTypes,
  staffStatuses,
  validateStaffForm
} from "@/lib/staff";

export function StaffEditor({
  cancelHref,
  initialAssignments,
  initialForm,
  mode = "create",
  onSubmit,
  organizations,
  profiles,
  schools,
  submitting
}) {
  const [assignmentRows, setAssignmentRows] = useState(initialAssignments);
  const [form, setForm] = useState(initialForm);
  const [localError, setLocalError] = useState("");
  const selectedOrganizationId = form.organizationId;
  const activeOrganizations = organizations.filter((organization) => organization.status === "active");

  function updateField(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function updateOrganization(value) {
    setForm((current) => ({ ...current, organizationId: value }));
    setAssignmentRows(buildStaffAssignmentRows(schools, null, value));
  }

  function updateAssignment(schoolId, field, value) {
    setAssignmentRows((current) =>
      current.map((row) => {
        if (row.schoolId !== schoolId) return row;

        if (field === "assigned" && !value) {
          return {
            ...row,
            assigned: false,
            canTeach: false,
            status: "active",
            startDate: "",
            endDate: ""
          };
        }

        return { ...row, [field]: value };
      })
    );
  }

  function handleSubmit(event) {
    event.preventDefault();
    setLocalError("");

    const validationError = validateStaffForm(form, assignmentRows);
    if (validationError) {
      setLocalError(validationError);
      return;
    }

    onSubmit(form, assignmentRows);
  }

  return (
    <form className="student-form" onSubmit={handleSubmit}>
      {localError ? <p className="inline-alert">{localError}</p> : null}

      <DataSurface>
        <SurfaceHeader>
          <h2>Staff Identity</h2>
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
            Linked user account
            <select onChange={(event) => updateField("profileId", event.target.value)} value={form.profileId}>
              <option value="">No linked system account</option>
              {profiles.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.full_name || profile.email || profile.id}
                  {profile.status !== "active" ? " (inactive)" : ""}
                </option>
              ))}
            </select>
          </label>
          <label>
            Legal name
            <input
              autoComplete="name"
              onChange={(event) => updateField("legalName", event.target.value)}
              required
              value={form.legalName}
            />
          </label>
          <label>
            Display name
            <input autoComplete="name" onChange={(event) => updateField("displayName", event.target.value)} value={form.displayName} />
          </label>
          <label>
            Email
            <input autoComplete="email" onChange={(event) => updateField("email", event.target.value)} type="email" value={form.email} />
          </label>
          <label>
            Phone
            <input autoComplete="tel" onChange={(event) => updateField("phone", event.target.value)} value={form.phone} />
          </label>
        </div>
        <div className="form-grid single-column">
          <label>
            Address
            <textarea onChange={(event) => updateField("address", event.target.value)} rows="3" value={form.address} />
          </label>
        </div>
      </DataSurface>

      <DataSurface>
        <SurfaceHeader>
          <h2>Employment</h2>
        </SurfaceHeader>
        <div className="form-grid">
          <label>
            Employment type
            <select onChange={(event) => updateField("employmentType", event.target.value)} required value={form.employmentType}>
              {staffEmploymentTypes.map((type) => (
                <option key={type.value} value={type.value}>
                  {type.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Status
            <select onChange={(event) => updateField("status", event.target.value)} required value={form.status}>
              {staffStatuses.map((status) => (
                <option key={status.value} value={status.value}>
                  {status.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Start date
            <input
              onChange={(event) => updateField("employmentStartDate", event.target.value)}
              type="date"
              value={form.employmentStartDate}
            />
          </label>
          <label>
            End date
            <input
              onChange={(event) => updateField("employmentEndDate", event.target.value)}
              type="date"
              value={form.employmentEndDate}
            />
          </label>
        </div>
      </DataSurface>

      <DataSurface>
        <SurfaceHeader>
          <h2>School Assignments</h2>
        </SurfaceHeader>
        {!selectedOrganizationId ? (
          <EmptyState title="Select an organization" description="Schools appear after an organization is selected." />
        ) : assignmentRows.length ? (
          <ResponsiveTable>
            <table>
              <thead>
                <tr>
                  <th>School</th>
                  <th>Assigned</th>
                  <th>Can teach</th>
                  <th>Status</th>
                  <th>Start</th>
                  <th>End</th>
                </tr>
              </thead>
              <tbody>
                {assignmentRows.map((assignment) => (
                  <tr key={assignment.schoolId}>
                    <td>{assignment.schoolName}</td>
                    <td>
                      <label className="primary-check">
                        <input
                          checked={assignment.assigned}
                          onChange={(event) => updateAssignment(assignment.schoolId, "assigned", event.target.checked)}
                          type="checkbox"
                        />
                        Assigned
                      </label>
                    </td>
                    <td>
                      <label className="primary-check">
                        <input
                          checked={assignment.canTeach}
                          disabled={!assignment.assigned}
                          onChange={(event) => updateAssignment(assignment.schoolId, "canTeach", event.target.checked)}
                          type="checkbox"
                        />
                        Can teach
                      </label>
                    </td>
                    <td>
                      <select
                        disabled={!assignment.assigned}
                        onChange={(event) => updateAssignment(assignment.schoolId, "status", event.target.value)}
                        value={assignment.status}
                      >
                        {staffAssignmentStatuses.map((status) => (
                          <option key={status.value} value={status.value}>
                            {status.label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input
                        disabled={!assignment.assigned}
                        onChange={(event) => updateAssignment(assignment.schoolId, "startDate", event.target.value)}
                        type="date"
                        value={assignment.startDate}
                      />
                    </td>
                    <td>
                      <input
                        disabled={!assignment.assigned}
                        onChange={(event) => updateAssignment(assignment.schoolId, "endDate", event.target.value)}
                        type="date"
                        value={assignment.endDate}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ResponsiveTable>
        ) : (
          <EmptyState title="No schools available" description="No schools are visible for the selected organization." />
        )}
      </DataSurface>

      <DataSurface>
        <SurfaceHeader>
          <h2>Notes</h2>
        </SurfaceHeader>
        <div className="form-grid single-column">
          <label>
            Notes
            <textarea onChange={(event) => updateField("notes", event.target.value)} rows="5" value={form.notes} />
          </label>
        </div>
      </DataSurface>

      <div className="form-actions">
        <Link className="secondary-button" href={cancelHref}>
          Cancel
        </Link>
        <button className="primary-button" disabled={submitting} type="submit">
          {submitting ? "Saving..." : mode === "edit" ? "Save changes" : "Create staff member"}
        </button>
      </div>
    </form>
  );
}
