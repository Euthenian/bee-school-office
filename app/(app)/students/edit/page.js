"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ContactRowsEditor } from "@/components/ContactRowsEditor";
import { EmptyState } from "@/components/EmptyState";
import { GuardianRowsEditor } from "@/components/GuardianRowsEditor";
import { PageHeader } from "@/components/PageHeader";
import { StudentClassAssignment } from "@/components/StudentClassAssignment";
import { StudentNotesEditor } from "@/components/StudentNotesEditor";
import { DataSurface, SurfaceHeader } from "@/components/Surface";
import { useAuth } from "@/components/AuthProvider";
import {
  fetchClassLevels,
  fetchClassOptions,
  fetchSchoolTeachers,
  fetchSchools,
  fetchStudentBillingPlanOptions,
  fetchStudentDepartureState,
  fetchStudentFinance,
  fetchStudentProfile,
  confirmStudentDeparture,
  voidStudentDepartureConfirmation,
  updateStudent
} from "@/lib/data";
import { formatEnrollment, formatPersonName, formatStudentAge } from "@/lib/format";
import { canCreateStudents, canManageFinance } from "@/lib/roles";
import { createEmptyStudentForm, createStudentEditState, studentStatuses, validateGuardianRows } from "@/lib/student-form";
import { billingMonthFromDate, getTokyoDateKey, minimumBillingMonthFromNotice, validateDepartureConfirmation } from "@/lib/student-departure";
import { getSupabaseBrowserClient } from "@/lib/supabase";

export default function EditStudentPage() {
  return (
    <Suspense fallback={<EditStudentLoading />}>
      <EditStudentContent />
    </Suspense>
  );
}

function EditStudentContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const studentId = searchParams.get("id") || "";
  const { loading: authLoading, profile, session } = useAuth();
  const mayEdit = canCreateStudents(profile);
  const mayManageFinance = canManageFinance(profile);
  const [form, setForm] = useState(() => createEmptyStudentForm());
  const [contacts, setContacts] = useState(() => createStudentEditState(null).contacts);
  const [guardians, setGuardians] = useState(() => createStudentEditState(null).guardians);
  const [notes, setNotes] = useState(() => createStudentEditState(null).notes);
  const [schools, setSchools] = useState([]);
  const [billingPlans, setBillingPlans] = useState([]);
  const [classLevels, setClassLevels] = useState([]);
  const [classes, setClasses] = useState([]);
  const [teachers, setTeachers] = useState([]);
  const [student, setStudent] = useState(null);
  const [departureState, setDepartureState] = useState(null);
  const [departureForm, setDepartureForm] = useState(() => ({ noticeDate: getTokyoDateKey(), finalLessonDate: "", finalBillingMonth: "" }));
  const [correctionReason, setCorrectionReason] = useState("");
  const [departureSubmitting, setDepartureSubmitting] = useState(false);
  const [departureNotice, setDepartureNotice] = useState("");
  const [departureError, setDepartureError] = useState("");
  const [loadingFoundation, setLoadingFoundation] = useState(true);
  const [loadingClasses, setLoadingClasses] = useState(false);
  const [loadingTeachers, setLoadingTeachers] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    async function loadEditData() {
      if (authLoading) return;

      const supabase = getSupabaseBrowserClient();
      if (!supabase || !session || !studentId || !mayEdit) {
        setLoadingFoundation(false);
        return;
      }

      setLoadingFoundation(true);
      setError("");

      const [studentResult, schoolsResult, levelsResult] = await Promise.all([
        fetchStudentProfile(supabase, studentId),
        fetchSchools(supabase),
        fetchClassLevels(supabase)
      ]);
      if (!active) return;

      const [financeResult, billingPlansResult, departureResult] = studentResult.data
        ? await Promise.all([
            fetchStudentFinance(supabase, studentId),
            fetchStudentBillingPlanOptions(supabase, studentId),
            fetchStudentDepartureState(supabase, studentId)
          ])
        : [{ data: null, error: null }, { data: [], error: null }, { data: null, error: null }];
      if (!active) return;

      const loadError = [studentResult.error, schoolsResult.error, levelsResult.error, financeResult.error, billingPlansResult.error, departureResult.error]
        .filter(Boolean)
        .map((item) => item.message)
        .join(" ");

      if (loadError || !studentResult.data) {
        setError(loadError || "This student could not be found or is not visible to your role.");
        setStudent(null);
        setSchools([]);
        setBillingPlans([]);
        setClassLevels([]);
      } else {
        const editState = createStudentEditState(studentResult.data, financeResult.data);
        setStudent(studentResult.data);
        setDepartureState(departureResult.data);
        setDepartureForm({
          noticeDate: getTokyoDateKey(),
          finalLessonDate: departureResult.data?.last_lesson_date || "",
          finalBillingMonth: billingMonthFromDate(departureResult.data?.billing_end_date)
        });
        setForm(editState.form);
        setContacts(editState.contacts);
        setGuardians(editState.guardians);
        setNotes(editState.notes);
        setSchools(schoolsResult.data || []);
        setBillingPlans(billingPlansResult.data || []);
        setClassLevels(levelsResult.data || []);
      }

      setLoadingFoundation(false);
    }

    loadEditData();

    return () => {
      active = false;
    };
  }, [authLoading, mayEdit, session, studentId]);

  useEffect(() => {
    let active = true;

    async function loadClasses() {
      setClasses([]);
      if (!form.schoolId || !session || !mayEdit) {
        setLoadingClasses(false);
        return;
      }

      const supabase = getSupabaseBrowserClient();
      if (!supabase) {
        setLoadingClasses(false);
        return;
      }

      setLoadingClasses(true);
      const { data, error: classesError } = await fetchClassOptions(supabase, form.schoolId, {
        currentClassId: form.classId,
        includeInactive: true
      });
      if (!active) return;

      if (classesError) {
        setError(classesError.message);
        setClasses([]);
      } else {
        setClasses(data || []);
      }
      setLoadingClasses(false);
    }

    loadClasses();

    return () => {
      active = false;
    };
  }, [form.classId, form.schoolId, mayEdit, session]);

  useEffect(() => {
    let active = true;

    async function loadTeachers() {
      setTeachers([]);
      if (!form.schoolId || !session || !mayEdit) {
        setLoadingTeachers(false);
        return;
      }

      const supabase = getSupabaseBrowserClient();
      if (!supabase) {
        setLoadingTeachers(false);
        return;
      }

      setLoadingTeachers(true);
      const { data, error: teachersError } = await fetchSchoolTeachers(supabase, form.schoolId);
      if (!active) return;

      if (teachersError) {
        setError(teachersError.message);
        setTeachers([]);
      } else {
        setTeachers(data || []);
      }
      setLoadingTeachers(false);
    }

    loadTeachers();

    return () => {
      active = false;
    };
  }, [form.schoolId, mayEdit, session]);

  const availableSchools = useMemo(
    () => schools.filter((school) => school.status === "active" || school.id === form.schoolId),
    [form.schoolId, schools]
  );
  const selectedSchool = useMemo(() => schools.find((school) => school.id === form.schoolId), [form.schoolId, schools]);
  const billingPlanOptions = useMemo(
    () => getBillingPlanOptionsForSchool(billingPlans, selectedSchool, form.billingPlanId),
    [billingPlans, form.billingPlanId, selectedSchool]
  );
  const hasDateOfBirth = Boolean(form.dateOfBirth);
  const ageDisplay = useMemo(() => {
    return formatStudentAge({
      date_of_birth: form.dateOfBirth,
      age_override: form.ageOverride === "" ? null : Number(form.ageOverride)
    });
  }, [form.ageOverride, form.dateOfBirth]);
  const departureValidationError = validateDepartureConfirmation({
    ...departureForm,
    billingProfileId: departureState?.billing_profile_id,
    billingStartDate: departureState?.billing_start_date
  });

  function updateField(field, value) {
    setForm((current) => ({
      ...current,
      [field]: value,
      ...(field === "schoolId"
        ? { assignedTeacherStaffId: "", billingPlanId: "", classAssignmentMode: "existing", classId: "" }
        : {}),
      ...(field === "classAssignmentMode" ? { classId: value === "new" ? "" : current.classId } : {})
    }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setSubmitting(true);

    const supabase = getSupabaseBrowserClient();
    if (!supabase || !session) {
      setError("You must be signed in before editing a student.");
      setSubmitting(false);
      return;
    }

    if (!validateGuardianRows(guardians)) {
      setError("Guardian name is required when guardian details are provided.");
      setSubmitting(false);
      return;
    }

    if (!form.dateOfBirth && form.ageOverride !== "") {
      const age = Number(form.ageOverride);
      if (!Number.isInteger(age) || age < 0 || age > 120) {
        setError("Student age must be a whole number between 0 and 120.");
        setSubmitting(false);
        return;
      }
    }

    if (!form.classId) {
      setError("Select a class time.");
      setSubmitting(false);
      return;
    }

    const selectedBillingPlan = billingPlanOptions.find((plan) => plan.id === form.billingPlanId);
    const submitForm = selectedBillingPlan
      ? { ...form, classLevelId: selectedBillingPlan.class_level_id || "", lessonType: selectedBillingPlan.lesson_type || form.lessonType }
      : form;

    if (form.monthlyFeeYen !== "" && !/^\d+$/.test(String(form.monthlyFeeYen))) {
      setError("Monthly fee must be a whole yen amount.");
      setSubmitting(false);
      return;
    }

    const monthlyFee = form.monthlyFeeYen === "" ? null : Number(form.monthlyFeeYen);
    if (monthlyFee !== null && (!Number.isInteger(monthlyFee) || monthlyFee < 0 || monthlyFee > 100000)) {
      setError("Monthly fee must be between 0 and 100000.");
      setSubmitting(false);
      return;
    }

    const { error: updateError } = await updateStudent(supabase, {
      studentId,
      ...submitForm,
      contacts,
      createNewClass: false,
      guardians,
      notes
    });

    if (updateError) {
      setError(updateError.message);
      setSubmitting(false);
      return;
    }

    router.push(`/students/profile/?id=${studentId}`);
  }

  async function handleConfirmDeparture(event) {
    event.preventDefault();
    setError("");
    setDepartureNotice("");
    setDepartureError("");
    const validationError = validateDepartureConfirmation({
      ...departureForm,
      billingProfileId: departureState?.billing_profile_id,
      billingStartDate: departureState?.billing_start_date
    });
    if (validationError) {
      setDepartureError(validationError);
      return;
    }
    const supabase = getSupabaseBrowserClient();
    if (!supabase || !session) {
      setDepartureError("You must be signed in to confirm a departure.");
      return;
    }
    setDepartureSubmitting(true);
    const { error: confirmError } = await confirmStudentDeparture(supabase, {
      studentId,
      ...departureForm,
      billingProfileId: departureState.billing_profile_id
    });
    if (confirmError) {
      setDepartureError(confirmError.message);
    } else {
      const { data, error: refreshError } = await fetchStudentDepartureState(supabase, studentId);
      if (refreshError) setDepartureError(refreshError.message);
      else {
        setDepartureState(data);
        setForm((current) => ({ ...current, status: "withdrawn", lastLessonDate: data.last_lesson_date || "" }));
        setDepartureNotice("Departure confirmed. Check Communication history for the automatic email status.");
      }
    }
    setDepartureSubmitting(false);
  }

  async function handleVoidDeparture(event) {
    event.preventDefault();
    setError("");
    setDepartureNotice("");
    if (!correctionReason.trim()) {
      setError("Enter a reason for correcting this confirmation.");
      return;
    }
    const supabase = getSupabaseBrowserClient();
    if (!supabase || !session) {
      setError("You must be signed in to correct a departure.");
      return;
    }
    setDepartureSubmitting(true);
    const { error: voidError } = await voidStudentDepartureConfirmation(supabase, studentId, correctionReason);
    if (voidError) {
      setError(voidError.message);
    } else {
      const { data, error: refreshError } = await fetchStudentDepartureState(supabase, studentId);
      if (refreshError) setError(refreshError.message);
      else {
        setDepartureState(data);
        setForm((current) => ({ ...current, status: data.student_status }));
        setCorrectionReason("");
        setDepartureNotice("Confirmation voided and retained in history. Review Communication history for a sent departure email before confirming again; a correction may need a staff follow-up.");
      }
    }
    setDepartureSubmitting(false);
  }

  if (!studentId && !loadingFoundation) {
    return (
      <>
        <PageHeader eyebrow="Student management" title="Student not selected" />
        <EmptyState title="No student ID was provided" description="Open a student profile before editing." />
      </>
    );
  }

  if (!authLoading && !mayEdit) {
    return (
      <>
        <PageHeader eyebrow="Student management" title="Edit Student" />
        <DataSurface>
          <EmptyState
            title="Student editing is not available"
            description="Your current role can view student information but cannot edit student records."
          />
        </DataSurface>
      </>
    );
  }

  if (loadingFoundation || authLoading) {
    return <EditStudentLoading />;
  }

  if (error && !student) {
    return (
      <>
        <PageHeader eyebrow="Student management" title="Student unavailable" />
        <p className="inline-alert">{error}</p>
        <Link className="secondary-button" href="/students/">
          Back to students
        </Link>
      </>
    );
  }

  return (
    <>
      <PageHeader
        eyebrow="Student management"
        title="Edit Student"
        description={`${formatPersonName(student)} - ${formatEnrollment(student?.student_enrollments)}`}
        actions={
          <Link className="secondary-button" href={`/students/profile/?id=${studentId}`}>
            Back to profile
          </Link>
        }
      />

      {error ? <p className="inline-alert">{error}</p> : null}

      <form className="student-form" onSubmit={handleSubmit}>
        <DataSurface>
          <SurfaceHeader>
            <h2>Basic Information</h2>
          </SurfaceHeader>
          <div className="form-grid">
            <label>
              First name
              <input
                autoComplete="given-name"
                onChange={(event) => updateField("firstName", event.target.value)}
                required
                value={form.firstName}
              />
            </label>
            <label>
              Last name
              <input
                autoComplete="family-name"
                onChange={(event) => updateField("lastName", event.target.value)}
                required
                value={form.lastName}
              />
            </label>
            <label>
              Preferred name
              <input onChange={(event) => updateField("preferredName", event.target.value)} value={form.preferredName} />
            </label>
            <label>
              Rico ID
              <input onChange={(event) => updateField("legacyCustomerId", event.target.value)} value={form.legacyCustomerId} />
            </label>
            <label>
              Status
              <select disabled={Boolean(departureState?.active_confirmation_id)} onChange={(event) => updateField("status", event.target.value)} required value={form.status}>
                {studentStatuses.filter((status) => status !== "withdrawn" || form.status === "withdrawn").map((status) => (
                  <option key={status} value={status}>
                    {status.replace("_", " ")}
                  </option>
                ))}
              </select>
            </label>
            <label>
              School
              <select
                disabled={loadingFoundation}
                onChange={(event) => updateField("schoolId", event.target.value)}
                required
                value={form.schoolId}
              >
                <option value="">{loadingFoundation ? "Loading schools..." : "Select a school"}</option>
                {availableSchools.map((school) => (
                  <option key={school.id} value={school.id}>
                    {school.name} - {school.organizations?.name || "Organization not shown"}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Date of birth
              <input
                onChange={(event) => updateField("dateOfBirth", event.target.value)}
                type="date"
                value={form.dateOfBirth}
              />
            </label>
            <label>
              Student age
              {hasDateOfBirth ? (
                <input readOnly value={ageDisplay} />
              ) : (
                <input
                  inputMode="numeric"
                  max="120"
                  min="0"
                  onChange={(event) => updateField("ageOverride", event.target.value)}
                  step="1"
                  type="number"
                  value={form.ageOverride}
                />
              )}
            </label>
            <label>
              Start date
              <input onChange={(event) => updateField("startDate", event.target.value)} type="date" value={form.startDate} />
            </label>
            <label>
              Last lesson date
              <input disabled={Boolean(departureState?.active_confirmation_id)} onChange={(event) => updateField("lastLessonDate", event.target.value)} type="date" value={form.lastLessonDate} />
            </label>
          </div>
        </DataSurface>

        <DataSurface>
          <SurfaceHeader>
            <h2>Class Details</h2>
          </SurfaceHeader>
          <StudentClassAssignment
            billingPlans={billingPlanOptions}
            classLevels={classLevels}
            classes={classes}
            form={form}
            loadingBillingPlans={loadingFoundation}
            loadingClasses={loadingClasses}
            loadingClassLevels={loadingFoundation}
            loadingTeachers={loadingTeachers}
            onChange={updateField}
            teachers={teachers}
          />
        </DataSurface>

        <DataSurface>
          <SurfaceHeader>
            <h2>Contact Information</h2>
          </SurfaceHeader>
          <ContactRowsEditor onChange={setContacts} rows={contacts} />
        </DataSurface>

        <DataSurface>
          <SurfaceHeader>
            <h2>Parent / Guardian</h2>
          </SurfaceHeader>
          <GuardianRowsEditor onChange={setGuardians} rows={guardians} />
        </DataSurface>

        <DataSurface>
          <SurfaceHeader>
            <h2>Internal Notes</h2>
          </SurfaceHeader>
          <StudentNotesEditor onChange={setNotes} rows={notes} />
        </DataSurface>

        <div className="form-actions">
          <Link className="secondary-button" href={`/students/profile/?id=${studentId}`}>
            Cancel
          </Link>
          <button
            className="primary-button"
            disabled={
              submitting ||
              loadingFoundation ||
              loadingClasses ||
              !availableSchools.length
            }
            type="submit"
          >
            {submitting ? "Saving..." : "Save changes"}
          </button>
        </div>
      </form>

      <DataSurface className="departure-confirmation-surface">
        <SurfaceHeader>
          <h2>Departure confirmation</h2>
        </SurfaceHeader>
        <div className="departure-confirmation-content">
          {departureNotice ? <p className="inline-success">{departureNotice}</p> : null}
          {departureError ? <p className="inline-alert" role="alert">{departureError}</p> : null}
          <p>Confirm the final lesson date and final billing month after reviewing the student and billing records. This action updates the dates and student status together. Save other edits separately.</p>
          <div className="setup-notice" role="note">
            <p>
              RICO cancellation remains a separate verification step. {mayManageFinance ? (
                <>Check the existing warning in <Link href="/finance/?filter=rico-cancellation#monthly-billing">Finance</Link>.</>
              ) : (
                "Ask a Finance administrator to check the existing RICO cancellation warning."
              )}
            </p>
          </div>
          {departureState?.active_confirmation_id ? (
            <form className="student-form departure-confirmation-form" onSubmit={handleVoidDeparture}>
              <p>Confirmed on {departureState.confirmed_at?.slice(0, 10)}. Event ID: {departureState.active_confirmation_id}</p>
              <p>Notice date: {departureState.confirmed_notice_date || "Not recorded for this earlier confirmation"}</p>
              <p>Final lesson: {departureState.confirmed_final_lesson_date}; final billing month: {billingMonthFromDate(departureState.confirmed_final_billing_month)}</p>
              <label>
                Correction reason
                <input onChange={(event) => setCorrectionReason(event.target.value)} required value={correctionReason} />
              </label>
              <div className="form-actions departure-confirmation-actions">
                <button className="secondary-button" disabled={departureSubmitting} type="submit">
                  {departureSubmitting ? "Saving..." : "Void confirmation for correction"}
                </button>
              </div>
            </form>
          ) : (
            <form className="student-form departure-confirmation-form" noValidate onSubmit={handleConfirmDeparture}>
              <label>
                Departure notice date
                <input
                  onChange={(event) => setDepartureForm((current) => ({ ...current, noticeDate: event.target.value }))}
                  required
                  type="date"
                  value={departureForm.noticeDate}
                />
                <small className="departure-confirmation-hint">Use the date the student actually gave notice; today is prefilled.</small>
              </label>
              <p>Notice by the 15th allows the current month as the final billing month. Later notice requires at least the following month.</p>
              {minimumBillingMonthFromNotice(departureForm.noticeDate) ? (
                <p>Earliest required billing month from this notice date: {minimumBillingMonthFromNotice(departureForm.noticeDate)}</p>
              ) : null}
              <div className="form-grid nested-form-grid">
                <label>
                  Final lesson date
                  <input onChange={(event) => setDepartureForm((current) => ({ ...current, finalLessonDate: event.target.value }))} required type="date" value={departureForm.finalLessonDate} />
                </label>
                <label>
                  Final billing month
                  <input
                    aria-describedby="departure-billing-month-format"
                    aria-invalid={Boolean(departureError && /billing month/i.test(departureError))}
                    onChange={(event) => {
                      setDepartureError("");
                      setDepartureForm((current) => ({ ...current, finalBillingMonth: event.target.value }));
                    }}
                    placeholder="YYYY-MM"
                    required
                    type="month"
                    value={departureForm.finalBillingMonth}
                  />
                  <small className="departure-confirmation-hint" id="departure-billing-month-format">Format: YYYY-MM (e.g. 2026-11)</small>
                </label>
              </div>
              {!departureState?.billing_profile_id ? <p className="inline-alert">A valid billing profile is required. Complete Student Finance first.</p> : null}
              {departureState?.billing_profile_id && departureValidationError ? <p className="inline-alert" role="alert">{departureValidationError}</p> : null}
              <p>The billing end date will be the last day of the confirmed final billing month. Any prior RICO cancellation verification is cleared if that date changes.</p>
              <div className="form-actions departure-confirmation-actions">
                <button className="primary-button" disabled={departureSubmitting || Boolean(departureValidationError) || departureState?.student_status === "withdrawn"} type="submit">
                  {departureSubmitting ? "Confirming..." : "Confirm Departure"}
                </button>
              </div>
            </form>
          )}
        </div>
      </DataSurface>
    </>
  );
}

function getBillingPlanOptionsForSchool(plans = [], school = null, currentPlanId = "") {
  if (!school) return [];

  return (plans || []).filter((plan) => {
    const sameOrganization = plan.organization_id === school.organization_id;
    const scopedToSchool = !plan.school_id || plan.school_id === school.id;
    return sameOrganization && scopedToSchool && (plan.active || plan.id === currentPlanId);
  });
}


function EditStudentLoading() {
  return (
    <>
      <PageHeader eyebrow="Student management" title="Loading student" />
      <div className="table-placeholder">Loading student edit form...</div>
    </>
  );
}
