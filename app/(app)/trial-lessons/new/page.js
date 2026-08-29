"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ContactRowsEditor } from "@/components/ContactRowsEditor";
import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";
import { DataSurface, SurfaceHeader } from "@/components/Surface";
import { useAuth } from "@/components/AuthProvider";
import { lessonTypes } from "@/lib/class-details";
import { createInitialContactRows } from "@/lib/contacts";
import {
  createTrialLesson,
  fetchAcquisitionSources,
  fetchClassLevels,
  fetchInquiryMethods,
  fetchSchoolTeachers,
  fetchSchools
} from "@/lib/data";
import { formatStudentAge } from "@/lib/format";
import { canManageTrialLessons } from "@/lib/roles";
import { createInitialParticipant, trialLessonStatuses } from "@/lib/trial-lessons";
import { getSupabaseBrowserClient } from "@/lib/supabase";

const initialForm = {
  contactJapaneseName: "",
  contactFurigana: "",
  contactAlphabetName: "",
  schoolId: "",
  trialDate: "",
  trialTime: "",
  assignedTeacherProfileId: "",
  lessonType: "group",
  levelId: "",
  status: "booked",
  inquiryMethodId: "",
  acquisitionSourceId: "",
  customerRequest: "",
  internalNotes: ""
};

export default function NewTrialLessonPage() {
  const router = useRouter();
  const { profile, session } = useAuth();
  const [form, setForm] = useState(initialForm);
  const [contacts, setContacts] = useState(() => createInitialContactRows());
  const [participants, setParticipants] = useState(() => [createInitialParticipant()]);
  const [schools, setSchools] = useState([]);
  const [classLevels, setClassLevels] = useState([]);
  const [inquiryMethods, setInquiryMethods] = useState([]);
  const [acquisitionSources, setAcquisitionSources] = useState([]);
  const [teachers, setTeachers] = useState([]);
  const [loadingFoundation, setLoadingFoundation] = useState(true);
  const [loadingTeachers, setLoadingTeachers] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const mayManage = canManageTrialLessons(profile);

  useEffect(() => {
    let active = true;

    async function loadFoundation() {
      const supabase = getSupabaseBrowserClient();
      if (!supabase || !session || !mayManage) {
        setLoadingFoundation(false);
        return;
      }

      const [schoolsResult, levelsResult, methodsResult, sourcesResult] = await Promise.all([
        fetchSchools(supabase),
        fetchClassLevels(supabase),
        fetchInquiryMethods(supabase),
        fetchAcquisitionSources(supabase)
      ]);
      if (!active) return;

      const loadError = [schoolsResult.error, levelsResult.error, methodsResult.error, sourcesResult.error]
        .filter(Boolean)
        .map((item) => item.message)
        .join(" ");

      if (loadError) {
        setError(loadError);
        setSchools([]);
        setClassLevels([]);
        setInquiryMethods([]);
        setAcquisitionSources([]);
      } else {
        const activeSchools = (schoolsResult.data || []).filter((school) => school.status === "active");
        setSchools(schoolsResult.data || []);
        setClassLevels(levelsResult.data || []);
        setInquiryMethods(methodsResult.data || []);
        setAcquisitionSources(sourcesResult.data || []);
        setForm((current) => ({
          ...current,
          schoolId: current.schoolId || (activeSchools.length === 1 ? activeSchools[0].id : ""),
          levelId: current.levelId || levelsResult.data?.[0]?.id || ""
        }));
        setParticipants((current) =>
          current.map((participant) => ({
            ...participant,
            ageGroupLevelId: participant.ageGroupLevelId || levelsResult.data?.[0]?.id || "",
            requestedLevelId: participant.requestedLevelId || levelsResult.data?.[0]?.id || ""
          }))
        );
      }

      setLoadingFoundation(false);
    }

    loadFoundation();

    return () => {
      active = false;
    };
  }, [mayManage, session]);

  useEffect(() => {
    let active = true;

    async function loadTeachers() {
      setTeachers([]);
      if (!form.schoolId || !session || !mayManage) {
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
  }, [form.schoolId, mayManage, session]);

  const activeSchools = useMemo(() => schools.filter((school) => school.status === "active"), [schools]);

  function updateField(field, value) {
    setForm((current) => ({
      ...current,
      [field]: value,
      ...(field === "schoolId" ? { assignedTeacherProfileId: "" } : {})
    }));
  }

  function updateParticipant(id, field, value) {
    setParticipants((current) =>
      current.map((participant) => (participant.id === id ? { ...participant, [field]: value } : participant))
    );
  }

  function addParticipant() {
    setParticipants((current) => [...current, createInitialParticipant(form.levelId)]);
  }

  function removeParticipant(id) {
    setParticipants((current) => (current.length === 1 ? current : current.filter((participant) => participant.id !== id)));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setSubmitting(true);

    const supabase = getSupabaseBrowserClient();
    if (!supabase || !session) {
      setError("You must be signed in before creating a trial lesson.");
      setSubmitting(false);
      return;
    }

    for (const participant of participants) {
      if (!participant.japaneseName.trim()) {
        setError("Each participant must have a Japanese name.");
        setSubmitting(false);
        return;
      }

      if (!participant.dateOfBirth && participant.ageOverride !== "") {
        const age = Number(participant.ageOverride);
        if (!Number.isInteger(age) || age < 0 || age > 120) {
          setError("Participant age must be a whole number between 0 and 120.");
          setSubmitting(false);
          return;
        }
      }
    }

    const { data: trialLessonId, error: createError } = await createTrialLesson(supabase, {
      ...form,
      contacts,
      participants
    });

    if (createError) {
      setError(createError.message);
      setSubmitting(false);
      return;
    }

    router.push(`/trial-lessons/?created=${trialLessonId}`);
  }

  if (!mayManage) {
    return (
      <>
        <PageHeader eyebrow="Trial lesson management" title="Add Trial Lesson" />
        <DataSurface>
          <EmptyState
            title="Trial lesson creation is not available"
            description="Your current role can view assigned trial lessons but cannot create or convert them."
          />
        </DataSurface>
      </>
    );
  }

  return (
    <>
      <PageHeader
        eyebrow="Trial lesson management"
        title="Add Trial Lesson"
        description="Create a prospect, contact methods, trial booking, and prospective student participants."
        actions={
          <Link className="secondary-button" href="/trial-lessons/">
            Back to trial lessons
          </Link>
        }
      />

      {error ? <p className="inline-alert">{error}</p> : null}

      <form className="student-form" onSubmit={handleSubmit}>
        <DataSurface>
          <SurfaceHeader>
            <h2>Contact Person</h2>
          </SurfaceHeader>
          <div className="form-grid">
            <label>
              Japanese name
              <input
                onChange={(event) => updateField("contactJapaneseName", event.target.value)}
                required
                value={form.contactJapaneseName}
              />
            </label>
            <label>
              Furigana
              <input onChange={(event) => updateField("contactFurigana", event.target.value)} value={form.contactFurigana} />
            </label>
            <label>
              Alphabet name
              <input
                autoComplete="name"
                onChange={(event) => updateField("contactAlphabetName", event.target.value)}
                value={form.contactAlphabetName}
              />
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
            <h2>Trial Lesson Details</h2>
          </SurfaceHeader>
          <div className="form-grid">
            <label>
              School
              <select
                disabled={loadingFoundation}
                onChange={(event) => updateField("schoolId", event.target.value)}
                required
                value={form.schoolId}
              >
                <option value="">{loadingFoundation ? "Loading schools..." : "Select a school"}</option>
                {activeSchools.map((school) => (
                  <option key={school.id} value={school.id}>
                    {school.name} - {school.organizations?.name || "Organization not shown"}
                  </option>
                ))}
              </select>
            </label>
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
              Trial date
              <input onChange={(event) => updateField("trialDate", event.target.value)} required type="date" value={form.trialDate} />
            </label>
            <label>
              Trial time
              <input onChange={(event) => updateField("trialTime", event.target.value)} required type="time" value={form.trialTime} />
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
              Level / requested course
              <select
                disabled={loadingFoundation || !classLevels.length}
                onChange={(event) => updateField("levelId", event.target.value)}
                required
                value={form.levelId}
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
              Status
              <select onChange={(event) => updateField("status", event.target.value)} required value={form.status}>
                {trialLessonStatuses.map((status) => (
                  <option key={status.value} value={status.value}>
                    {status.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </DataSurface>

        <DataSurface>
          <SurfaceHeader>
            <h2>Inquiry Source</h2>
          </SurfaceHeader>
          <div className="form-grid">
            <label>
              Inquiry method
              <select onChange={(event) => updateField("inquiryMethodId", event.target.value)} value={form.inquiryMethodId}>
                <option value="">Select an inquiry method</option>
                {inquiryMethods.map((method) => (
                  <option key={method.id} value={method.id}>
                    {method.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Acquisition source
              <select onChange={(event) => updateField("acquisitionSourceId", event.target.value)} value={form.acquisitionSourceId}>
                <option value="">Select an acquisition source</option>
                {acquisitionSources.map((source) => (
                  <option key={source.id} value={source.id}>
                    {source.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </DataSurface>

        <DataSurface>
          <SurfaceHeader
            actions={
              <button className="ghost-button" onClick={addParticipant} type="button">
                + Add participant
              </button>
            }
          >
            <h2>Trial Participants</h2>
          </SurfaceHeader>
          <div className="stack-list">
            {participants.map((participant, index) => (
              <ParticipantEditor
                classLevels={classLevels}
                index={index}
                key={participant.id}
                onRemove={removeParticipant}
                onUpdate={updateParticipant}
                participant={participant}
                removable={participants.length > 1}
              />
            ))}
          </div>
        </DataSurface>

        <DataSurface>
          <SurfaceHeader>
            <h2>Requests / Notes</h2>
          </SurfaceHeader>
          <div className="form-grid single-column">
            <label>
              Customer request
              <textarea
                onChange={(event) => updateField("customerRequest", event.target.value)}
                rows="4"
                value={form.customerRequest}
              />
            </label>
            <label>
              Internal notes
              <textarea onChange={(event) => updateField("internalNotes", event.target.value)} rows="4" value={form.internalNotes} />
            </label>
          </div>
        </DataSurface>

        <div className="form-actions">
          <Link className="secondary-button" href="/trial-lessons/">
            Cancel
          </Link>
          <button
            className="primary-button"
            disabled={submitting || loadingFoundation || !activeSchools.length || !classLevels.length}
            type="submit"
          >
            {submitting ? "Creating..." : "Create trial lesson"}
          </button>
        </div>
      </form>
    </>
  );
}

function ParticipantEditor({ classLevels, index, onRemove, onUpdate, participant, removable }) {
  const hasDateOfBirth = Boolean(participant.dateOfBirth);
  const ageDisplay = formatStudentAge({
    date_of_birth: participant.dateOfBirth,
    age_override: participant.ageOverride === "" ? null : Number(participant.ageOverride)
  });

  return (
    <article className="list-card">
      <div className="list-card-header">
        <strong>Participant {index + 1}</strong>
        <button className="ghost-button" disabled={!removable} onClick={() => onRemove(participant.id)} type="button">
          Remove
        </button>
      </div>
      <div className="form-grid">
        <label>
          Japanese name
          <input
            onChange={(event) => onUpdate(participant.id, "japaneseName", event.target.value)}
            required
            value={participant.japaneseName}
          />
        </label>
        <label>
          Furigana
          <input onChange={(event) => onUpdate(participant.id, "furigana", event.target.value)} value={participant.furigana} />
        </label>
        <label>
          Alphabet name
          <input onChange={(event) => onUpdate(participant.id, "alphabetName", event.target.value)} value={participant.alphabetName} />
        </label>
        <label>
          Date of birth
          <input onChange={(event) => onUpdate(participant.id, "dateOfBirth", event.target.value)} type="date" value={participant.dateOfBirth} />
        </label>
        <label>
          Age
          {hasDateOfBirth ? (
            <input readOnly value={ageDisplay} />
          ) : (
            <input
              inputMode="numeric"
              max="120"
              min="0"
              onChange={(event) => onUpdate(participant.id, "ageOverride", event.target.value)}
              step="1"
              type="number"
              value={participant.ageOverride}
            />
          )}
        </label>
        <label>
          Age group
          <select onChange={(event) => onUpdate(participant.id, "ageGroupLevelId", event.target.value)} value={participant.ageGroupLevelId}>
            <option value="">Select an age group</option>
            {classLevels.map((level) => (
              <option key={level.id} value={level.id}>
                {level.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Requested/current level
          <select onChange={(event) => onUpdate(participant.id, "requestedLevelId", event.target.value)} value={participant.requestedLevelId}>
            <option value="">Select a level</option>
            {classLevels.map((level) => (
              <option key={level.id} value={level.id}>
                {level.label}
              </option>
            ))}
          </select>
        </label>
      </div>
    </article>
  );
}
