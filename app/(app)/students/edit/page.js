"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ContactRowsEditor } from "@/components/ContactRowsEditor";
import { EmptyState } from "@/components/EmptyState";
import { GuardianRowsEditor } from "@/components/GuardianRowsEditor";
import { PageHeader } from "@/components/PageHeader";
import { StudentNotesEditor } from "@/components/StudentNotesEditor";
import { DataSurface, SurfaceHeader } from "@/components/Surface";
import { useAuth } from "@/components/AuthProvider";
import { lessonDays, lessonTypes } from "@/lib/class-details";
import { fetchClassLevels, fetchSchoolTeachers, fetchSchools, fetchStudentProfile, updateStudent } from "@/lib/data";
import { formatEnrollment, formatPersonName, formatStudentAge } from "@/lib/format";
import { canCreateStudents } from "@/lib/roles";
import { createEmptyStudentForm, createStudentEditState, studentStatuses, validateGuardianRows } from "@/lib/student-form";
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
  const [form, setForm] = useState(() => createEmptyStudentForm());
  const [contacts, setContacts] = useState(() => createStudentEditState(null).contacts);
  const [guardians, setGuardians] = useState(() => createStudentEditState(null).guardians);
  const [notes, setNotes] = useState(() => createStudentEditState(null).notes);
  const [schools, setSchools] = useState([]);
  const [classLevels, setClassLevels] = useState([]);
  const [teachers, setTeachers] = useState([]);
  const [student, setStudent] = useState(null);
  const [loadingFoundation, setLoadingFoundation] = useState(true);
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

      const loadError = [studentResult.error, schoolsResult.error, levelsResult.error]
        .filter(Boolean)
        .map((item) => item.message)
        .join(" ");

      if (loadError || !studentResult.data) {
        setError(loadError || "This student could not be found or is not visible to your role.");
        setStudent(null);
        setSchools([]);
        setClassLevels([]);
      } else {
        const editState = createStudentEditState(studentResult.data);
        setStudent(studentResult.data);
        setForm(editState.form);
        setContacts(editState.contacts);
        setGuardians(editState.guardians);
        setNotes(editState.notes);
        setSchools(schoolsResult.data || []);
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

    const { error: updateError } = await updateStudent(supabase, {
      studentId,
      ...form,
      contacts,
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
                disabled={loadingFoundation || !classLevels.length}
                onChange={(event) => updateField("classLevelId", event.target.value)}
                required
                value={form.classLevelId}
              >
                <option value="">{loadingFoundation ? "Loading levels..." : "Select a level"}</option>
                {classLevels.map((level) => (
                  <option key={level.id} value={level.id}>
                    {level.label}
                  </option>
                ))}
              </select>
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
            disabled={submitting || loadingFoundation || !availableSchools.length || !classLevels.length}
            type="submit"
          >
            {submitting ? "Saving..." : "Save changes"}
          </button>
        </div>
      </form>
    </>
  );
}

function EditStudentLoading() {
  return (
    <>
      <PageHeader eyebrow="Student management" title="Loading student" />
      <div className="table-placeholder">Loading student edit form...</div>
    </>
  );
}
