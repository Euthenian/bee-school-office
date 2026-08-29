"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { EmptyState } from "@/components/EmptyState";
import { DataSurface, SurfaceHeader } from "@/components/Surface";
import { formatPayrollAmount, payrollEntryStatuses, validatePayrollEntryForm } from "@/lib/payroll";
import { formatStaffName } from "@/lib/staff";

export function PayrollEntryForm({
  cancelHref,
  compensationTerms = [],
  initialForm,
  mode = "create",
  onStaffChange,
  onSubmit,
  payrollPeriods = [],
  staff = [],
  submitting = false
}) {
  const [form, setForm] = useState(initialForm);
  const [localError, setLocalError] = useState("");
  const selectedStaff = useMemo(() => staff.find((staffMember) => staffMember.id === form.staffId), [form.staffId, staff]);
  const selectedTerm = useMemo(
    () => compensationTerms.find((term) => term.id === form.compensationTermId),
    [compensationTerms, form.compensationTermId]
  );

  function updateField(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function updateStaff(value) {
    setForm((current) => ({
      ...current,
      staffId: value,
      compensationTermId: ""
    }));
    onStaffChange?.(value);
  }

  function updateCompensationTerm(value) {
    const term = compensationTerms.find((item) => item.id === value);
    setForm((current) => ({
      ...current,
      compensationTermId: value,
      currency: term?.currency || current.currency
    }));
  }

  function handleSubmit(event) {
    event.preventDefault();
    setLocalError("");

    const validationError = validatePayrollEntryForm(form);
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
          <h2>Payroll Entry</h2>
        </SurfaceHeader>
        <div className="form-grid">
          <label>
            Payroll period
            <select
              disabled={mode === "edit" || payrollPeriods.length <= 1}
              onChange={(event) => updateField("payrollPeriodId", event.target.value)}
              required
              value={form.payrollPeriodId}
            >
              <option value="">Select a period</option>
              {payrollPeriods.map((period) => (
                <option key={period.id} value={period.id}>
                  {period.period_start} - {period.period_end}
                </option>
              ))}
            </select>
          </label>
          <label>
            Staff member
            <select disabled={mode === "edit"} onChange={(event) => updateStaff(event.target.value)} required value={form.staffId}>
              <option value="">Select staff</option>
              {staff.map((staffMember) => (
                <option key={staffMember.id} value={staffMember.id}>
                  {formatStaffName(staffMember)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Compensation term
            <select onChange={(event) => updateCompensationTerm(event.target.value)} value={form.compensationTermId}>
              <option value="">Manual snapshot</option>
              {compensationTerms.map((term) => (
                <option key={term.id} value={term.id}>
                  {term.effective_from} {term.compensation_type} {term.amount} {term.currency}/{term.unit}
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
            Base amount
            <input
              inputMode="decimal"
              min="0"
              onChange={(event) => updateField("baseAmount", event.target.value)}
              step="0.01"
              type="number"
              value={form.baseAmount}
            />
          </label>
          <label>
            Adjustments
            <input
              inputMode="decimal"
              onChange={(event) => updateField("adjustmentsAmount", event.target.value)}
              step="0.01"
              type="number"
              value={form.adjustmentsAmount}
            />
          </label>
          <label>
            Gross amount
            <input
              inputMode="decimal"
              min="0"
              onChange={(event) => updateField("grossAmount", event.target.value)}
              step="0.01"
              type="number"
              value={form.grossAmount}
            />
          </label>
          <label>
            Deductions
            <input
              inputMode="decimal"
              min="0"
              onChange={(event) => updateField("deductionsAmount", event.target.value)}
              step="0.01"
              type="number"
              value={form.deductionsAmount}
            />
          </label>
          <label>
            Net payable
            <input
              inputMode="decimal"
              min="0"
              onChange={(event) => updateField("netPayable", event.target.value)}
              step="0.01"
              type="number"
              value={form.netPayable}
            />
          </label>
          <label>
            Status
            <select onChange={(event) => updateField("status", event.target.value)} required value={form.status}>
              {payrollEntryStatuses.map((status) => (
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

      <DataSurface>
        <SurfaceHeader>
          <h2>Snapshot Preview</h2>
        </SurfaceHeader>
        {selectedStaff ? (
          <dl className="detail-list">
            <DetailRow label="Staff" value={formatStaffName(selectedStaff)} />
            <DetailRow
              label="Compensation source"
              value={
                selectedTerm
                  ? `${selectedTerm.compensation_type} ${formatPayrollAmount(selectedTerm.amount, selectedTerm.currency)} / ${selectedTerm.unit}`
                  : "Manual snapshot"
              }
            />
            <DetailRow label="Net payable" value={formatPayrollAmount(form.netPayable, form.currency)} />
          </dl>
        ) : (
          <EmptyState title="Select staff" description="Compensation history appears after a staff member is selected." />
        )}
      </DataSurface>

      <div className="form-actions">
        <Link className="secondary-button" href={cancelHref}>
          Cancel
        </Link>
        <button className="primary-button" disabled={submitting} type="submit">
          {submitting ? "Saving..." : mode === "edit" ? "Save entry" : "Create entry"}
        </button>
      </div>
    </form>
  );
}

function DetailRow({ label, value }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value || "Not set"}</dd>
    </div>
  );
}
