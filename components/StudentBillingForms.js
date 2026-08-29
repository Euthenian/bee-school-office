"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { DataSurface, SurfaceHeader } from "@/components/Surface";
import {
  formatBillingAmount,
  getChargeBalance,
  getPaymentUnallocatedBalance,
  studentChargeStatuses,
  studentChargeTypes,
  studentPaymentMethods,
  studentPaymentStatuses,
  studentRefundMethods,
  validateStudentChargeForm,
  validateStudentPaymentAllocationForm,
  validateStudentPaymentForm,
  validateStudentRefundForm
} from "@/lib/billing";

export function StudentChargeForm({ cancelHref, initialForm, onSubmit, submitting = false }) {
  const [form, setForm] = useState(initialForm);
  const [localError, setLocalError] = useState("");
  const amountCanBeNegative = form.chargeType === "adjustment";

  function updateField(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function handleSubmit(event) {
    event.preventDefault();
    setLocalError("");

    const validationError = validateStudentChargeForm(form);
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
          <h2>Student Charge</h2>
        </SurfaceHeader>
        <div className="form-grid">
          <label>
            Charge type
            <select onChange={(event) => updateField("chargeType", event.target.value)} required value={form.chargeType}>
              {studentChargeTypes.map((type) => (
                <option key={type.value} value={type.value}>
                  {type.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Description
            <input onChange={(event) => updateField("description", event.target.value)} required value={form.description} />
          </label>
          <label>
            Amount
            <input
              inputMode="decimal"
              min={amountCanBeNegative ? undefined : "0"}
              onChange={(event) => updateField("amount", event.target.value)}
              required
              step="0.01"
              type="number"
              value={form.amount}
            />
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
            Billing period start
            <input onChange={(event) => updateField("billingPeriodStart", event.target.value)} type="date" value={form.billingPeriodStart} />
          </label>
          <label>
            Billing period end
            <input onChange={(event) => updateField("billingPeriodEnd", event.target.value)} type="date" value={form.billingPeriodEnd} />
          </label>
          <label>
            Due date
            <input onChange={(event) => updateField("dueDate", event.target.value)} type="date" value={form.dueDate} />
          </label>
          <label>
            Status
            <select onChange={(event) => updateField("status", event.target.value)} required value={form.status}>
              {studentChargeStatuses.map((status) => (
                <option key={status.value} value={status.value}>
                  {status.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Source type
            <input onChange={(event) => updateField("sourceType", event.target.value)} value={form.sourceType} />
          </label>
          <label>
            Source ID
            <input onChange={(event) => updateField("sourceId", event.target.value)} value={form.sourceId} />
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
          {submitting ? "Saving..." : "Add charge"}
        </button>
      </div>
    </form>
  );
}

export function StudentPaymentForm({ cancelHref, initialForm, onSubmit, submitting = false }) {
  const [form, setForm] = useState(initialForm);
  const [localError, setLocalError] = useState("");

  function updateField(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function handleSubmit(event) {
    event.preventDefault();
    setLocalError("");

    const validationError = validateStudentPaymentForm(form);
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
          <h2>Student Payment</h2>
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
            Currency
            <input
              maxLength="3"
              onChange={(event) => updateField("currency", event.target.value.toUpperCase())}
              required
              value={form.currency}
            />
          </label>
          <label>
            Payment method
            <select onChange={(event) => updateField("paymentMethod", event.target.value)} required value={form.paymentMethod}>
              {studentPaymentMethods.map((method) => (
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
          <label>
            Status
            <select onChange={(event) => updateField("status", event.target.value)} required value={form.status}>
              {studentPaymentStatuses.map((status) => (
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
          {submitting ? "Recording..." : "Record payment"}
        </button>
      </div>
    </form>
  );
}

export function StudentPaymentAllocationForm({
  cancelHref,
  charges = [],
  initialForm,
  onSubmit,
  payments = [],
  submitting = false
}) {
  const [form, setForm] = useState(initialForm);
  const [localError, setLocalError] = useState("");
  const openCharges = useMemo(
    () =>
      charges.filter((charge) => {
        const balance = getChargeBalance(charge);
        return charge.status !== "draft" && charge.status !== "void" && charge.status !== "cancelled" && balance > 0;
      }),
    [charges]
  );
  const availablePayments = useMemo(
    () =>
      payments.filter((payment) => {
        const balance = getPaymentUnallocatedBalance(payment);
        return payment.status !== "void" && payment.status !== "refunded" && balance > 0;
      }),
    [payments]
  );

  function updateField(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function handleSubmit(event) {
    event.preventDefault();
    setLocalError("");

    const validationError = validateStudentPaymentAllocationForm(form);
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
          <h2>Payment Allocation</h2>
        </SurfaceHeader>
        <div className="form-grid">
          <label>
            Payment
            <select onChange={(event) => updateField("studentPaymentId", event.target.value)} required value={form.studentPaymentId}>
              <option value="">Select payment</option>
              {availablePayments.map((payment) => (
                <option key={payment.id} value={payment.id}>
                  {payment.payment_date} {formatBillingAmount(getPaymentUnallocatedBalance(payment), payment.currency)} available
                </option>
              ))}
            </select>
          </label>
          <label>
            Charge
            <select onChange={(event) => updateField("studentChargeId", event.target.value)} required value={form.studentChargeId}>
              <option value="">Select charge</option>
              {openCharges.map((charge) => (
                <option key={charge.id} value={charge.id}>
                  {charge.description} {formatBillingAmount(getChargeBalance(charge), charge.currency)} due
                </option>
              ))}
            </select>
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
          {submitting ? "Allocating..." : "Allocate payment"}
        </button>
      </div>
    </form>
  );
}

export function StudentRefundForm({ cancelHref, initialForm, onSubmit, payments = [], submitting = false }) {
  const [form, setForm] = useState(initialForm);
  const [localError, setLocalError] = useState("");

  function updateField(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function updatePayment(value) {
    const payment = payments.find((item) => item.id === value);
    setForm((current) => ({
      ...current,
      studentPaymentId: value,
      currency: payment?.currency || current.currency
    }));
  }

  function handleSubmit(event) {
    event.preventDefault();
    setLocalError("");

    const validationError = validateStudentRefundForm(form);
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
          <h2>Refund</h2>
        </SurfaceHeader>
        <div className="form-grid">
          <label>
            Related payment
            <select onChange={(event) => updatePayment(event.target.value)} value={form.studentPaymentId}>
              <option value="">No related payment</option>
              {payments.map((payment) => (
                <option key={payment.id} value={payment.id}>
                  {payment.payment_date} {formatBillingAmount(getPaymentUnallocatedBalance(payment), payment.currency)} available
                </option>
              ))}
            </select>
          </label>
          <label>
            Refund date
            <input onChange={(event) => updateField("refundDate", event.target.value)} required type="date" value={form.refundDate} />
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
            Currency
            <input
              maxLength="3"
              onChange={(event) => updateField("currency", event.target.value.toUpperCase())}
              required
              value={form.currency}
            />
          </label>
          <label>
            Refund method
            <select onChange={(event) => updateField("refundMethod", event.target.value)} required value={form.refundMethod}>
              {studentRefundMethods.map((method) => (
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
          {submitting ? "Recording..." : "Record refund"}
        </button>
      </div>
    </form>
  );
}
