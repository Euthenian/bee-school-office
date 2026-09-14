"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { DataSurface, ResponsiveTable } from "@/components/Surface";
import { useAuth } from "@/components/AuthProvider";
import {
  applyAiEigoInvitationResult,
  canSendAiEigoInvitationForStudent,
  getAiEigoAccessDetail,
  getAiEigoAccessStatus,
  getAiEigoInvitationActionLabel
} from "@/lib/ai-eigo-invitations";
import { formatDate, formatEnrollment, formatPersonName } from "@/lib/format";
import {
  bulkQueueStudentEmails,
  bulkUpdateStudentStatus,
  fetchSchools,
  fetchStudents,
  sendAiEigoStudentInvitation
} from "@/lib/data";
import { getDefaultStudentEmail } from "@/lib/communication-templates";
import { canCreateStudents, canManageAiEigoInvitations } from "@/lib/roles";
import {
  createDefaultStudentFilters,
  filterStudents,
  getLocalDateKey,
  getStudentCourseClassOptions,
  getVisibleSelectedIds,
  hasActiveStudentFilters,
  isValidStudentEmail,
  studentAiEigoFilterOptions,
  studentStatuses,
  studentStartDateFilterOptions
} from "@/lib/students";
import { getSupabaseBrowserClient } from "@/lib/supabase";

const studentStatusFilterOptions = [
  { value: "all", label: "All" },
  ...studentStatuses
];

