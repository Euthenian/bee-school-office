"use client";

import { useState } from "react";
import Link from "next/link";
import { DataSurface, SurfaceHeader } from "@/components/Surface";
import { formatLessonPackageOption } from "@/lib/billing-plans";
import { studentBankAccountTypes, validateStudentFinanceForm } from "@/lib/student-finance";

const customFeeValue = "__custom_fee";

export function StudentFinanceForm({
  billingPlans = [],
  cancelHref,
  canEditBankDetails = false,
  initialForm,
  onSubmit,
  submitting = false
}) {
  const [form, setForm] = useState(initialForm);
  const [localError, setLocalError] = useState("");

  function updateField(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function updateBillingPlan(value) {
    if (value === customFeeValue) {
      setForm((current) => ({ ...current, billingPlanId: "" }));
      return;
    }

    const selectedPlan = billingPlans.find((plan) => plan.id === value);
    setForm((current) => ({
      ...current,
      billingPlanId: value,
      monthlyFeeYen:
        selectedPlan?.monthly_fee_yen === null || selectedPlan?.monthly_fee_yen === undefined
          ? current.monthlyFeeYen
          : String(selectedPlan.monthly_fee_yen)
    }));
  }

  function handleSubmit(event) {
    event.preventDefault();
    setLocalError("");

    const validationError = validateStudentFinanceForm(form, { canEditBankDetails });
    if (validationError) {
      setLocalError(validationError);
      return;
    }

    onSubmit(form);
  }

  const hasSelectedPlan = Boolean(form.billingPlanId);

  return (
    <form className="student-form" onSubmit={handleSubmit}>
      {localError ? <p className="inline-alert">{localError}</p> : null}

      <DataSurface>
        <SurfaceHeader>
          <h2>Billing</h2>
        </SurfaceHeader>
        <div className="form-grid">
          <label>
            Lesson package
            <select onChange={(event) => updateBillingPlan(event.target.value)} value={form.billingPlanId || customFeeValue}>
              {billingPlans.map((plan) => (
                <option key={plan.id} value={plan.id}>
                  {formatLessonPackageOption(plan)}
                </option>
              ))}
              <option value={customFeeValue}>Custom fee</option>
            </select>
          </label>
          <label>
            Monthly fee
            <input
              inputMode="numeric"
              maxLength="6"
              onChange={(event) => updateField("monthlyFeeYen", event.target.value)}
              pattern="[0-9]*"
              readOnly={hasSelectedPlan}
              value={form.monthlyFeeYen}
            />
          </label>
          <label>
            Billing start date
            <input
              onChange={(event) => updateField("billingStartDate", event.target.value)}
              type="date"
              value={form.billingStartDate}
            />
          </label>
          <label>
            Billing end date
            <input
              onChange={(event) => updateField("billingEndDate", event.target.value)}
              type="date"
              value={form.billingEndDate}
            />
          </label>
        </div>
        <div className="form-grid single-column">
          <label>
            Postal address
            <textarea onChange={(event) => updateField("postalAddress", event.target.value)} rows="4" value={form.postalAddress} />
          </label>
        </div>
      </DataSurface>

      {canEditBankDetails ? (
        <DataSurface>
          <SurfaceHeader>
            <h2>Bank Account</h2>
          </SurfaceHeader>
          <div className="form-grid">
            <label>
              Bank name
              <input onChange={(event) => updateField("bankName", event.target.value)} value={form.bankName} />
            </label>
            <label>
              Bank code
              <input
                inputMode="numeric"
                maxLength="4"
                onChange={(event) => updateField("bankCode", event.target.value)}
                pattern="[0-9]*"
                value={form.bankCode}
              />
            </label>
            <label>
              Branch name
              <input onChange={(event) => updateField("branchName", event.target.value)} value={form.branchName} />
            </label>
            <label>
              Branch Yomigana
              <input onChange={(event) => updateField("branchNameYomigana", event.target.value)} value={form.branchNameYomigana} />
            </label>
            <label>
              Branch code
              <input
                inputMode="numeric"
                maxLength="3"
                onChange={(event) => updateField("branchCode", event.target.value)}
                pattern="[0-9]*"
                value={form.branchCode}
              />
            </label>
            <label>
              Account type
              <select onChange={(event) => updateField("accountType", event.target.value)} value={form.accountType}>
                {studentBankAccountTypes.map((type) => (
                  <option key={type.value || "none"} value={type.value}>
                    {type.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Account number
              <input
                inputMode="numeric"
                maxLength="7"
                onChange={(event) => updateField("accountNumber", event.target.value)}
                pattern="[0-9]*"
                value={form.accountNumber}
              />
            </label>
            <label>
              Account holder Katakana
              <input onChange={(event) => updateField("accountHolderKatakana", event.target.value)} value={form.accountHolderKatakana} />
            </label>
          </div>
        </DataSurface>
      ) : null}

      <div className="form-actions">
        <Link className="secondary-button" href={cancelHref}>
          Cancel
        </Link>
        <button className="primary-button" disabled={submitting} type="submit">
          {submitting ? "Saving..." : "Save finance details"}
        </button>
      </div>
    </form>
  );
}
