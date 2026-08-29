"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { DataSurface, SurfaceHeader } from "@/components/Surface";
import {
  expensePaymentMethods,
  isExpenseCategoryAvailableForSchool,
  validateExpenseForm
} from "@/lib/expenses";

export function ExpenseForm({
  cancelHref,
  categories = [],
  initialForm,
  mode = "create",
  onSubmit,
  schools = [],
  submitting = false
}) {
  const [form, setForm] = useState(initialForm);
  const [localError, setLocalError] = useState("");
  const availableCategories = useMemo(
    () => categories.filter((category) => isExpenseCategoryAvailableForSchool(category, form.schoolId)),
    [categories, form.schoolId]
  );

  function updateField(field, value) {
    setForm((current) => {
      const next = { ...current, [field]: value };
      if (field === "schoolId") {
        const categoryStillAvailable = categories.some(
          (category) => category.id === current.categoryId && isExpenseCategoryAvailableForSchool(category, value)
        );
        if (!categoryStillAvailable) {
          next.categoryId = "";
        }
      }
      return next;
    });
  }

  function handleSubmit(event) {
    event.preventDefault();
    setLocalError("");

    const validationError = validateExpenseForm(form);
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
          <h2>Expense</h2>
        </SurfaceHeader>
        <div className="form-grid">
          <label>
            School
            <select onChange={(event) => updateField("schoolId", event.target.value)} required value={form.schoolId}>
              <option value="">Select school</option>
              {schools.map((school) => (
                <option key={school.id} value={school.id}>
                  {school.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Date
            <input onChange={(event) => updateField("expenseDate", event.target.value)} required type="date" value={form.expenseDate} />
          </label>
          <label>
            Category
            <select onChange={(event) => updateField("categoryId", event.target.value)} required value={form.categoryId}>
              <option value="">Select category</option>
              {availableCategories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Vendor
            <input onChange={(event) => updateField("vendor", event.target.value)} value={form.vendor} />
          </label>
          <label>
            Description
            <input onChange={(event) => updateField("description", event.target.value)} required value={form.description} />
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
            Tax amount
            <input
              inputMode="decimal"
              min="0"
              onChange={(event) => updateField("taxAmount", event.target.value)}
              step="0.01"
              type="number"
              value={form.taxAmount}
            />
          </label>
          <label>
            Payment method
            <select onChange={(event) => updateField("paymentMethod", event.target.value)} required value={form.paymentMethod}>
              {expensePaymentMethods.map((method) => (
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
            Receipt reference
            <input onChange={(event) => updateField("receiptReference", event.target.value)} value={form.receiptReference} />
          </label>
          <label>
            Receipt file path
            <input onChange={(event) => updateField("receiptFilePath", event.target.value)} value={form.receiptFilePath} />
          </label>
          <label>
            Receipt original name
            <input onChange={(event) => updateField("receiptOriginalName", event.target.value)} value={form.receiptOriginalName} />
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
          {submitting ? "Saving..." : mode === "edit" ? "Save expense" : "Add expense"}
        </button>
      </div>
    </form>
  );
}

export function VoidExpenseForm({ disabled = false, onSubmit, submitting = false }) {
  const [voidReason, setVoidReason] = useState("");

  function handleSubmit(event) {
    event.preventDefault();
    onSubmit(voidReason);
  }

  return (
    <form className="student-form" onSubmit={handleSubmit}>
      <DataSurface>
        <SurfaceHeader>
          <h2>Void Expense</h2>
        </SurfaceHeader>
        <div className="form-grid single-column">
          <label>
            Void reason
            <textarea
              disabled={disabled}
              onChange={(event) => setVoidReason(event.target.value)}
              rows="3"
              value={voidReason}
            />
          </label>
        </div>
      </DataSurface>
      <div className="form-actions">
        <button className="secondary-button" disabled={disabled || submitting} type="submit">
          {submitting ? "Voiding..." : "Void expense"}
        </button>
      </div>
    </form>
  );
}
