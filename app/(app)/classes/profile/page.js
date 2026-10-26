"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ClassDeleteDialog } from "@/components/ClassDeleteDialog";
import { ClassAddStudentDialog } from "@/components/ClassAddStudentDialog";
import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { DataSurface, ResponsiveTable, SurfaceHeader } from "@/components/Surface";
import { useAuth } from "@/components/AuthProvider";
import { formatLessonDay, formatLessonTime, formatTeacherName } from "@/lib/class-details";
import { selectClassEmailTemplates, summarizeClassEmailRecipients } from "@/lib/class-mail";
import { formatClassName } from "@/lib/classes";
import { bulkQueueClassStudentEmails, deleteClass, fetchClassProfile, fetchCommunicationTemplates, previewClassTemplateEmail, sendClassTemplateEmail, updateClass } from "@/lib/data";
import { formatDate, formatPersonName } from "@/lib/format";
import { canManageClasses, canManageCommunications } from "@/lib/roles";
import { getSupabaseBrowserClient } from "@/lib/supabase";

export default function ClassProfilePage() {
  return (
    <Suspense fallback={<ClassProfileLoading />}>
      <ClassProfileContent />
    </Suspense>
  );
}

function ClassProfileContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const classId = searchParams.get("id") || "";
  const { profile, session } = useAuth();
  const mayManage = canManageClasses(profile);
  const mayCommunicate = canManageCommunications(profile);
  const [state, setState] = useState({ classRow: null, error: "", loading: true });
  const [deleteError, setDeleteError] = useState("");
  const [deactivating, setDeactivating] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [addStudentOpen, setAddStudentOpen] = useState(false);
  const [mailDialogOpen, setMailDialogOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  useEffect(() => {
    let active = true;

    async function loadClass() {
      const supabase = getSupabaseBrowserClient();
      if (!supabase || !session || !classId || !mayManage) {
        setState({ classRow: null, error: "", loading: false });
        return;
      }

      setState((current) => ({ ...current, loading: true }));
      const { data, error } = await fetchClassProfile(supabase, classId);
      if (!active) return;

      setState({
        classRow: data || null,
        error: error?.message || "",
        loading: false
      });
    }

    loadClass();

    return () => {
      active = false;
    };
  }, [classId, mayManage, session]);

  if (!mayManage) {
    return (
      <>
        <PageHeader eyebrow="Teaching operations" title="Class" />
        <DataSurface>
          <EmptyState title="Class details are not available" description="Your current role cannot view class management records." />
        </DataSurface>
      </>
    );
  }

  if (!classId && !state.loading) {
    return (
      <>
        <PageHeader eyebrow="Teaching operations" title="Class not selected" />
        <EmptyState title="No class ID was provided" description="Open a class from the Classes list." />
      </>
    );
  }

  if (state.loading) return <ClassProfileLoading />;

  if (!state.classRow) {
    return (
      <>
        <PageHeader eyebrow="Teaching operations" title="Class unavailable" />
        <p className="inline-alert">{state.error || "This class could not be found or is not visible to your role."}</p>
        <Link className="secondary-button" href="/classes/">
          Back to classes
        </Link>
      </>
    );
  }

  const classRow = state.classRow;
  const enrollments = classRow.student_enrollments || [];
  const activeEnrollments = enrollments.filter((enrollment) => enrollment.status === "active");
  const activeStudents = [...new Map(activeEnrollments.map((row) => row.students).filter(Boolean)
    .map((student) => [student.id, student])).values()];
  const { recipientCount: emailRecipientCount, missingCount: noEmailCount,
    duplicateCount: duplicateEmailCount } = summarizeClassEmailRecipients(activeStudents);

  function handleDeleteRequest() {
    setDeleteError("");
    setShowDeleteDialog(true);
  }

  function handleEmailStudentsOpen() {
    setMailDialogOpen(true);
  }

  function handleEmailStudentsCancel() {
    setMailDialogOpen(false);
  }

  async function handleStudentAdded() {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return "You must be signed in to refresh the class.";
    const { data, error } = await fetchClassProfile(supabase, classRow.id);
    if (error || !data) return error?.message || "Class could not be reloaded.";
    setState((current) => ({ ...current, classRow: data }));
    setAddStudentOpen(false);
    setNotice("Student added to the class.");
    return "";
  }

  function handleEmailQueued(data) {
    setMailDialogOpen(false);
    const missing = data.skipped_missing ?? data.skipped ?? 0;
    const duplicate = data.skipped_duplicate ?? data.skippedDuplicate ?? 0;
    setNotice(`${data.queued} email${data.queued === 1 ? "" : "s"} queued.`
      + (missing ? ` ${missing} skipped without a valid email.` : "")
      + (duplicate ? ` ${duplicate} skipped because the address was already included.` : ""));
  }

  function handleDeleteCancel() {
    if (deleting || deactivating) return;
    setDeleteError("");
    setShowDeleteDialog(false);
  }

  async function handleDeleteConfirm() {
    const supabase = getSupabaseBrowserClient();
    if (!supabase || !session) {
      setDeleteError("You must be signed in before deleting a class.");
      return;
    }

    setDeleting(true);
    setDeleteError("");
    const { error } = await deleteClass(supabase, classRow.id);
    if (error) {
      setDeleteError(error.message);
      setDeleting(false);
      return;
    }

    router.push("/classes/");
  }

  async function handleDeactivateConfirm() {
    const supabase = getSupabaseBrowserClient();
    if (!supabase || !session) {
      setDeleteError("You must be signed in before deactivating a class.");
      return;
    }

    setDeactivating(true);
    setDeleteError("");
    const { error } = await updateClass(supabase, buildInactiveClassInput(classRow));
    if (error) {
      setDeleteError(error.message);
      setDeactivating(false);
      return;
    }

    setState((current) => ({
      ...current,
      classRow: current.classRow ? { ...current.classRow, status: "inactive" } : current.classRow
    }));
    setDeactivating(false);
    setShowDeleteDialog(false);
  }

  return (
    <>
      <PageHeader
        eyebrow="Teaching operations"
        title={formatClassName(classRow)}
        description={classRow.schools?.name || "School not set"}
        actions={
          <div className="form-actions">
            <StatusBadge value={classRow.status} />
            {mayCommunicate ? (
              <button
                className="secondary-button"
                disabled={!activeStudents.length}
                onClick={handleEmailStudentsOpen}
                type="button"
              >
                Email Students
              </button>
            ) : null}
            <Link className="secondary-button" href={`/classes/edit/?id=${classRow.id}`}>
              Edit class
            </Link>
            <button className="danger-button class-delete-button" onClick={handleDeleteRequest} type="button">
              <TrashIcon />
              Delete class
            </button>
            <Link className="secondary-button" href="/classes/">
              Back to classes
            </Link>
          </div>
        }
      />

      {state.error ? <p className="inline-alert">{state.error}</p> : null}
      {notice ? <p className="inline-success">{notice}</p> : null}

      {showDeleteDialog ? (
        <ClassDeleteDialog
          classRow={classRow}
          deactivating={deactivating}
          deleting={deleting}
          error={deleteError}
          onCancel={handleDeleteCancel}
          onConfirm={handleDeleteConfirm}
          onDeactivate={handleDeactivateConfirm}
        />
      ) : null}

      {mailDialogOpen ? (
        <ClassBulkMailDialog
          activeStudentCount={activeStudents.length}
          classId={classRow.id}
          duplicateEmailCount={duplicateEmailCount}
          noEmailCount={noEmailCount}
          onCancel={handleEmailStudentsCancel}
          onQueued={handleEmailQueued}
          profile={profile}
          recipientCount={emailRecipientCount}
          session={session}
        />
      ) : null}

      {addStudentOpen ? <ClassAddStudentDialog classRow={classRow} onAdded={handleStudentAdded} onCancel={() => setAddStudentOpen(false)} /> : null}

      <DataSurface>
        <SurfaceHeader>
          <h2>Class Details</h2>
        </SurfaceHeader>
        <dl className="detail-list">
          <div>
            <dt>School</dt>
            <dd>{classRow.schools?.name || "Not assigned"}</dd>
          </div>
          <div>
            <dt>Day</dt>
            <dd>{formatLessonDay(classRow.lesson_day)}</dd>
          </div>
          <div>
            <dt>Time</dt>
            <dd>{formatLessonTime(classRow.lesson_time)}</dd>
          </div>
          <div>
            <dt>Status</dt>
            <dd>{classRow.status}</dd>
          </div>
        </dl>
      </DataSurface>

      <DataSurface>
        <SurfaceHeader actions={classRow.status === "active" ? <button className="secondary-button" onClick={() => setAddStudentOpen(true)} type="button">Add Student</button> : null}>
          <h2>Students</h2>
        </SurfaceHeader>
        {enrollments.length ? (
          <ResponsiveTable>
            <table>
              <thead>
                <tr>
                  <th>Student</th>
                  <th>Student status</th>
                  <th>Teacher</th>
                  <th>Enrollment status</th>
                  <th>Start date</th>
                  <th>End date</th>
                </tr>
              </thead>
              <tbody>
                {enrollments.map((enrollment) => (
                  <tr key={enrollment.id}>
                    <td>
                      {enrollment.students ? (
                        <Link href={`/students/profile/?id=${enrollment.students.id}`}>{formatPersonName(enrollment.students)}</Link>
                      ) : (
                        "Student unavailable"
                      )}
                    </td>
                    <td>{enrollment.students?.status || "Unknown"}</td>
                    <td>{formatTeacherName(enrollment.assigned_teacher)}</td>
                    <td>
                      <StatusBadge value={enrollment.status} />
                    </td>
                    <td>{formatDate(enrollment.start_date)}</td>
                    <td>{formatDate(enrollment.end_date)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ResponsiveTable>
        ) : (
          <EmptyState title="No enrolled students" description="Students can be assigned to this class from the student create/edit form." />
        )}
      </DataSurface>
    </>
  );
}

function buildInactiveClassInput(classRow) {
  return {
    classId: classRow.id,
    lessonDay: classRow.lesson_day,
    lessonTime: classRow.lesson_time,
    schoolId: classRow.school_id,
    status: "inactive"
  };
}

function ClassBulkMailDialog({
  activeStudentCount,
  classId,
  duplicateEmailCount,
  noEmailCount,
  onCancel,
  onQueued,
  profile,
  recipientCount,
  session
}) {
  const [templates, setTemplates] = useState([]);
  const [templateKey, setTemplateKey] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const selectedTemplate = templates.find((template) => template.template_key === templateKey);
  const shownSubject = selectedTemplate ? selectedTemplate.subject_template : subject;
  const shownBody = selectedTemplate ? selectedTemplate.body_template : body;

  useEffect(() => {
    let active = true;
    async function loadTemplates() {
      if (!session) {
        setError("You must be signed in to send class email.");
        setLoading(false);
        return;
      }
      const { data, error: loadError } = await fetchCommunicationTemplates(getSupabaseBrowserClient());
      if (!active) return;
      setTemplates(selectClassEmailTemplates(data || []));
      setError(loadError?.message || "");
      setLoading(false);
    }
    loadTemplates();
    return () => { active = false; };
  }, [session]);

  async function handlePreview(event) {
    event.preventDefault();
    setError("");
    setPreview(null);
    if (!templateKey) {
      if (!subject.trim() || !body.trim()) {
        setError("Subject and message body are required.");
        return;
      }
      if (/\{\{|\}\}/.test(subject + body)) {
        setError("General message contains an unresolved template variable.");
        return;
      }
      setPreview({ recipient_count: recipientCount, selected: activeStudentCount,
        skipped_missing: noEmailCount, skipped_duplicate: duplicateEmailCount,
        representative: { subject: subject.trim(), body: body.trim() } });
      return;
    }
    setLoading(true);
    const { data, error: previewError } = await previewClassTemplateEmail(
      getSupabaseBrowserClient(), classId, templateKey
    );
    setLoading(false);
    if (previewError) setError(previewError.message);
    else setPreview(data);
  }

  async function handleSend() {
    if (!preview?.recipient_count || submitting) return;
    setSubmitting(true);
    setError("");
    const { data, error: sendError } = templateKey
      ? await sendClassTemplateEmail(getSupabaseBrowserClient(), classId, templateKey)
      : await bulkQueueClassStudentEmails(getSupabaseBrowserClient(), { classId, subject, body }, profile);
    if (sendError) {
      setError(sendError.message);
      setPreview(null);
      setSubmitting(false);
      return;
    }
    onQueued(data);
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <section aria-labelledby="class-bulk-mail-title" aria-modal="true" className="communication-modal" role="dialog">
        <header className="communication-modal-header">
          <div>
            <p className="eyebrow">Class communication</p>
            <h2 id="class-bulk-mail-title">Email Students</h2>
          </div>
          <button className="ghost-button" disabled={submitting} onClick={onCancel} type="button">
            Cancel
          </button>
        </header>
        <form className="student-form" onSubmit={handlePreview}>
          <div className="confirmation-modal-body">
            <p>
              {activeStudentCount} active student{activeStudentCount === 1 ? "" : "s"} /{" "}
              {recipientCount} email recipient{recipientCount === 1 ? "" : "s"}
              {noEmailCount ? ` / ${noEmailCount} without email` : ""}
              {duplicateEmailCount ? ` / ${duplicateEmailCount} duplicate addresses` : ""}
            </p>
            {error ? <p className="inline-alert" role="alert">{error}</p> : null}
            <label className="form-field"><span>Template</span>
              <select disabled={loading || submitting} onChange={(event) => {
                setTemplateKey(event.target.value);
                setPreview(null);
              }} value={templateKey}>
                <option value="">General message (write your own)</option>
                {templates.map((template) => <option key={template.id} value={template.template_key}>
                  {template.name}{template.template_key === "general_message" ? " (template)" : ""}
                </option>)}
              </select>
            </label>
            <label className="form-field">
              <span>Subject</span>
              <input
                disabled={submitting || loading}
                onChange={(event) => { setSubject(event.target.value); setPreview(null); }}
                readOnly={Boolean(templateKey)}
                required
                type="text"
                value={shownSubject || ""}
              />
            </label>
            <label className="form-field">
              <span>Message body</span>
              <textarea disabled={submitting || loading} onChange={(event) => { setBody(event.target.value); setPreview(null); }} readOnly={Boolean(templateKey)} required value={shownBody || ""} />
            </label>
          </div>
          {preview ? <div aria-label="Class email preview" className="communication-preview">
            <p><strong>{preview.recipient_count}</strong> recipient{preview.recipient_count === 1 ? "" : "s"} selected for individual email.</p>
            {preview.skipped_missing ? <p>{preview.skipped_missing} skipped without a valid email.</p> : null}
            {preview.skipped_duplicate ? <p>{preview.skipped_duplicate} skipped because an address is already included.</p> : null}
            {preview.representative ? <>
              <p><strong>Representative subject:</strong> {preview.representative.subject}</p>
              <p><strong>Representative message:</strong></p>
              <pre className="communication-preview-body">{preview.representative.body}</pre>
            </> : <p>No eligible email recipients.</p>}
          </div> : null}
          <div className="form-actions confirmation-modal-actions">
            <button className="secondary-button" disabled={submitting} onClick={onCancel} type="button">
              Cancel
            </button>
            <button className="secondary-button" disabled={submitting || loading} type="submit">{loading ? "Loading..." : "Preview"}</button>
            <button className="primary-button" disabled={submitting || loading || !preview?.recipient_count} onClick={handleSend} type="button">
              {submitting ? "Queuing..." : "Send"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

function TrashIcon() {
  return (
    <svg aria-hidden="true" className="action-icon" focusable="false" viewBox="0 0 24 24">
      <path d="M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3M5 7h14" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
    </svg>
  );
}

function ClassProfileLoading() {
  return (
    <>
      <PageHeader eyebrow="Teaching operations" title="Loading class" />
      <div className="table-placeholder">Loading class details...</div>
    </>
  );
}
