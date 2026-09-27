"use client";

import Link from "next/link";
import { formatLessonType } from "@/lib/class-details";
import { formatLessonPackageOption } from "@/lib/billing-plans";
import { formatClassOption } from "@/lib/classes";
import { formatMonthlyFeeYen } from "@/lib/student-finance";

const customFeeValue = "__custom_fee";

export function StudentClassAssignment({
  billingPlans = [],
  classLevels = [],
  classes = [],
  form,
  loadingBillingPlans,
  loadingClasses,
  loadingTeachers,
  onChange,
  teachers = []
}) {
  const selectedBillingPlan = billingPlans.find((plan) => plan.id === form.billingPlanId);
  const selectedLevel = selectedBillingPlan ? getPlanLevel(selectedBillingPlan, classLevels) : null;

  function updateBillingPlan(value) {
    if (value === customFeeValue) {
      onChange("billingPlanId", "");
      return;
    }

    const selectedPlan = billingPlans.find((plan) => plan.id === value);
    onChange("billingPlanId", value);

    if (selectedPlan?.monthly_fee_yen !== null && selectedPlan?.monthly_fee_yen !== undefined) {
      onChange("monthlyFeeYen", String(selectedPlan.monthly_fee_yen));
    }

    if (selectedPlan?.lesson_type) {
      onChange("lessonType", selectedPlan.lesson_type);
    }

    if (selectedPlan?.class_level_id) {
      onChange("classLevelId", selectedPlan.class_level_id);
    }
  }

  return (
    <>
      <div className="form-grid">
        <label>
          Class time
          <select
            disabled={!form.schoolId || loadingClasses}
            onChange={(event) => onChange("classId", event.target.value)}
            required
            value={form.classId}
          >
            <option value="">{loadingClasses ? "Loading class times..." : "Select a class time"}</option>
            {classes.map((classRow) => (
              <option key={classRow.id} value={classRow.id}>
                {formatClassOption(classRow)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Lesson package
          <select
            disabled={!form.schoolId || loadingBillingPlans}
            onChange={(event) => updateBillingPlan(event.target.value)}
            value={form.billingPlanId || customFeeValue}
          >
            {billingPlans.map((plan) => (
              <option key={plan.id} value={plan.id}>
                {formatLessonPackageOption(plan)}
              </option>
            ))}
            <option value={customFeeValue}>{billingPlans.length ? "Custom fee" : "Custom fee only"}</option>
          </select>
        </label>
        <label>
          Assigned teacher
          <select
            disabled={!form.schoolId || loadingTeachers}
            onChange={(event) => onChange("assignedTeacherStaffId", event.target.value)}
            value={form.assignedTeacherStaffId}
          >
            <option value="">{loadingTeachers ? "Loading teachers..." : "No teacher assigned"}</option>
            {teachers.map((teacher) => {
              const teacherId = teacher.staff_id || teacher.id || teacher.profile_id;
              return (
                <option key={teacherId} value={teacherId}>
                  {formatTeacherOptionName(teacher)}
                </option>
              );
            })}
          </select>
        </label>
        <label>
          Monthly fee
          <input
            inputMode="numeric"
            maxLength="6"
            onChange={(event) => onChange("monthlyFeeYen", event.target.value)}
            pattern="[0-9]*"
            readOnly={Boolean(selectedBillingPlan)}
            value={form.monthlyFeeYen}
          />
        </label>
      </div>

      {selectedBillingPlan ? (
        <dl className="detail-list">
          <div>
            <dt>Course</dt>
            <dd>{selectedLevel?.label || "Not set"}</dd>
          </div>
          <div>
            <dt>Lesson type</dt>
            <dd>{formatLessonType(selectedBillingPlan.lesson_type)}</dd>
          </div>
          <div>
            <dt>Duration</dt>
            <dd>{selectedBillingPlan.lesson_duration_minutes ? `${selectedBillingPlan.lesson_duration_minutes} min` : "Not set"}</dd>
          </div>
          <div>
            <dt>Lessons/month</dt>
            <dd>{selectedBillingPlan.lessons_per_month || "Not set"}</dd>
          </div>
          <div>
            <dt>Monthly fee</dt>
            <dd>{formatMonthlyFeeYen(selectedBillingPlan.monthly_fee_yen)}</dd>
          </div>
        </dl>
      ) : null}

      <div className="form-actions">
        <Link className="secondary-button" href="/classes/new/">
          + Create new class time
        </Link>
      </div>
    </>
  );
}

function formatTeacherOptionName(teacher) {
  return teacher?.display_name || teacher?.full_name || teacher?.legal_name || teacher?.name || teacher?.email || "Unnamed teacher";
}

function getPlanLevel(plan, classLevels) {
  if (plan.class_levels?.label) return plan.class_levels;
  return classLevels.find((level) => level.id === plan.class_level_id) || null;
}
