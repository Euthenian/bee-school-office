"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { DataSurface, SurfaceHeader } from "@/components/Surface";
import { useAuth } from "@/components/AuthProvider";
import { lessonTypes } from "@/lib/class-details";
import {
  convertPendingTrialBookingImport,
  fetchClassLevels,
  fetchPendingTrialBookingImport,
  fetchPendingTrialBookingProspectCandidates,
  normalizeImportedLessonType,
  updatePendingTrialBookingReview
} from "@/lib/data";
import { formatDateTime } from "@/lib/format";
import { canManageTrialLessons } from "@/lib/roles";
import { getSupabaseBrowserClient } from "@/lib/supabase";

const emptyForm = {
  student_name: "",
  email: "",
  phone: "",
  student_age: "",
  course: "",
  lesson_type: "",
  first_preferred_date: "",
  first_preferred_time: "",
  second_preferred_date: "",
  second_preferred_time: "",
  customer_message: ""
};

const emptyConversionForm = {
  assignedTeacherProfileId: "",
  lessonType: "",
  levelId: "",
  prospectChoice: "",
  prospectId: "",
  trialDate: "",
  trialTime: ""
};

export default function PendingTrialBookingReviewPage() {
  return (
    <Suspense fallback={<ReviewLoading />}>
      <PendingTrialBookingReviewContent />
    </Suspense>
  );
}

