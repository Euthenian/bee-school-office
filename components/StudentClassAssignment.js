"use client";

import Link from "next/link";
import {
  formatClassLevel,
  formatLessonDay,
  formatLessonTime,
  formatLessonType,
  formatTeacherName,
  lessonDays,
  lessonTypes
} from "@/lib/class-details";
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
  loadingClassLevels,
  loadingTeachers,
  onChange,
  teachers = []
}) {
  const selectedClass = classes.find((classRow) => classRow.id === form.classId);
  const selectedBillingPlan = billingPlans.find((plan) => plan.id === form.billingPlanId);
  const isNewClass = form.classAssignmentMode === "new";
  const packageLocksLessonType = Boolean(selectedBillingPlan?.lesson_type);
  const effectiveLessonType = packageLocksLessonType ? selectedBillingPlan.lesson_type : form.lessonType;

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
  }

  return (
    <>
      <div className="form-grid">
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

      <div className="form-grid">
        <label>
          Class
          <select
            disabled={!form.schoolId || loadingClasses || isNewClass}
            onChange={(event) => onChange("classId", event.target.value)}
            required={!isNewClass}
            value={form.classId}
          >
            <option value="">{loadingClasses ? "Loading classes..." : "Select an existing class"}</option>
            {classes.map((classRow) => (
              <option key={classRow.id} value={classRow.id}>
                {formatClassOption(classRow)}
              </option>
            ))}
          </select>
        </label>
        <div className="form-actions align-end">
          {isNewClass ? (
            <button className="secondary-button" disabled={!classes.length} onClick={() => onChange("classAssignmentMode", "existing")} type="button">
              Use existing class
            </button>
          ) : (
            <button className="secondary-button" onClick={() => onChange("classAssignmentMode", "new")} type="button">
              + Create new class
            </button>
          )}
          <Link className="secondary-button" href="/classes/new/">
            Open class form
          </Link>
        </div>
      </div>

      {!isNewClass && selectedClass ? (
        <dl className="detail-list">
          <div>
            <dt>Teacher</dt>
            <dd>{formatTeacherName(selectedClass.assigned_teacher)}</dd>
          </div>
          <div>
            <dt>Lesson type</dt>
            <dd>{formatLessonType(selectedClass.lesson_type)}</dd>
          </div>
          <div>
            <dt>Level</dt>
            <dd>{formatClassLevel(selectedClass)}</dd>
          </div>
          <div>
            <dt>Day</dt>
            <dd>{formatLessonDay(selectedClass.lesson_day)}</dd>
          </div>
          <div>
            <dt>Time</dt>
            <dd>{formatLessonTime(selectedClass.lesson_time)}</dd>
          </div>
        </dl>
      ) : null}

      {isNewClass ? (
        <div className="form-grid">
          <label>
            Assigned teacher
            <select
              disabled={!form.schoolId || loadingTeachers}
              onChange={(event) => onChange("assignedTeacherProfileId", event.target.value)}
              value={form.assignedTeacherProfileId}
            >
              <option value="">{loadingTeachers ? "Loading teachers..." : "No teacher assigned"}</option>
              {teachers.map((teacher) => (
                <option key={teacher.profile_id} value={teacher.profile_id}>
                  {teacher.full_name || teacher.email}
                </option>
              ))}
            </select>
          </label>
          <label>
            Lesson type
            <select
              disabled={packageLocksLessonType}
              onChange={(event) => onChange("lessonType", event.target.value)}
              required
              value={effectiveLessonType}
            >
              {lessonTypes.map((type) => (
                <option key={type.value} value={type.value}>
                  {type.label}
                </option>
              ))}
            </select>
            {packageLocksLessonType ? <span className="form-hint">Lesson type comes from the selected package.</span> : null}
          </label>
          <label>
            Level
            <select
              disabled={loadingClassLevels || !classLevels.length}
              onChange={(event) => onChange("classLevelId", event.target.value)}
              required
              value={form.classLevelId}
            >
              <option value="">{loadingClassLevels ? "Loading levels..." : "Select a level"}</option>
              {classLevels.map((level) => (
                <option key={level.id} value={level.id}>
                  {level.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Lesson day
            <select onChange={(event) => onChange("lessonDay", event.target.value)} required value={form.lessonDay}>
              <option value="">Select a day</option>
              {lessonDays.map((day) => (
                <option key={day.value} value={day.value}>
                  {day.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Lesson time
            <input onChange={(event) => onChange("lessonTime", event.target.value)} required type="time" value={form.lessonTime} />
          </label>
        </div>
      ) : null}
    </>
  );
}
