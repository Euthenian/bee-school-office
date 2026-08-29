"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CommunicationComposer } from "@/components/CommunicationComposer";
import { CommunicationHistory } from "@/components/CommunicationHistory";
import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";
import { QuestionDeleteDialog } from "@/components/QuestionDeleteDialog";
import { StatusBadge } from "@/components/StatusBadge";
import { DataSurface, ResponsiveTable, SurfaceHeader } from "@/components/Surface";
import { useAuth } from "@/components/AuthProvider";
import {
  applyAiEigoInvitationResult,
  canSendAiEigoInvitationForStudent,
  getAiEigoAccessDetail,
  getAiEigoAccessStatus,
  getAiEigoInvitationActionLabel,
  getAiEigoLink,
  getLatestAiEigoInvitation,
  getStudentInvitationRecipient
} from "@/lib/ai-eigo-invitations";
import {
  formatBillingAmount,
  getChargeAllocatedTotal,
  getChargeBalance,
  getPaymentAllocatedTotal,
  getPaymentUnallocatedBalance,
  getPrimaryBillingSummary
} from "@/lib/billing";
import {
  formatClassLevel,
  formatLessonDay,
  formatLessonTime,
  formatLessonType,
  formatTeacherName,
  getActiveEnrollment
} from "@/lib/class-details";
import { groupStudentContacts } from "@/lib/contacts";
import { buildStudentCommunicationContext, getDefaultStudentEmail } from "@/lib/communication-templates";
import { formatDate, formatEnrollment, formatPersonName, formatStudentAge, humanize } from "@/lib/format";
import {
  changeStudentQuestionDate,
  createStudentQuestion,
  deleteStudentQuestion,
  fetchStudentBilling,
  fetchStudentCommunications,
  fetchStudentProfile,
  fetchStudentQuestions,
  markStudentQuestionDone,
  sendAiEigoStudentInvitation
} from "@/lib/data";
import {
  canCreateStudents,
  canManageAiEigoInvitations,
  canManageBilling,
  canManageCommunications,
  canManageStudentQuestions
} from "@/lib/roles";
import {
  createStudentQuestionForm,
  getStudentQuestionDisplayStatus,
  getTodayDateString,
  isStudentQuestionOverdue,
  notifyStudentQuestionsUpdated,
  removeStudentQuestionById,
  replaceStudentQuestionById,
  sortOpenStudentQuestions,
  validateStudentQuestionForm
} from "@/lib/student-questions";
import { getSupabaseBrowserClient } from "@/lib/supabase";

export default function StudentProfilePage() {
  return (
    <Suspense fallback={<ProfileLoading />}>
      <StudentProfileContent />
    </Suspense>
  );
}

