"use client";

import { useState } from "react";
import Link from "next/link";
import { DataSurface, SurfaceHeader } from "@/components/Surface";
import { formatPayrollAmount, paymentMethods, validatePayrollPaymentForm } from "@/lib/payroll";
import { formatStaffName } from "@/lib/staff";

export function PayrollPaymentForm({ cancelHref, entry, initialForm, onSubmit, submitting = false }) {
  const [form, setForm] = useState(initialForm);
  const [localError, setLocalError] = useState("");

  function updateField(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function handleSubmit(event) {
    event.preventDefault();
    setLocalError("");

    const validationError = validatePayrollPaymentForm(form);
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
        <dl className="detail-list">
          <DetailRow label="Staff" value={formatStaffName(entry?.staff)} />
          <DetailRow label="Net payable" value={formatPayrollAmount(entry?.net_payable, entry?.currency)} />
          <DetailRow label="Status" value={entry?.status} />
        </dl>
      </DataSurface>

      <DataSurface>
        <SurfaceHeader>
          <h2>Payment</h2>
        </SurfaceHeader>
        <div className="form-grid">
          <label>
            Payment date
            <input onChange={(event) => updateField("paymentDate", event.target.value)} required type="date" value={form.paymentDate} />
          </label>
          <label>
            Amount
            <input
              inputMode="decimal"
              min="0"
              onChange={(event) => updateField("amount", event.target.value)}
              required
              step="0.01"
              type="number"
              value={form.amount}
            />
          </label>
          <label>
            Payment method
            <select onChange={(event) => updateField("paymentMethod", event.target.value)} required value={form.paymentMethod}>
              {paymentMethods.map((method) => (
                <option key={method.value} value={method.value}>
                  {method.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Reference
            <input onChange={(event) => updateField("reference", event.target.value)} value={form.reference} />
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
          {submitting ? "Recording..." : "Record payment"}
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
