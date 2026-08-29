"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ContactRowsEditor } from "@/components/ContactRowsEditor";
import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";
import { DataSurface, SurfaceHeader } from "@/components/Surface";
import { useAuth } from "@/components/AuthProvider";
import { lessonDays, lessonTypes } from "@/lib/class-details";
import { createInitialContactRows } from "@/lib/contacts";
import { createStudent, fetchClassLevels, fetchSchoolTeachers, fetchSchools } from "@/lib/data";
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
  const [classLevels, setClassLevels] = useState([]);
  const [teachers, setTeachers] = useState([]);
  const [loadingSchools, setLoadingSchools] = useState(true);
  const [loadingClassLevels, setLoadingClassLevels] = useState(true);
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
        setLoadingClassLevels(false);
        return;
      }

      const [schoolsResult, levelsResult] = await Promise.all([fetchSchools(supabase), fetchClassLevels(supabase)]);
      if (!active) return;

      if (schoolsResult.error || levelsResult.error) {
        setError([schoolsResult.error?.message, levelsResult.error?.message].filter(Boolean).join(" "));
        setSchools([]);
        setClassLevels([]);
      } else {
        setSchools(schoolsResult.data || []);
        setClassLevels(levelsResult.data || []);
      }
      setLoadingSchools(false);
      setLoadingClassLevels(false);
    }

    loadFoundation();

    return () => {
      active = false;
    };
  }, [mayCreate, session]);

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
      ...(field === "schoolId" ? { assignedTeacherProfileId: "" } : {})
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

    const { data: studentId, error: createError } = await createStudent(supabase, { ...form, contacts });

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
              Start date
              <input onChange={(event) => updateField("startDate", event.target.value)} type="date" value={form.startDate} />
            </label>
          </div>
        </DataSurface>

        <DataSurface>
          <SurfaceHeader>
            <h2>Class Details</h2>
          </SurfaceHeader>
          <div className="form-grid">
            <label>
              Assigned teacher
              <select
                disabled={!form.schoolId || loadingTeachers}
                onChange={(event) => updateField("assignedTeacherProfileId", event.target.value)}
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
              <select onChange={(event) => updateField("lessonType", event.target.value)} required value={form.lessonType}>
                {lessonTypes.map((type) => (
                  <option key={type.value} value={type.value}>
                    {type.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Level
              <select
                disabled={loadingClassLevels || !classLevels.length}
                onChange={(event) => updateField("classLevelId", event.target.value)}
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
              Lesson day
              <select onChange={(event) => updateField("lessonDay", event.target.value)} required value={form.lessonDay}>
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
              <input onChange={(event) => updateField("lessonTime", event.target.value)} required type="time" value={form.lessonTime} />
            </label>
          </div>
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
            disabled={submitting || loadingSchools || loadingClassLevels || !activeSchools.length || !classLevels.length}
            type="submit"
          >
            {submitting ? "Creating..." : "Create student"}
          </button>
        </div>
      </form>
    </>
  );
}