export default function StudentsPage() {
  const { profile, session } = useAuth();
  const [filters, setFilters] = useState(() => createDefaultStudentFilters());
  const [schools, setSchools] = useState([]);
  const [state, setState] = useState({ loading: true, error: "", students: [] });
  const [notice, setNotice] = useState("");
  const [aiEigoActionStudentId, setAiEigoActionStudentId] = useState("");
  const [selectedStudentIds, setSelectedStudentIds] = useState(() => new Set());
  const [bulkStatusDialogOpen, setBulkStatusDialogOpen] = useState(false);
  const [bulkStatusValue, setBulkStatusValue] = useState("active");
  const [bulkStatusError, setBulkStatusError] = useState("");
  const [bulkStatusSubmitting, setBulkStatusSubmitting] = useState(false);
  const [bulkMailDialogOpen, setBulkMailDialogOpen] = useState(false);
  const [bulkMailForm, setBulkMailForm] = useState({ subject: "", body: "" });
  const [bulkMailError, setBulkMailError] = useState("");
  const [bulkMailSubmitting, setBulkMailSubmitting] = useState(false);
  const [bulkArchiveDialogOpen, setBulkArchiveDialogOpen] = useState(false);
  const [bulkArchiveError, setBulkArchiveError] = useState("");
  const [bulkArchiveSubmitting, setBulkArchiveSubmitting] = useState(false);
  const mayManageAiEigo = canManageAiEigoInvitations(profile);
  const mayManageStudents = canCreateStudents(profile);

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(async () => {
      const supabase = getSupabaseBrowserClient();
      if (!supabase || !session) {
        setState({ loading: false, error: "", students: [] });
        return;
      }

      setState((current) => ({ ...current, loading: true }));
      const [studentsResult, schoolsResult] = await Promise.all([
        fetchStudents(supabase),
        fetchSchools(supabase)
      ]);
      if (!active) return;

      setState({
        loading: false,
        error: [studentsResult.error, schoolsResult.error]
          .filter(Boolean)
          .map((error) => error.message)
          .join(" "),
        students: studentsResult.data || []
      });
      setSchools(schoolsResult.data || []);
    }, 180);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [session]);

  const todayKey = useMemo(() => getLocalDateKey(), []);
  const visibleStudents = useMemo(() => filterStudents(state.students, filters, todayKey), [filters, state.students, todayKey]);
  const visibleSelectedStudentIds = useMemo(
    () => getVisibleSelectedIds(selectedStudentIds, visibleStudents),
    [selectedStudentIds, visibleStudents]
  );
  const selectedStudents = useMemo(
    () => visibleStudents.filter((student) => visibleSelectedStudentIds.has(student.id)),
    [visibleSelectedStudentIds, visibleStudents]
  );
  const selectedStudentCount = visibleSelectedStudentIds.size;
  const selectedRecipientCount = useMemo(
    () => selectedStudents.filter((student) => isValidStudentEmail(getDefaultStudentEmail(student))).length,
    [selectedStudents]
  );
  const selectedNoEmailCount = selectedStudentCount - selectedRecipientCount;
  const allVisibleSelected = Boolean(visibleStudents.length) && selectedStudentCount === visibleStudents.length;
  const partiallySelected = selectedStudentCount > 0 && selectedStudentCount < visibleStudents.length;
  const courseClassOptions = useMemo(() => getStudentCourseClassOptions(state.students), [state.students]);
  const activeSchools = useMemo(() => schools.filter((school) => school.status === "active"), [schools]);
  const filtersActive = hasActiveStudentFilters(filters);

  function updateFilter(key, value) {
    setFilters((current) => ({ ...current, [key]: value }));
  }

  function clearAllFilters() {
    setFilters(createDefaultStudentFilters());
  }

  function setStudentSelection(studentId, checked) {
    setSelectedStudentIds((current) => {
      const next = new Set(current);
      if (checked) {
        next.add(studentId);
      } else {
        next.delete(studentId);
      }
      return next;
    });
  }

  function toggleSelectAllVisible() {
    setSelectedStudentIds((current) => {
      const next = new Set(current);
      if (allVisibleSelected) {
        for (const student of visibleStudents) next.delete(student.id);
      } else {
        for (const student of visibleStudents) next.add(student.id);
      }
      return next;
    });
  }

  function clearSelection() {
    setSelectedStudentIds(new Set());
  }

  function openBulkStatusDialog() {
    setBulkStatusError("");
    setBulkStatusDialogOpen(true);
  }

  function closeBulkStatusDialog() {
    if (bulkStatusSubmitting) return;
    setBulkStatusError("");
    setBulkStatusDialogOpen(false);
  }

  function openBulkMailDialog() {
    setBulkMailError("");
    setBulkMailDialogOpen(true);
  }

  function closeBulkMailDialog() {
    if (bulkMailSubmitting) return;
    setBulkMailError("");
    setBulkMailDialogOpen(false);
  }

  function updateBulkMailField(field, value) {
    setBulkMailForm((current) => ({ ...current, [field]: value }));
  }

  function openBulkArchiveDialog() {
    setBulkArchiveError("");
    setBulkArchiveDialogOpen(true);
  }

  function closeBulkArchiveDialog() {
    if (bulkArchiveSubmitting) return;
    setBulkArchiveError("");
    setBulkArchiveDialogOpen(false);
  }

  async function handleBulkStatusConfirm() {
    const supabase = getSupabaseBrowserClient();
    const studentIds = [...visibleSelectedStudentIds];

    if (!supabase || !session) {
      setBulkStatusError("You must be signed in to update student statuses.");
      return;
    }

    setBulkStatusSubmitting(true);
    setBulkStatusError("");
    setNotice("");

    const { data, error } = await bulkUpdateStudentStatus(
      supabase,
      {
        status: bulkStatusValue,
        studentIds
      },
      profile
    );

    if (error) {
      setBulkStatusError(error.message);
      setBulkStatusSubmitting(false);
      return;
    }

    const updatedById = new Map((data || []).map((student) => [student.id, student]));

    setState((current) => ({
      ...current,
      students: current.students.map((student) => updatedById.get(student.id) || student)
    }));
    clearSelection();
    setBulkStatusDialogOpen(false);
    setBulkStatusSubmitting(false);
    setNotice(`Updated ${studentIds.length} student${studentIds.length === 1 ? "" : "s"}.`);
  }

  async function handleBulkMailSubmit(event) {
    event.preventDefault();

    const supabase = getSupabaseBrowserClient();
    const studentIds = [...visibleSelectedStudentIds];

    if (!supabase || !session) {
      setBulkMailError("You must be signed in to send student email.");
      return;
    }

    setBulkMailSubmitting(true);
    setBulkMailError("");
    setNotice("");

    const { data, error } = await bulkQueueStudentEmails(
      supabase,
      {
        body: bulkMailForm.body,
        studentIds,
        subject: bulkMailForm.subject
      },
      profile
    );

    if (error) {
      setBulkMailError(error.message);
      setBulkMailSubmitting(false);
      return;
    }

    clearSelection();
    setBulkMailDialogOpen(false);
    setBulkMailSubmitting(false);
    setBulkMailForm({ subject: "", body: "" });
    setNotice(`Queued: ${data.queued} · Skipped: ${data.skipped}`);
  }

  async function handleBulkArchiveConfirm() {
    const supabase = getSupabaseBrowserClient();
    const studentIds = [...visibleSelectedStudentIds];

    if (!supabase || !session) {
      setBulkArchiveError("You must be signed in to archive students.");
      return;
    }

    setBulkArchiveSubmitting(true);
    setBulkArchiveError("");
    setNotice("");

    const { data, error } = await bulkUpdateStudentStatus(
      supabase,
      {
        status: "inactive",
        studentIds
      },
      profile
    );

    if (error) {
      setBulkArchiveError(error.message);
      setBulkArchiveSubmitting(false);
      return;
    }

    const updatedById = new Map((data || []).map((student) => [student.id, student]));

    setState((current) => ({
      ...current,
      students: current.students.map((student) => updatedById.get(student.id) || student)
    }));
    clearSelection();
    setBulkArchiveDialogOpen(false);
    setBulkArchiveSubmitting(false);
    setNotice(`Archived ${studentIds.length} student${studentIds.length === 1 ? "" : "s"}.`);
  }

  async function handleSendAiEigoInvitation(student) {
    const supabase = getSupabaseBrowserClient();
    if (!supabase || !session) {
      setState((current) => ({ ...current, error: "You must be signed in before sending an AI-EIGO invitation." }));
      return;
    }

    setAiEigoActionStudentId(student.id);
    setNotice("");
    setState((current) => ({ ...current, error: "" }));

    const { data, error } = await sendAiEigoStudentInvitation(supabase, student.id);

    if (error) {
      setState((current) => ({ ...current, error: error.message }));
      setAiEigoActionStudentId("");
      return;
    }

    setState((current) => ({
      ...current,
      students: current.students.map((row) => (row.id === student.id ? applyAiEigoInvitationResult(row, data) : row))
    }));
    setAiEigoActionStudentId("");
    setNotice("AI-EIGO invitation queued for secure email sending.");
  }

  return (
    <>
      <PageHeader
        eyebrow="Student management"
        title="Students"
        description="Search and review student records available to your organization or school role."
        actions={
          canCreateStudents(profile) ? (
            <Link className="primary-button" href="/students/new/">
              Add student
            </Link>
          ) : null
        }
      />

      <div className="toolbar">
        <label className="search-field">
          <span>Search students</span>
          <input
            onChange={(event) => updateFilter("search", event.target.value)}
            placeholder="Name or preferred name"
            type="search"
            value={filters.search}
          />
        </label>
        <label className="search-field">
          <span>Status</span>
          <select onChange={(event) => updateFilter("status", event.target.value)} value={filters.status}>
            {studentStatusFilterOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="search-field">
          <span>School</span>
          <select onChange={(event) => updateFilter("schoolId", event.target.value)} value={filters.schoolId}>
            <option value="all">All schools</option>
            {activeSchools.map((school) => (
              <option key={school.id} value={school.id}>
                {school.name}
              </option>
            ))}
          </select>
        </label>
        <label className="search-field">
          <span>Course / class</span>
          <select onChange={(event) => updateFilter("courseClass", event.target.value)} value={filters.courseClass}>
            <option value="all">All courses/classes</option>
            {courseClassOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="search-field">
          <span>Start date</span>
          <select onChange={(event) => updateFilter("startDate", event.target.value)} value={filters.startDate}>
            {studentStartDateFilterOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        {mayManageAiEigo ? (
          <label className="search-field">
            <span>AI-EIGO</span>
            <select onChange={(event) => updateFilter("aiEigo", event.target.value)} value={filters.aiEigo}>
              {studentAiEigoFilterOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <div className="toolbar-filter-actions">
          {filtersActive ? (
            <button className="ghost-button" onClick={clearAllFilters} type="button">
              Clear all filters
            </button>
          ) : null}
        </div>
      </div>

      {state.error ? <p className="inline-alert">{state.error}</p> : null}
      {notice ? <p className="inline-success">{notice}</p> : null}
      {selectedStudentCount > 0 ? (
        <div className="trial-lesson-selection-bar">
          <p>
            <strong>{selectedStudentCount}</strong> student{selectedStudentCount === 1 ? "" : "s"} selected
          </p>
          <div className="trial-lesson-selection-actions">
            {mayManageStudents ? (
              <>
                <button className="secondary-button" onClick={openBulkStatusDialog} type="button">
                  Change status
                </button>
                <button className="secondary-button" onClick={openBulkMailDialog} type="button">
                  Send mail
                </button>
                <button className="danger-button" onClick={openBulkArchiveDialog} type="button">
                  Archive
                </button>
              </>
            ) : null}
            <button className="ghost-button" onClick={clearSelection} type="button">
              Clear selection
            </button>
          </div>
        </div>
      ) : null}

      <DataSurface aria-label="Students list">
        {state.loading ? (
          <div className="table-placeholder">Loading students...</div>
        ) : visibleStudents.length ? (
          <ResponsiveTable>
            <table>
              <thead>
                <tr>
                  {mayManageStudents ? (
                    <th className="selection-column">
                      <SelectAllStudentsCheckbox
                        checked={allVisibleSelected}
                        disabled={!visibleStudents.length}
                        indeterminate={partiallySelected}
                        onChange={toggleSelectAllVisible}
                      />
                    </th>
                  ) : null}
                  <th>Student</th>
                  <th>Status</th>
                  <th>School</th>
                  <th>Course / class</th>
                  <th>Start date</th>
                  {mayManageAiEigo ? <th>AI-EIGO</th> : null}
                </tr>
              </thead>
              <tbody>
                {visibleStudents.map((student) => (
                  <tr key={student.id}>
                    {mayManageStudents ? (
                      <td className="selection-cell">
                        <input
                          aria-label={`Select ${formatPersonName(student)}`}
                          checked={visibleSelectedStudentIds.has(student.id)}
                          onChange={(event) => setStudentSelection(student.id, event.target.checked)}
                          type="checkbox"
                        />
                      </td>
                    ) : null}
                    <td>
                      <Link href={`/students/profile/?id=${student.id}`}>{formatPersonName(student)}</Link>
                    </td>
                    <td>
                      <StatusBadge value={student.status} />
                    </td>
                    <td>{student.schools?.name || "Unassigned"}</td>
                    <td>{formatEnrollment(student.student_enrollments)}</td>
                    <td>{formatDate(student.start_date)}</td>
                    {mayManageAiEigo ? (
                      <td>
                        <AiEigoStudentListCell
                          actionStudentId={aiEigoActionStudentId}
                          onSend={handleSendAiEigoInvitation}
                          student={student}
                        />
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </ResponsiveTable>
        ) : (
          <EmptyState title="No students found" description="No readable student records matched the current search." />
        )}
      </DataSurface>

      {bulkStatusDialogOpen ? (
        <BulkStudentStatusDialog
          count={selectedStudentCount}
          error={bulkStatusError}
          onCancel={closeBulkStatusDialog}
          onConfirm={handleBulkStatusConfirm}
          onStatusChange={setBulkStatusValue}
          status={bulkStatusValue}
          statusOptions={studentStatuses}
          submitting={bulkStatusSubmitting}
        />
      ) : null}
      {bulkMailDialogOpen ? (
        <BulkStudentMailDialog
          body={bulkMailForm.body}
          error={bulkMailError}
          noEmailCount={selectedNoEmailCount}
          onBodyChange={(value) => updateBulkMailField("body", value)}
          onCancel={closeBulkMailDialog}
          onSubmit={handleBulkMailSubmit}
          onSubjectChange={(value) => updateBulkMailField("subject", value)}
          recipientCount={selectedRecipientCount}
          selectedCount={selectedStudentCount}
          subject={bulkMailForm.subject}
          submitting={bulkMailSubmitting}
        />
      ) : null}
      {bulkArchiveDialogOpen ? (
        <BulkStudentArchiveDialog
          count={selectedStudentCount}
          error={bulkArchiveError}
          onCancel={closeBulkArchiveDialog}
          onConfirm={handleBulkArchiveConfirm}
          submitting={bulkArchiveSubmitting}
        />
      ) : null}
    </>
  );
}

function AiEigoStudentListCell({ actionStudentId, onSend, student }) {
  const status = getAiEigoAccessStatus(student);
  const actionLabel = getAiEigoInvitationActionLabel(student);
  const canSend = canSendAiEigoInvitationForStudent(student);
  const sending = actionStudentId === student.id;

  return (
    <div className="table-cell-stack">
      <StatusBadge value={status} />
      <span>{getAiEigoAccessDetail(student)}</span>
      {actionLabel ? (
        <button
          className="secondary-button"
          disabled={sending || !canSend}
          onClick={() => onSend(student)}
          type="button"
        >
          {sending ? "Queuing..." : actionLabel}
        </button>
      ) : null}
    </div>
  );
}

function SelectAllStudentsCheckbox({ checked, disabled, indeterminate, onChange }) {
  const inputRef = useRef(null);

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.indeterminate = Boolean(indeterminate);
    }
  }, [indeterminate]);

  return (
    <input
      aria-label="Select all visible students"
      checked={checked}
      disabled={disabled}
      onChange={onChange}
      ref={inputRef}
      type="checkbox"
    />
  );
}

function BulkStudentStatusDialog({ count, error, onCancel, onConfirm, onStatusChange, status, statusOptions, submitting }) {
  return (
    <div className="modal-backdrop" role="presentation">
      <section
        aria-labelledby="bulk-student-status-title"
        aria-modal="true"
        className="communication-modal confirmation-modal"
        role="dialog"
      >
        <header className="communication-modal-header">
          <h2 id="bulk-student-status-title">Change status</h2>
        </header>
        <div className="confirmation-modal-body">
          <p>
            Update the status for <strong>{count}</strong> selected student{count === 1 ? "" : "s"}.
          </p>
          <label className="form-field">
            <span>Status</span>
            <select disabled={submitting} onChange={(event) => onStatusChange(event.target.value)} value={status}>
              {statusOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          {error ? <p className="inline-alert">{error}</p> : null}
        </div>
        <div className="form-actions confirmation-modal-actions">
          <button className="secondary-button" disabled={submitting} onClick={onCancel} type="button">
            Cancel
          </button>
          <button className="primary-button" disabled={submitting || !count} onClick={onConfirm} type="button">
            {submitting ? "Updating..." : "Confirm"}
          </button>
        </div>
      </section>
    </div>
  );
}

function BulkStudentMailDialog({
  body,
  error,
  noEmailCount,
  onBodyChange,
  onCancel,
  onSubmit,
  onSubjectChange,
  recipientCount,
  selectedCount,
  subject,
  submitting
}) {
  return (
    <div className="modal-backdrop" role="presentation">
      <section aria-labelledby="bulk-student-mail-title" aria-modal="true" className="communication-modal" role="dialog">
        <header className="communication-modal-header">
          <div>
            <p className="eyebrow">{selectedCount} selected</p>
            <h2 id="bulk-student-mail-title">Send mail</h2>
          </div>
          <button className="ghost-button" disabled={submitting} onClick={onCancel} type="button">
            Cancel
          </button>
        </header>
        <form className="student-form" onSubmit={onSubmit}>
          <div className="confirmation-modal-body">
            <p>
              Recipients: <strong>{recipientCount}</strong> · No email: <strong>{noEmailCount}</strong>
            </p>
            {error ? <p className="inline-alert">{error}</p> : null}
            <label className="form-field">
              <span>Subject</span>
              <input
                disabled={submitting}
                onChange={(event) => onSubjectChange(event.target.value)}
                required
                type="text"
                value={subject}
              />
            </label>
            <label className="form-field">
              <span>Message</span>
              <textarea disabled={submitting} onChange={(event) => onBodyChange(event.target.value)} required value={body} />
            </label>
          </div>
          <div className="form-actions confirmation-modal-actions">
            <button className="secondary-button" disabled={submitting} onClick={onCancel} type="button">
              Cancel
            </button>
            <button className="primary-button" disabled={submitting || !recipientCount} type="submit">
              {submitting ? "Queuing..." : "Send"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

function BulkStudentArchiveDialog({ count, error, onCancel, onConfirm, submitting }) {
  return (
    <div className="modal-backdrop" role="presentation">
      <section
        aria-labelledby="bulk-student-archive-title"
        aria-modal="true"
        className="communication-modal confirmation-modal"
        role="dialog"
      >
        <header className="communication-modal-header">
          <h2 id="bulk-student-archive-title">Archive {count} selected students?</h2>
        </header>
        <div className="confirmation-modal-body">
          <p>
            Archived students will be marked inactive. Their history, billing, communications, enrollments, AI-EIGO
            records, and other linked data will not be deleted.
          </p>
          {error ? <p className="inline-alert">{error}</p> : null}
        </div>
        <div className="form-actions confirmation-modal-actions">
          <button className="secondary-button" disabled={submitting} onClick={onCancel} type="button">
            Cancel
          </button>
          <button className="danger-button" disabled={submitting || !count} onClick={onConfirm} type="button">
            {submitting ? "Archiving..." : "Archive students"}
          </button>
        </div>
      </section>
    </div>
  );
}
