"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ContactRowsEditor } from "@/components/ContactRowsEditor";
import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";
import { StudentClassAssignment } from "@/components/StudentClassAssignment";
import { DataSurface, SurfaceHeader } from "@/components/Surface";
import { useAuth } from "@/components/AuthProvider";
import { createInitialContactRows } from "@/lib/contacts";
import { createStudent, fetchBillingPlans, fetchClassLevels, fetchClassOptions, fetchSchoolTeachers, fetchSchools } from "@/lib/data";
import { formatStudentAge } from "@/lib/format";
import { canCreateStudents } from "@/lib/roles";
import { studentStatuses } from "@/lib/student-form";
import { getSupabaseBrowserClient } from "@/lib/supabase";

const initialForm = {
  firstName: "",
  lastName: "",
  preferredName: "",
  schoolId: "",
  startDate: "",
  dateOfBirth: "",
  ageOverride: "",
  status: "active",
  billingPlanId: "",
  monthlyFeeYen: "",
  classAssignmentMode: "existing",
  classId: "",
  assignedTeacherProfileId: "",
  lessonType: "group",
  classLevelId: "",
  lessonDay: "",
  lessonTime: "",
  guardianFullName: "",
  guardianRelationship: "",
  guardianEmail: "",
  guardianPhone: "",
  internalNote: ""
};