function PendingTrialBookingReviewContent() {
  const { profile, session } = useAuth();
  const searchParams = useSearchParams();
  const pendingImportId = searchParams.get("id") || "";
  const [classLevels, setClassLevels] = useState([]);
  const [conversionForm, setConversionForm] = useState(emptyConversionForm);
  const [conversionResult, setConversionResult] = useState(null);
  const [converting, setConverting] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [prospectCandidates, setProspectCandidates] = useState([]);
  const [state, setState] = useState({ loading: true, error: "", success: "", pendingImport: null });
  const [saving, setSaving] = useState(false);
  const mayManage = canManageTrialLessons(profile);

  useEffect(() => {
    let active = true;

    async function loadPendingImport() {
      const supabase = getSupabaseBrowserClient();
      if (!supabase || !session || !pendingImportId || !mayManage) {
        setClassLevels([]);
        setConversionForm(emptyConversionForm);
        setForm(emptyForm);
        setProspectCandidates([]);
        setState({ loading: false, error: "", success: "", pendingImport: null });
        return;
      }

      setState((current) => ({ ...current, loading: true, error: "", success: "" }));
      const [pendingResult, levelsResult] = await Promise.all([
        fetchPendingTrialBookingImport(supabase, pendingImportId),
        fetchClassLevels(supabase)
      ]);
      if (!active) return;

      let candidates = [];
      let candidatesError = null;
      if (pendingResult.data) {
        const candidatesResult = await fetchPendingTrialBookingProspectCandidates(supabase, pendingResult.data);
        candidates = candidatesResult.data || [];
        candidatesError = candidatesResult.error;
      }
      if (!active) return;

      const loadError = [pendingResult.error, levelsResult.error, candidatesError]
        .filter(Boolean)
        .map((error) => error.message)
        .join(" ");

      setClassLevels(levelsResult.data || []);
      setProspectCandidates(candidates);
      setState({
        loading: false,
        error: loadError,
        success: "",
        pendingImport: pendingResult.data || null
      });
      setForm(createFormState(pendingResult.data));
      setConversionForm(createConversionFormState(pendingResult.data, candidates));
      setConversionResult(null);
    }

    loadPendingImport();

    return () => {
      active = false;
    };
  }, [mayManage, pendingImportId, session]);

  const pendingImport = state.pendingImport;
  const alreadyConverted = Boolean(pendingImport?.converted_trial_lesson_id);
  const canAttemptConversion = useMemo(
    () =>
      Boolean(
        pendingImport &&
          !alreadyConverted &&
          pendingImport.review_status === "reviewed" &&
          pendingImport.parse_status === "parsed" &&
          conversionForm.trialDate &&
          conversionForm.trialTime &&
          conversionForm.lessonType &&
          conversionForm.levelId &&
          (conversionForm.prospectChoice === "new" || conversionForm.prospectId)
      ),
    [alreadyConverted, conversionForm, pendingImport]
  );

  function updateField(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function updateConversionField(field, value) {
    setConversionForm((current) => ({
      ...current,
      [field]: value,
      ...(field === "prospectChoice" && value === "new" ? { prospectId: "" } : {}),
      ...(field === "prospectId" ? { prospectChoice: "existing" } : {})
    }));
  }

  async function reloadPendingImport(supabase, successMessage, result = null) {
    const { data, error } = await fetchPendingTrialBookingImport(supabase, pendingImportId);
    const candidatesResult = data ? await fetchPendingTrialBookingProspectCandidates(supabase, data) : { data: [], error: null };

    setProspectCandidates(candidatesResult.data || []);
    setState({
      loading: false,
      error: [error, candidatesResult.error]
        .filter(Boolean)
        .map((item) => item.message)
        .join(" "),
      success: successMessage,
      pendingImport: data || null
    });
    setForm(createFormState(data));
    setConversionForm((current) => ({
      ...createConversionFormState(data, candidatesResult.data || []),
      levelId: current.levelId,
      assignedTeacherProfileId: current.assignedTeacherProfileId
    }));
    setConversionResult(result);
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setSaving(true);
    setState((current) => ({ ...current, error: "", success: "" }));

    const ageError = validateStudentAge(form.student_age);
    if (ageError) {
      setState((current) => ({ ...current, error: ageError }));
      setSaving(false);
      return;
    }

    const supabase = getSupabaseBrowserClient();
    if (!supabase || !session || !pendingImportId) {
      setState((current) => ({ ...current, error: "You must be signed in before saving review corrections." }));
      setSaving(false);
      return;
    }

    const { error } = await updatePendingTrialBookingReview(supabase, pendingImportId, form);
    if (error) {
      setState((current) => ({ ...current, error: error.message }));
      setSaving(false);
      return;
    }

    await reloadPendingImport(supabase, "Review corrections saved.");
    setSaving(false);
  }

  async function handleConvert() {
    setConverting(true);
    setState((current) => ({ ...current, error: "", success: "" }));

    const supabase = getSupabaseBrowserClient();
    if (!supabase || !session || !pendingImportId) {
      setState((current) => ({ ...current, error: "You must be signed in before creating a trial lesson." }));
      setConverting(false);
      return;
    }

    const { data, error } = await convertPendingTrialBookingImport(supabase, {
      pendingImportId,
      prospectId: conversionForm.prospectId,
      createNewProspect: conversionForm.prospectChoice === "new",
      trialDate: conversionForm.trialDate,
      trialTime: conversionForm.trialTime,
      lessonType: conversionForm.lessonType,
      levelId: conversionForm.levelId,
      assignedTeacherProfileId: conversionForm.assignedTeacherProfileId
    });

    if (error) {
      setState((current) => ({ ...current, error: error.message }));
      setConverting(false);
      return;
    }

    await reloadPendingImport(supabase, "Trial lesson created from reviewed booking.", data);
    setConverting(false);
  }

  if (!mayManage) {
    return (
      <>
        <PageHeader eyebrow="Trial lesson management" title="Review Pending Booking" />
        <DataSurface>
          <EmptyState
            title="Pending booking review is not available"
            description="Your current role can view assigned trial lessons but cannot review imported bookings."
          />
        </DataSurface>
      </>
    );
  }

  if (!pendingImportId && !state.loading) {
    return (
      <>
        <PageHeader eyebrow="Trial lesson management" title="Pending booking not selected" />
        <EmptyState title="No pending import ID was provided" description="Open a booking from the pending bookings list." />
      </>
    );
  }

  if (state.loading) {
    return <ReviewLoading />;
  }

  if (state.error && !state.pendingImport) {
    return (
      <>
        <PageHeader eyebrow="Trial lesson management" title="Pending booking unavailable" />
        <p className="inline-alert">{state.error}</p>
        <Link className="secondary-button" href="/trial-lessons/imports/">
          Back to pending bookings
        </Link>
      </>
    );
  }

  if (!state.pendingImport) {
    return (
      <>
        <PageHeader eyebrow="Trial lesson management" title="Pending booking unavailable" />
        <p className="inline-alert">This pending booking could not be found or is not visible to your role.</p>
        <Link className="secondary-button" href="/trial-lessons/imports/">
          Back to pending bookings
        </Link>
      </>
    );
  }

  return (
    <>
      <PageHeader
        eyebrow="Trial lesson management"
        title={pendingImport.student_name || "Review Pending Booking"}
        description={pendingImport.subject || "Imported Gmail Trial Booking"}
        actions={
          <div className="form-actions">
            <StatusBadge value={pendingImport.review_status} />
            <Link className="secondary-button" href="/trial-lessons/imports/">
              Back to pending bookings
            </Link>
          </div>
        }
      />

      {state.error ? <p className="inline-alert">{state.error}</p> : null}
      {state.success ? <p className="inline-success">{state.success}</p> : null}

      <form className="student-form" onSubmit={handleSubmit}>
        <DataSurface>
          <SurfaceHeader>
            <h2>Parsed Booking Details</h2>
          </SurfaceHeader>
          <div className="form-grid">
            <label>
              Student name
              <input onChange={(event) => updateField("student_name", event.target.value)} required value={form.student_name} />
            </label>
            <label>
              Email
              <input autoComplete="email" onChange={(event) => updateField("email", event.target.value)} type="email" value={form.email} />
            </label>
            <label>
              Phone
              <input autoComplete="tel" onChange={(event) => updateField("phone", event.target.value)} value={form.phone} />
            </label>
            <label>
              Student age
              <input
                inputMode="numeric"
                max="120"
                min="0"
                onChange={(event) => updateField("student_age", event.target.value)}
                step="1"
                type="number"
                value={form.student_age}
              />
            </label>
            <label>
              Course
              <input onChange={(event) => updateField("course", event.target.value)} value={form.course} />
            </label>
            <label>
              Lesson type
              <input onChange={(event) => updateField("lesson_type", event.target.value)} value={form.lesson_type} />
            </label>
            <label>
              First preferred date
              <input
                onChange={(event) => updateField("first_preferred_date", event.target.value)}
                type="date"
                value={form.first_preferred_date}
              />
            </label>
            <label>
              First preferred time
              <input
                onChange={(event) => updateField("first_preferred_time", event.target.value)}
                type="time"
                value={form.first_preferred_time}
              />
            </label>
            <label>
              Second preferred date
              <input
                onChange={(event) => updateField("second_preferred_date", event.target.value)}
                type="date"
                value={form.second_preferred_date}
              />
            </label>
            <label>
              Second preferred time
              <input
                onChange={(event) => updateField("second_preferred_time", event.target.value)}
                type="time"
                value={form.second_preferred_time}
              />
            </label>
          </div>
          <div className="form-grid single-column">
            <label>
              Customer message
              <textarea
                onChange={(event) => updateField("customer_message", event.target.value)}
                rows="4"
                value={form.customer_message}
              />
            </label>
          </div>
        </DataSurface>

        <ConversionPanel
          alreadyConverted={alreadyConverted}
          canAttemptConversion={canAttemptConversion}
          classLevels={classLevels}
          conversionForm={conversionForm}
          conversionResult={conversionResult}
          converting={converting}
          onConvert={handleConvert}
          onUpdate={updateConversionField}
          pendingImport={pendingImport}
          prospectCandidates={prospectCandidates}
        />

        <DataSurface>
          <SurfaceHeader>
            <h2>Source Information</h2>
          </SurfaceHeader>
          <dl className="detail-list">
            <SourceRow label="Subject" value={pendingImport.subject} />
            <SourceRow label="Booking source" value={pendingImport.booking_source} />
            <SourceRow label="Trial type" value={pendingImport.trial_type} />
            <SourceRow label="Source mailbox" value={pendingImport.source_mailbox} />
            <SourceRow label="Received" value={formatDateTime(pendingImport.received_at)} />
            <SourceRow label="Sender" value={pendingImport.sender} />
            <SourceRow label="Gmail message ID" value={pendingImport.gmail_message_id} />
            <SourceRow label="Parse status" value={<StatusBadge value={pendingImport.parse_status} />} />
            <SourceRow label="Parse error" value={pendingImport.parse_error} />
            <SourceRow label="Converted at" value={formatDateTime(pendingImport.converted_at)} />
            <SourceRow label="Converted Trial Lesson" value={pendingImport.converted_trial_lesson_id} />
          </dl>
          <details className="source-details">
            <summary>Raw source body</summary>
            <pre>{pendingImport.raw_body || "No raw body stored."}</pre>
          </details>
        </DataSurface>

        <div className="form-actions">
          <Link className="secondary-button" href="/trial-lessons/imports/">
            Cancel
          </Link>
          <button className="primary-button" disabled={saving || alreadyConverted} type="submit">
            {saving ? "Saving..." : "Save corrections"}
          </button>
        </div>
      </form>
    </>
  );
}

function ConversionPanel({
  alreadyConverted,
  canAttemptConversion,
  classLevels,
  conversionForm,
  conversionResult,
  converting,
  onConvert,
  onUpdate,
  pendingImport,
  prospectCandidates
}) {
  const mayConvert = pendingImport.review_status === "reviewed" && pendingImport.parse_status === "parsed" && !alreadyConverted;

  return (
    <DataSurface>
      <SurfaceHeader
        actions={
          alreadyConverted ? (
            <Link className="primary-button" href={`/trial-lessons/?created=${pendingImport.converted_trial_lesson_id}`}>
              View Trial Lesson
            </Link>
          ) : null
        }
      >
        <h2>Create Trial Lesson</h2>
      </SurfaceHeader>

      {alreadyConverted ? (
        <div className="stack-list">
          <article className="list-card">
            <strong>Converted</strong>
            <span>Trial Lesson ID: {pendingImport.converted_trial_lesson_id}</span>
            <span>Converted at: {formatDateTime(pendingImport.converted_at)}</span>
          </article>
        </div>
      ) : null}

      {!mayConvert && !alreadyConverted ? (
        <EmptyState
          title="Conversion is not available"
          description="Only reviewed imports with parsed source data can be converted into live Trial Lessons."
        />
      ) : null}

      {mayConvert ? (
        <>
          <div className="form-grid">
            <label>
              Trial date
              <input onChange={(event) => onUpdate("trialDate", event.target.value)} required type="date" value={conversionForm.trialDate} />
            </label>
            <label>
              Trial time
              <input onChange={(event) => onUpdate("trialTime", event.target.value)} required type="time" value={conversionForm.trialTime} />
            </label>
            <label>
              Lesson type
              <select onChange={(event) => onUpdate("lessonType", event.target.value)} required value={conversionForm.lessonType}>
                <option value="">Select lesson type</option>
                {lessonTypes.map((type) => (
                  <option key={type.value} value={type.value}>
                    {type.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Level
              <select onChange={(event) => onUpdate("levelId", event.target.value)} required value={conversionForm.levelId}>
                <option value="">Select a level</option>
                {classLevels.map((level) => (
                  <option key={level.id} value={level.id}>
                    {level.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="stack-list">
            <article className="list-card">
              <strong>Reviewed source values</strong>
              <span>Participant: {pendingImport.student_name || "Not set"}</span>
              <span>Course: {pendingImport.course || "Not set"}</span>
              <span>Source lesson type: {pendingImport.lesson_type || "Not set"}</span>
              <span>Email: {pendingImport.email || "Not set"}</span>
              <span>Phone: {pendingImport.phone || "Not set"}</span>
              <span>Second choice: {pendingImport.second_preferred_date || "Not set"} {pendingImport.second_preferred_time || ""}</span>
            </article>
          </div>

          <ProspectChoice
            conversionForm={conversionForm}
            onUpdate={onUpdate}
            pendingImport={pendingImport}
            prospectCandidates={prospectCandidates}
          />

          {conversionResult ? (
            <p className="inline-success">
              Trial Lesson {conversionResult.trial_lesson_id} was created.
            </p>
          ) : null}

          <div className="form-actions conversion-actions">
            <button className="convert-button" disabled={!canAttemptConversion || converting} onClick={onConvert} type="button">
              {converting ? "Creating..." : "Create Trial Lesson"}
            </button>
          </div>
        </>
      ) : null}
    </DataSurface>
  );
}

function ProspectChoice({ conversionForm, onUpdate, pendingImport, prospectCandidates }) {
  return (
    <div className="stack-list">
      <article className="list-card">
        <strong>Prospect choice</strong>
        <span>
          {prospectCandidates.length
            ? "Possible existing prospects were found. Choose one or explicitly create a new prospect."
            : "No matching prospect candidates were found in this school."}
        </span>
      </article>

      {prospectCandidates.map((candidate) => (
        <label className="list-card prospect-choice-card" key={candidate.id}>
          <span className="primary-check">
            <input
              checked={conversionForm.prospectId === candidate.id}
              name="prospect-choice"
              onChange={() => onUpdate("prospectId", candidate.id)}
              type="radio"
            />
            Use existing prospect
          </span>
          <strong>{candidate.japanese_name || "Unnamed prospect"}</strong>
          <span>Matched by: {candidate.matchReasons.join(", ")}</span>
          <ContactDifference candidate={candidate} pendingImport={pendingImport} />
        </label>
      ))}

      <label className="list-card prospect-choice-card">
        <span className="primary-check">
          <input
            checked={conversionForm.prospectChoice === "new"}
            name="prospect-choice"
            onChange={() => onUpdate("prospectChoice", "new")}
            type="radio"
          />
          Create a new prospect
        </span>
        <strong>{pendingImport.student_name || "New prospect"}</strong>
        <span>Imported email and phone will be added as prospect contacts if present.</span>
      </label>
    </div>
  );
}

function ContactDifference({ candidate, pendingImport }) {
  const comparison = candidate.contactComparison || {};

  return (
    <div className="candidate-differences">
      <span>Imported email: {pendingImport.email || "Not set"}</span>
      <span>Existing email: {comparison.prospectEmails?.join(", ") || "Not set"}</span>
      {pendingImport.email && !comparison.emailAlreadyPresent ? <span>Imported email differs and will be added if this prospect is used.</span> : null}
      <span>Imported phone: {pendingImport.phone || "Not set"}</span>
      <span>Existing phone: {comparison.prospectPhones?.join(", ") || "Not set"}</span>
      {pendingImport.phone && !comparison.phoneAlreadyPresent ? <span>Imported phone differs and will be added if this prospect is used.</span> : null}
    </div>
  );
}

function SourceRow({ label, value }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value || "Not set"}</dd>
    </div>
  );
}

function ReviewLoading() {
  return (
    <>
      <PageHeader eyebrow="Trial lesson management" title="Loading pending booking" />
      <div className="table-placeholder">Loading pending booking...</div>
    </>
  );
}

function createFormState(pendingImport) {
  if (!pendingImport) return emptyForm;

  return {
    student_name: pendingImport.student_name || "",
    email: pendingImport.email || "",
    phone: pendingImport.phone || "",
    student_age: pendingImport.student_age === null || pendingImport.student_age === undefined ? "" : String(pendingImport.student_age),
    course: pendingImport.course || "",
    lesson_type: pendingImport.lesson_type || "",
    first_preferred_date: dateInputValue(pendingImport.first_preferred_date),
    first_preferred_time: timeInputValue(pendingImport.first_preferred_time),
    second_preferred_date: dateInputValue(pendingImport.second_preferred_date),
    second_preferred_time: timeInputValue(pendingImport.second_preferred_time),
    customer_message: pendingImport.customer_message || ""
  };
}

function createConversionFormState(pendingImport, prospectCandidates = []) {
  if (!pendingImport) return emptyConversionForm;

  return {
    assignedTeacherProfileId: "",
    lessonType: normalizeImportedLessonType(pendingImport.lesson_type),
    levelId: "",
    prospectChoice: prospectCandidates.length ? "" : "new",
    prospectId: "",
    trialDate: dateInputValue(pendingImport.first_preferred_date),
    trialTime: timeInputValue(pendingImport.first_preferred_time)
  };
}

function dateInputValue(value) {
  return value ? String(value).slice(0, 10) : "";
}

function timeInputValue(value) {
  return value ? String(value).slice(0, 5) : "";
}

function validateStudentAge(value) {
  if (value === "") return "";
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 120) {
    return "Student age must be a whole number between 0 and 120.";
  }
  return "";
}