function StudentProfileContent() {
  const { profile, session } = useAuth();
  const searchParams = useSearchParams();
  const studentId = searchParams.get("id") || "";
  const [composerOpen, setComposerOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const [aiEigoActionStudentId, setAiEigoActionStudentId] = useState("");
  const [aiEigoError, setAiEigoError] = useState("");
  const [questionFormOpen, setQuestionFormOpen] = useState(false);
  const [questionForm, setQuestionForm] = useState(createStudentQuestionForm());
  const [questionActionId, setQuestionActionId] = useState("");
  const [questionDateTarget, setQuestionDateTarget] = useState(null);
  const [questionDateValue, setQuestionDateValue] = useState("");
  const [questionDeleteTarget, setQuestionDeleteTarget] = useState(null);
  const [questionDeleteError, setQuestionDeleteError] = useState("");
  const [state, setState] = useState({
    billing: { charges: [], payments: [], refunds: [], summary: [] },
    billingError: "",
    communicationError: "",
    communications: [],
    questionError: "",
    questions: [],
    loading: true,
    error: "",
    student: null
  });

  useEffect(() => {
    let active = true;

    async function loadStudent() {
      const supabase = getSupabaseBrowserClient();
      if (!supabase || !session || !studentId) {
        setState({
          billing: { charges: [], payments: [], refunds: [], summary: [] },
          billingError: "",
          communicationError: "",
          communications: [],
          questionError: "",
          questions: [],
          loading: false,
          error: "",
          student: null
        });
        return;
      }

      setState((current) => ({ ...current, loading: true }));
      const mayLoadBilling = canManageBilling(profile);
      const mayLoadQuestions = canManageStudentQuestions(profile);
      const [{ data, error }, communicationsResult, billingResult, questionsResult] = await Promise.all([
        fetchStudentProfile(supabase, studentId),
        canManageCommunications(profile) ? fetchStudentCommunications(supabase, studentId) : { data: [], error: null },
        mayLoadBilling
          ? fetchStudentBilling(supabase, studentId)
          : { data: { charges: [], payments: [], refunds: [], summary: [] }, error: null },
        mayLoadQuestions ? fetchStudentQuestions(supabase, { studentId, status: "open" }) : { data: [], error: null }
      ]);
      if (!active) return;

      setState({
        billing: billingResult.data || { charges: [], payments: [], refunds: [], summary: [] },
        billingError: billingResult.error ? billingResult.error.message : "",
        communicationError: communicationsResult.error ? communicationsResult.error.message : "",
        communications: communicationsResult.data || [],
        questionError: questionsResult.error ? questionsResult.error.message : "",
        questions: sortOpenStudentQuestions(questionsResult.data || []),
        loading: false,
        error: error ? error.message : "",
        student: data || null
      });
    }

    loadStudent();

    return () => {
      active = false;
    };
  }, [profile, session, studentId]);

  async function handleEmailSent() {
    setComposerOpen(false);
    setNotice("Email queued for secure sending.");

    const supabase = getSupabaseBrowserClient();
    if (!supabase || !session || !studentId) return;

    const { data } = await fetchStudentCommunications(supabase, studentId);
    setState((current) => ({ ...current, communications: data || [] }));
  }

  async function handleSendAiEigoInvitation() {
    const supabase = getSupabaseBrowserClient();
    if (!supabase || !session || !state.student) {
      setAiEigoError("You must be signed in before sending an AI-EIGO invitation.");
      return;
    }

    setAiEigoActionStudentId(state.student.id);
    setAiEigoError("");
    setNotice("");

    const { data, error } = await sendAiEigoStudentInvitation(supabase, state.student.id);

    if (error) {
      setAiEigoError(error.message);
      setAiEigoActionStudentId("");
      return;
    }

    setState((current) => ({
      ...current,
      student: applyAiEigoInvitationResult(current.student, data)
    }));
    setAiEigoActionStudentId("");
    setNotice("AI-EIGO invitation queued for secure Gmail sending.");
  }

  function updateQuestionForm(field, value) {
    setQuestionForm((current) => ({ ...current, [field]: value }));
  }

  async function handleCreateQuestion(event) {
    event.preventDefault();

    if (!validateStudentQuestionForm(questionForm)) {
      setState((current) => ({ ...current, questionError: "Question text and reminder date are required." }));
      return;
    }

    const supabase = getSupabaseBrowserClient();
    if (!supabase || !session || !state.student) {
      setState((current) => ({ ...current, questionError: "You must be signed in before adding a question." }));
      return;
    }

    setQuestionActionId("create");
    setState((current) => ({ ...current, questionError: "" }));

    const { data, error } = await createStudentQuestion(supabase, {
      createdBy: session.user.id,
      organizationId: state.student.organization_id,
      question: questionForm.question,
      reminderDate: questionForm.reminderDate,
      schoolId: state.student.school_id,
      studentId: state.student.id
    });

    if (error) {
      setState((current) => ({ ...current, questionError: error.message }));
      setQuestionActionId("");
      return;
    }

    setState((current) => ({
      ...current,
      questions: sortOpenStudentQuestions([...(current.questions || []), data])
    }));
    setQuestionForm(createStudentQuestionForm());
    setQuestionFormOpen(false);
    setQuestionActionId("");
    setNotice("Question added.");
    notifyStudentQuestionsUpdated();
  }

  async function handleMarkQuestionDone(question) {
    const supabase = getSupabaseBrowserClient();
    if (!supabase || !session) {
      setState((current) => ({ ...current, questionError: "You must be signed in before updating a question." }));
      return;
    }

    setQuestionActionId(question.id);
    setState((current) => ({ ...current, questionError: "" }));

    const { error } = await markStudentQuestionDone(supabase, question.id);

    if (error) {
      setState((current) => ({ ...current, questionError: error.message }));
      setQuestionActionId("");
      return;
    }

    setState((current) => ({
      ...current,
      questions: removeStudentQuestionById(current.questions, question.id)
    }));
    setQuestionActionId("");
    setNotice("Question marked done.");
    notifyStudentQuestionsUpdated();
  }

  function handleChangeQuestionDate(question) {
    setQuestionDateTarget(question);
    setQuestionDateValue(question.reminder_date || "");
  }

  async function handleSaveQuestionDate(event) {
    event.preventDefault();

    if (!questionDateTarget || !questionDateValue) return;

    const supabase = getSupabaseBrowserClient();
    if (!supabase || !session) {
      setState((current) => ({ ...current, questionError: "You must be signed in before updating a question." }));
      return;
    }

    setQuestionActionId(questionDateTarget.id);
    setState((current) => ({ ...current, questionError: "" }));

    const { data, error } = await changeStudentQuestionDate(supabase, questionDateTarget.id, questionDateValue);

    if (error) {
      setState((current) => ({ ...current, questionError: error.message }));
      setQuestionActionId("");
      return;
    }

    setState((current) => ({
      ...current,
      questions: replaceStudentQuestionById(current.questions, data)
    }));
    setQuestionActionId("");
    setQuestionDateTarget(null);
    setQuestionDateValue("");
    setNotice("Question date updated.");
    notifyStudentQuestionsUpdated();
  }

  function handleRequestDeleteQuestion(question) {
    setQuestionDeleteError("");
    setQuestionDeleteTarget(question);
  }

  function handleCancelDeleteQuestion() {
    if (questionActionId === questionDeleteTarget?.id) return;

    setQuestionDeleteError("");
    setQuestionDeleteTarget(null);
  }

  async function handleConfirmDeleteQuestion() {
    if (!questionDeleteTarget) return;

    const supabase = getSupabaseBrowserClient();
    if (!supabase || !session) {
      setQuestionDeleteError("You must be signed in before deleting a question.");
      return;
    }

    setQuestionActionId(questionDeleteTarget.id);
    setQuestionDeleteError("");
    setState((current) => ({ ...current, questionError: "" }));

    const { error } = await deleteStudentQuestion(supabase, questionDeleteTarget.id);

    if (error) {
      setQuestionDeleteError(error.message);
      setQuestionActionId("");
      return;
    }

    setState((current) => ({
      ...current,
      questions: removeStudentQuestionById(current.questions, questionDeleteTarget.id)
    }));
    setQuestionActionId("");
    setQuestionDeleteTarget(null);
    setNotice("Question deleted.");
    notifyStudentQuestionsUpdated();
  }

  if (!studentId && !state.loading) {
    return (
      <>
        <PageHeader eyebrow="Student profile" title="Student not selected" />
        <EmptyState title="No student ID was provided" description="Open a student from the Students list to view a profile." />
      </>
    );
  }

  if (state.loading) {
    return (
      <>
        <PageHeader eyebrow="Student profile" title="Loading student" />
        <div className="table-placeholder">Loading student profile...</div>
      </>
    );
  }

  if (state.error || !state.student) {
    return (
      <>
        <PageHeader eyebrow="Student profile" title="Student unavailable" />
        <p className="inline-alert">{state.error || "This student could not be found or is not visible to your role."}</p>
        <Link className="secondary-button" href="/students/">
          Back to students
        </Link>
      </>
    );
  }

  const student = state.student;
  const contactGroups = groupStudentContacts(student.student_contacts);
  const hasContacts = contactGroups.emails.length || contactGroups.phones.length;
  const activeEnrollment = getActiveEnrollment(student.student_enrollments);
  const classDetails = activeEnrollment?.classes;
  const mayEdit = canCreateStudents(profile);
  const mayManageStudentBilling = canManageBilling(profile);
  const mayCommunicate = canManageCommunications(profile);
  const mayManageQuestions = canManageStudentQuestions(profile);
  const mayManageAiEigo = canManageAiEigoInvitations(profile);

  return (
    <>
      <PageHeader
        eyebrow="Student profile"
        title={formatPersonName(student)}
        description={`${student.schools?.name || "Unassigned school"} - ${formatEnrollment(student.student_enrollments)}`}
        actions={
          <div className="form-actions">
            <StatusBadge value={student.status} />
            {mayCommunicate ? (
              <button className="secondary-button" onClick={() => setComposerOpen(true)} type="button">
                Send email
              </button>
            ) : null}
            {mayEdit ? (
              <Link className="primary-button" href={`/students/edit/?id=${student.id}`}>
                Edit student
              </Link>
            ) : null}
          </div>
        }
      />

      {notice ? <p className="inline-success">{notice}</p> : null}

      {composerOpen ? (
        <CommunicationComposer
          context={{
            defaultMessageType: "general_message",
            defaultRecipient: getDefaultStudentEmail(student),
            organizationId: student.organization_id,
            schoolId: student.school_id,
            studentId: student.id,
            templateContext: buildStudentCommunicationContext(student)
          }}
          onCancel={() => setComposerOpen(false)}
          onSent={handleEmailSent}
        />
      ) : null}

      {questionDeleteTarget ? (
        <QuestionDeleteDialog
          deleting={questionActionId === questionDeleteTarget.id}
          error={questionDeleteError}
          onCancel={handleCancelDeleteQuestion}
          onConfirm={handleConfirmDeleteQuestion}
        />
      ) : null}

      <div className="profile-grid">
        <DataSurface>
          <SurfaceHeader>
            <h2>Basic Information</h2>
          </SurfaceHeader>
          <dl className="detail-list">
            <div>
              <dt>Legal name</dt>
              <dd>{formatPersonName(student)}</dd>
            </div>
            <div>
              <dt>Preferred name</dt>
              <dd>{student.preferred_name || "Not set"}</dd>
            </div>
            <div>
              <dt>Enrollment status</dt>
              <dd>
                <StatusBadge value={student.status} />
              </dd>
            </div>
            <div>
              <dt>Start date</dt>
              <dd>{formatDate(student.start_date)}</dd>
            </div>
            <div>
              <dt>Date of birth</dt>
              <dd>{formatDate(student.date_of_birth)}</dd>
            </div>
          </dl>
        </DataSurface>

        <DataSurface>
          <SurfaceHeader>
            <h2>School</h2>
          </SurfaceHeader>
          <dl className="detail-list">
            <div>
              <dt>Organization</dt>
              <dd>{student.organizations?.name || "Not assigned"}</dd>
            </div>
            <div>
              <dt>School</dt>
              <dd>{student.schools?.name || "Not assigned"}</dd>
            </div>
            <div>
              <dt>Course / class</dt>
              <dd>{formatEnrollment(student.student_enrollments)}</dd>
            </div>
          </dl>
        </DataSurface>

        <DataSurface>
          <SurfaceHeader>
            <h2>Class Details</h2>
          </SurfaceHeader>
          <dl className="detail-list">
            <div>
              <dt>Assigned teacher</dt>
              <dd>{formatTeacherName(classDetails?.assigned_teacher)}</dd>
            </div>
            <div>
              <dt>Lesson type</dt>
              <dd>{formatLessonType(classDetails?.lesson_type)}</dd>
            </div>
            <div>
              <dt>Level</dt>
              <dd>{formatClassLevel(classDetails, activeEnrollment)}</dd>
            </div>
            <div>
              <dt>Current age</dt>
              <dd>{formatStudentAge(student)}</dd>
            </div>
            <div>
              <dt>Lesson day</dt>
              <dd>{formatLessonDay(classDetails?.lesson_day)}</dd>
            </div>
            <div>
              <dt>Lesson time</dt>
              <dd>{formatLessonTime(classDetails?.lesson_time)}</dd>
            </div>
          </dl>
        </DataSurface>

        <DataSurface>
          <SurfaceHeader>
            <h2>Contact Information</h2>
          </SurfaceHeader>
          {hasContacts ? (
            <div className="contact-display">
              <ContactList title="Email" contacts={contactGroups.emails} />
              <ContactList title="Phone" contacts={contactGroups.phones} />
            </div>
          ) : (
            <EmptyState title="No contact details" description="Contact records have not been added for this student." />
          )}
        </DataSurface>

        {mayManageAiEigo ? (
          <DataSurface>
            <SurfaceHeader>
              <h2>AI-EIGO Access</h2>
            </SurfaceHeader>
            <AiEigoAccessPanel
              actionStudentId={aiEigoActionStudentId}
              error={aiEigoError}
              onSend={handleSendAiEigoInvitation}
              student={student}
            />
          </DataSurface>
        ) : null}

        <DataSurface>
          <SurfaceHeader>
            <h2>Parent / Guardian</h2>
          </SurfaceHeader>
          {student.student_guardians?.length ? (
            <div className="stack-list">
              {student.student_guardians.map((guardian) => (
                <article className="list-card" key={guardian.id}>
                  <strong>{guardian.full_name}</strong>
                  <span>{guardian.relationship || "Relationship not set"}</span>
                  <span>{guardian.email || guardian.phone || "No contact value"}</span>
                </article>
              ))}
            </div>
          ) : (
            <EmptyState title="No guardian records" description="Guardian details can be added after the admin forms are introduced." />
          )}
        </DataSurface>

        {mayManageQuestions ? (
          <DataSurface className="span-two">
            <SurfaceHeader
              actions={
                <button className="secondary-button" onClick={() => setQuestionFormOpen((current) => !current)} type="button">
                  Add question
                </button>
              }
            >
              <h2>Questions to ask</h2>
            </SurfaceHeader>
            {state.questionError ? <p className="inline-alert">{state.questionError}</p> : null}
            {questionFormOpen ? (
              <form className="student-question-form" onSubmit={handleCreateQuestion}>
                <label>
                  <span>Question text</span>
                  <textarea
                    onChange={(event) => updateQuestionForm("question", event.target.value)}
                    required
                    rows="3"
                    value={questionForm.question}
                  />
                </label>
                <label>
                  <span>Reminder date</span>
                  <input
                    onChange={(event) => updateQuestionForm("reminderDate", event.target.value)}
                    required
                    type="date"
                    value={questionForm.reminderDate}
                  />
                </label>
                <div className="form-actions">
                  <button
                    className="secondary-button"
                    onClick={() => {
                      setQuestionForm(createStudentQuestionForm());
                      setQuestionFormOpen(false);
                    }}
                    type="button"
                  >
                    Cancel
                  </button>
                  <button className="primary-button" disabled={questionActionId === "create"} type="submit">
                    {questionActionId === "create" ? "Adding..." : "Add question"}
                  </button>
                </div>
              </form>
            ) : null}
            <StudentQuestionsTable
              actionId={questionActionId}
              dateTarget={questionDateTarget}
              dateValue={questionDateValue}
              onCancelDateChange={() => setQuestionDateTarget(null)}
              onChangeDate={handleChangeQuestionDate}
              onDateValueChange={setQuestionDateValue}
              onDelete={handleRequestDeleteQuestion}
              onMarkDone={handleMarkQuestionDone}
              onSaveDate={handleSaveQuestionDate}
              questions={state.questions}
              today={getTodayDateString()}
            />
          </DataSurface>
        ) : null}

        {mayCommunicate ? (
          <DataSurface className="span-two">
            <SurfaceHeader
              actions={
                <Link className="secondary-button" href={`/communications/?studentId=${student.id}`}>
                  View full history
                </Link>
              }
            >
              <h2>Communications</h2>
            </SurfaceHeader>
            {state.communicationError ? <p className="inline-alert">{state.communicationError}</p> : null}
            <CommunicationHistory communications={state.communications} />
          </DataSurface>
        ) : null}

        {mayManageStudentBilling ? (
          <StudentBillingSection billing={state.billing} billingError={state.billingError} student={student} />
        ) : null}

        <DataSurface className="span-two">
          <SurfaceHeader>
            <h2>Internal Notes</h2>
          </SurfaceHeader>
          {student.student_notes?.length ? (
            <div className="stack-list">
              {student.student_notes.map((note) => (
                <article className="list-card" key={note.id}>
                  <div className="list-card-header">
                    <strong>{note.visibility === "admin" ? "Administrative" : "Educational"}</strong>
                    <span>{formatDate(note.created_at)}</span>
                  </div>
                  <p>{note.note}</p>
                </article>
              ))}
            </div>
          ) : (
            <EmptyState title="No readable notes" description="Notes may be absent or restricted by role." />
          )}
        </DataSurface>
      </div>
    </>
  );
}

function StudentQuestionsTable({
  actionId,
  dateTarget,
  dateValue,
  onCancelDateChange,
  onChangeDate,
  onDateValueChange,
  onDelete,
  onMarkDone,
  onSaveDate,
  questions,
  today
}) {
  if (!questions.length) {
    return <EmptyState title="No open questions" description="There are no open questions to ask this student." />;
  }

  return (
    <ResponsiveTable>
      <table>
        <thead>
          <tr>
            <th>Reminder date</th>
            <th>Question</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {questions.map((question) => (
            <tr className={isStudentQuestionOverdue(question, today) ? "overdue-row" : ""} key={question.id}>
              <td>{formatDate(question.reminder_date)}</td>
              <td>{question.question}</td>
              <td>
                <StatusBadge value={getStudentQuestionDisplayStatus(question, today)} />
              </td>
              <td>
                {dateTarget?.id === question.id ? (
                  <form className="inline-date-form" onSubmit={onSaveDate}>
                    <input
                      aria-label="Reminder date"
                      onChange={(event) => onDateValueChange(event.target.value)}
                      required
                      type="date"
                      value={dateValue}
                    />
                    <button className="primary-button" disabled={actionId === question.id} type="submit">
                      Save
                    </button>
                    <button className="secondary-button" disabled={actionId === question.id} onClick={onCancelDateChange} type="button">
                      Cancel
                    </button>
                  </form>
                ) : (
                  <div className="table-actions">
                    <button className="secondary-button" disabled={actionId === question.id} onClick={() => onMarkDone(question)} type="button">
                      {actionId === question.id ? "Saving..." : "Mark done"}
                    </button>
                    <button className="secondary-button" disabled={Boolean(actionId)} onClick={() => onChangeDate(question)} type="button">
                      Change date
                    </button>
                    <button className="danger-button" disabled={Boolean(actionId)} onClick={() => onDelete(question)} type="button">
                      Delete
                    </button>
                  </div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </ResponsiveTable>
  );
}

function AiEigoAccessPanel({ actionStudentId, error, onSend, student }) {
  const status = getAiEigoAccessStatus(student);
  const actionLabel = getAiEigoInvitationActionLabel(student);
  const canSend = canSendAiEigoInvitationForStudent(student);
  const recipient = getStudentInvitationRecipient(student);
  const invitation = getLatestAiEigoInvitation(student);
  const link = getAiEigoLink(student);
  const sending = actionStudentId === student.id;

  return (
    <>
      {error ? <p className="inline-alert">{error}</p> : null}
      <dl className="detail-list">
        <div>
          <dt>Status</dt>
          <dd>
            <span className="ai-eigo-status-line">
              <StatusBadge value={status} />
              <span>{getAiEigoAccessDetail(student)}</span>
            </span>
          </dd>
        </div>
        <div>
          <dt>Email</dt>
          <dd>{recipient || "No email contact"}</dd>
        </div>
        {invitation?.token_expires_at ? (
          <div>
            <dt>Invitation expires</dt>
            <dd>{formatDate(invitation.token_expires_at)}</dd>
          </div>
        ) : null}
        {link?.linked_at ? (
          <div>
            <dt>Linked at</dt>
            <dd>{formatDate(link.linked_at)}</dd>
          </div>
        ) : null}
      </dl>
      {actionLabel ? (
        <div className="form-actions ai-eigo-actions">
          <button className="secondary-button" disabled={sending || !canSend} onClick={onSend} type="button">
            {sending ? "Queuing..." : actionLabel}
          </button>
        </div>
      ) : null}
    </>
  );
}

function StudentBillingSection({ billing, billingError, student }) {
  const summary = getPrimaryBillingSummary(billing.summary);

  return (
    <DataSurface className="span-two">
      <SurfaceHeader
        actions={
          <div className="table-actions">
            <Link className="secondary-button" href={`/billing/charges/new/?studentId=${student.id}`}>
              Add charge
            </Link>
            <Link className="secondary-button" href={`/billing/payments/new/?studentId=${student.id}`}>
              Record payment
            </Link>
            <Link className="secondary-button" href={`/billing/allocations/new/?studentId=${student.id}`}>
              Allocate payment
            </Link>
            <Link className="secondary-button" href={`/billing/charges/new/?studentId=${student.id}&type=adjustment`}>
              Add adjustment
            </Link>
            <Link className="secondary-button" href={`/billing/refunds/new/?studentId=${student.id}`}>
              Record refund
            </Link>
          </div>
        }
      >
        <h2>Billing / Payments</h2>
      </SurfaceHeader>
      {billingError ? <p className="inline-alert">{billingError}</p> : null}
      <dl className="detail-list">
        <div>
          <dt>Outstanding balance</dt>
          <dd>{formatBillingAmount(summary.outstanding_balance, summary.currency)}</dd>
        </div>
        <div>
          <dt>Overdue balance</dt>
          <dd>{formatBillingAmount(summary.overdue_balance, summary.currency)}</dd>
        </div>
        <div>
          <dt>Allocated payments</dt>
          <dd>{formatBillingAmount(summary.total_payments_allocated, summary.currency)}</dd>
        </div>
        <div>
          <dt>Unallocated payments</dt>
          <dd>{formatBillingAmount(summary.unallocated_payments, summary.currency)}</dd>
        </div>
      </dl>
      <BillingChargesTable charges={billing.charges} />
      <BillingPaymentsTable payments={billing.payments} />
      <BillingAllocationsList charges={billing.charges} />
      <BillingRefundsList refunds={billing.refunds} />
    </DataSurface>
  );
}

function BillingChargesTable({ charges }) {
  if (!charges.length) {
    return <EmptyState title="No charges" description="No charges have been recorded for this student." />;
  }

  return (
    <div className="responsive-table">
      <table>
        <thead>
          <tr>
            <th>Charge</th>
            <th>Due</th>
            <th>Amount</th>
            <th>Allocated</th>
            <th>Balance</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {charges.map((charge) => (
            <tr key={charge.id}>
              <td>
                <div className="table-cell-stack">
                  <strong>{charge.description}</strong>
                  <span>{humanize(charge.charge_type)}</span>
                </div>
              </td>
              <td>{formatDate(charge.due_date)}</td>
              <td>{formatBillingAmount(charge.amount, charge.currency)}</td>
              <td>{formatBillingAmount(getChargeAllocatedTotal(charge), charge.currency)}</td>
              <td>{formatBillingAmount(getChargeBalance(charge), charge.currency)}</td>
              <td>
                <StatusBadge value={charge.status} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BillingPaymentsTable({ payments }) {
  if (!payments.length) {
    return <EmptyState title="No payments" description="No payments have been recorded for this student." />;
  }

  return (
    <div className="responsive-table">
      <table>
        <thead>
          <tr>
            <th>Payment</th>
            <th>Method</th>
            <th>Amount</th>
            <th>Allocated</th>
            <th>Unallocated</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {payments.map((payment) => (
            <tr key={payment.id}>
              <td>
                <div className="table-cell-stack">
                  <strong>{formatDate(payment.payment_date)}</strong>
                  <span>{payment.reference || "No reference"}</span>
                </div>
              </td>
              <td>{humanize(payment.payment_method)}</td>
              <td>{formatBillingAmount(payment.amount, payment.currency)}</td>
              <td>{formatBillingAmount(getPaymentAllocatedTotal(payment), payment.currency)}</td>
              <td>{formatBillingAmount(getPaymentUnallocatedBalance(payment), payment.currency)}</td>
              <td>
                <StatusBadge value={payment.status} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BillingAllocationsList({ charges }) {
  const allocations = charges.flatMap((charge) =>
    (charge.student_payment_allocations || []).map((allocation) => ({
      ...allocation,
      charge
    }))
  );

  if (!allocations.length) {
    return <EmptyState title="No allocations" description="Recorded payments have not been allocated to charges yet." />;
  }

  return (
    <div className="responsive-table">
      <table>
        <thead>
          <tr>
            <th>Charge</th>
            <th>Payment</th>
            <th>Allocated</th>
            <th>Notes</th>
          </tr>
        </thead>
        <tbody>
          {allocations.map((allocation) => (
            <tr key={allocation.id}>
              <td>{allocation.charge.description}</td>
              <td>{formatDate(allocation.student_payments?.payment_date)}</td>
              <td>{formatBillingAmount(allocation.amount, allocation.currency)}</td>
              <td>{allocation.notes || "No notes"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BillingRefundsList({ refunds }) {
  if (!refunds.length) {
    return null;
  }

  return (
    <div className="stack-list">
      {refunds.map((refund) => (
        <article className="list-card" key={refund.id}>
          <div className="list-card-header">
            <strong>{formatBillingAmount(refund.amount, refund.currency)}</strong>
            <StatusBadge value={refund.status} />
          </div>
          <span>{formatDate(refund.refund_date)} / {humanize(refund.refund_method)}</span>
          <span>{refund.reference || "No reference"}</span>
          {refund.notes ? <p>{refund.notes}</p> : null}
        </article>
      ))}
    </div>
  );
}

function ContactList({ contacts, title }) {
  if (!contacts.length) {
    return null;
  }

  return (
    <section className="contact-display-group">
      <h3>{title}</h3>
      <ul>
        {contacts.map((contact) => (
          <li key={contact.id}>
            <span>{contact.value}</span>
            <span>{contact.label || "Other"}</span>
            {contact.is_primary ? <span className="status-badge">Primary</span> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

function ProfileLoading() {
  return (
    <>
      <PageHeader eyebrow="Student profile" title="Loading student" />
      <div className="table-placeholder">Loading student profile...</div>
    </>
  );
}