export default function NewStudentPage() {
  const router = useRouter();
  const { profile, session } = useAuth();
  const [form, setForm] = useState(initialForm);
  const [contacts, setContacts] = useState(() => createInitialContactRows());
  const [schools, setSchools] = useState([]);
  const [billingPlans, setBillingPlans] = useState([]);
  const [classLevels, setClassLevels] = useState([]);
  const [classes, setClasses] = useState([]);
  const [teachers, setTeachers] = useState([]);
  const [loadingSchools, setLoadingSchools] = useState(true);
  const [loadingBillingPlans, setLoadingBillingPlans] = useState(true);
  const [loadingClassLevels, setLoadingClassLevels] = useState(true);
  const [loadingClasses, setLoadingClasses] = useState(false);
  const [loadingTeachers, setLoadingTeachers] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const mayCreate = canCreateStudents(profile);

  useEffect(() => {
    let active = true;

    async function loadFoundation() {
      const supabase = getSupabaseBrowserClient();
      if (!supabase || !session || !mayCreate) {
        setLoadingSchools(false);
        setLoadingBillingPlans(false);
        setLoadingClassLevels(false);
        return;
      }

      const [schoolsResult, billingPlansResult, levelsResult] = await Promise.all([
        fetchSchools(supabase),
        fetchBillingPlans(supabase),
        fetchClassLevels(supabase)
      ]);
      if (!active) return;

      if (schoolsResult.error || billingPlansResult.error || levelsResult.error) {
        setError([schoolsResult.error?.message, billingPlansResult.error?.message, levelsResult.error?.message].filter(Boolean).join(" "));
        setSchools([]);
        setBillingPlans([]);
        setClassLevels([]);
      } else {
        setSchools(schoolsResult.data || []);
        setBillingPlans(billingPlansResult.data || []);
        setClassLevels(levelsResult.data || []);
      }
      setLoadingSchools(false);
      setLoadingBillingPlans(false);
      setLoadingClassLevels(false);
    }

    loadFoundation();

    return () => {
      active = false;
    };
  }, [mayCreate, session]);

  useEffect(() => {
    let active = true;

    async function loadClasses() {
      setClasses([]);
      if (!form.schoolId || !session || !mayCreate) {
        setLoadingClasses(false);
        return;
      }

      const supabase = getSupabaseBrowserClient();
      if (!supabase) {
        setLoadingClasses(false);
        return;
      }

      setLoadingClasses(true);
      const { data, error: classesError } = await fetchClassOptions(supabase, form.schoolId);
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
  }, [form.schoolId, mayCreate, session]);

  useEffect(() => {
    let active = true;

    async function loadTeachers() {
      setTeachers([]);
      if (!form.schoolId || !session || !mayCreate) {
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
  }, [form.schoolId, mayCreate, session]);

  const activeSchools = useMemo(() => schools.filter((school) => school.status === "active"), [schools]);
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

  function updateField(field, value) {
    setForm((current) => ({
      ...current,
      [field]: value,
      ...(field === "schoolId"
        ? { assignedTeacherProfileId: "", billingPlanId: "", classAssignmentMode: "existing", classId: "" }
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
      setError("You must be signed in before creating a student.");
      setSubmitting(false);
      return;
    }

    const guardianHasDetails =
      form.guardianRelationship.trim() || form.guardianEmail.trim() || form.guardianPhone.trim();
    if (guardianHasDetails && !form.guardianFullName.trim()) {
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

    if (form.classAssignmentMode === "existing" && !form.classId) {
      setError("Select an existing class or choose Create new class.");
      setSubmitting(false);
      return;
    }

    const selectedBillingPlan = billingPlanOptions.find((plan) => plan.id === form.billingPlanId);
    const selectedClass = classes.find((classRow) => classRow.id === form.classId);
    const submitForm = selectedBillingPlan?.lesson_type ? { ...form, lessonType: selectedBillingPlan.lesson_type } : form;
    const compatibilityError = getPackageClassCompatibilityError(submitForm, selectedBillingPlan, selectedClass);
    if (compatibilityError) {
      setError(compatibilityError);
      setSubmitting(false);
      return;
    }

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

    const { data: studentId, error: createError } = await createStudent(supabase, {
      ...submitForm,
      contacts,
      createNewClass: submitForm.classAssignmentMode === "new"
    });

    if (createError) {
      setError(createError.message);
      setSubmitting(false);
      return;
    }

    router.push(`/students/profile/?id=${studentId}`);
  }

  if (!mayCreate) {
    return (
      <>
        <PageHeader eyebrow="Student management" title="Add Student" />
        <DataSurface>
          <EmptyState
            title="Student creation is not available"
            description="Your current role can view student information but cannot create student records."
          />
        </DataSurface>
      </>
    );
  }

  return (
    <>
      <PageHeader
        eyebrow="Student management"
        title="Add Student"
        description="Create the student record and its first related contact, class, guardian, and note records."
        actions={
          <Link className="secondary-button" href="/students/">
            Back to students
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
              Status
              <select onChange={(event) => updateField("status", event.target.value)} required value={form.status}>
                {studentStatuses.map((status) => (
                  <option key={status} value={status}>
                    {status.replace("_", " ")}
                  </option>
                ))}
              </select>
            </label>
            <label>
              School
              <select
                disabled={loadingSchools}
                onChange={(event) => updateField("schoolId", event.target.value)}
                required
                value={form.schoolId}
              >
                <option value="">{loadingSchools ? "Loading schools..." : "Select a school"}</option>
                {activeSchools.map((school) => (
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
            loadingBillingPlans={loadingBillingPlans}
            loadingClasses={loadingClasses}
            loadingClassLevels={loadingClassLevels}
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
          <div className="form-grid">
            <label>
              Guardian name
              <input
                autoComplete="name"
                onChange={(event) => updateField("guardianFullName", event.target.value)}
                value={form.guardianFullName}
              />
            </label>
            <label>
              Relationship
              <input
                onChange={(event) => updateField("guardianRelationship", event.target.value)}
                value={form.guardianRelationship}
              />
            </label>
            <label>
              Guardian email
              <input
                autoComplete="email"
                onChange={(event) => updateField("guardianEmail", event.target.value)}
                type="email"
                value={form.guardianEmail}
              />
            </label>
            <label>
              Guardian phone
              <input
                autoComplete="tel"
                onChange={(event) => updateField("guardianPhone", event.target.value)}
                value={form.guardianPhone}
              />
            </label>
          </div>
        </DataSurface>

        <DataSurface>
          <SurfaceHeader>
            <h2>Internal Notes</h2>
          </SurfaceHeader>
          <div className="form-grid single-column">
            <label>
              Note
              <textarea onChange={(event) => updateField("internalNote", event.target.value)} rows="5" value={form.internalNote} />
            </label>
          </div>
        </DataSurface>

        <div className="form-actions">
          <Link className="secondary-button" href="/students/">
            Cancel
          </Link>
          <button
            className="primary-button"
            disabled={
              submitting ||
              loadingSchools ||
              loadingBillingPlans ||
              loadingClasses ||
              loadingClassLevels ||
              !activeSchools.length ||
              (form.classAssignmentMode === "new" && !classLevels.length)
            }
            type="submit"
          >
            {submitting ? "Creating..." : "Create student"}
          </button>
        </div>
      </form>
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

function getPackageClassCompatibilityError(form, selectedBillingPlan, selectedClass) {
  if (!selectedBillingPlan?.lesson_type) return "";

  const classLessonType = form.classAssignmentMode === "new" ? form.lessonType : selectedClass?.lesson_type;
  if (classLessonType && classLessonType !== selectedBillingPlan.lesson_type) {
    return "Choose a class with the same lesson type as the selected Lesson package, or choose Custom fee.";
  }

  return "";
}
