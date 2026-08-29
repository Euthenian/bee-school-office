"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";
import { QuestionDeleteDialog } from "@/components/QuestionDeleteDialog";
import { StatusBadge } from "@/components/StatusBadge";
import { DataSurface, ResponsiveTable } from "@/components/Surface";
import { useAuth } from "@/components/AuthProvider";
import {
  changeStudentQuestionDate,
  deleteStudentQuestion,
  fetchStudentQuestions,
  markStudentQuestionDone
} from "@/lib/data";
import { formatDate, formatPersonName } from "@/lib/format";
import { canManageStudentQuestions } from "@/lib/roles";
import {
  getStudentQuestionDisplayStatus,
  getTodayDateString,
  isStudentQuestionOverdue,
  notifyStudentQuestionsUpdated,
  removeStudentQuestionById,
  replaceStudentQuestionById,
  sortOpenStudentQuestions
} from "@/lib/student-questions";
import { getSupabaseBrowserClient } from "@/lib/supabase";

export default function QuestionsPage() {
  const { profile, session } = useAuth();
  const mayManage = canManageStudentQuestions(profile);
  const [state, setState] = useState({ loading: true, error: "", questions: [] });
  const [notice, setNotice] = useState("");
  const [actionId, setActionId] = useState("");
  const [dateTarget, setDateTarget] = useState(null);
  const [dateValue, setDateValue] = useState("");
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleteError, setDeleteError] = useState("");
  const today = getTodayDateString();

  useEffect(() => {
    let active = true;

    async function loadQuestions() {
      const supabase = getSupabaseBrowserClient();
      if (!supabase || !session || !mayManage) {
        setState({ loading: false, error: "", questions: [] });
        return;
      }

      setState((current) => ({ ...current, loading: true }));
      const { data, error } = await fetchStudentQuestions(supabase, { status: "open" });
      if (!active) return;

      setState({
        loading: false,
        error: error ? error.message : "",
        questions: sortOpenStudentQuestions(data || [])
      });
    }

    loadQuestions();

    return () => {
      active = false;
    };
  }, [mayManage, session]);

  async function handleMarkDone(question) {
    const supabase = getSupabaseBrowserClient();
    if (!supabase || !session) {
      setState((current) => ({ ...current, error: "You must be signed in before updating a question." }));
      return;
    }

    setActionId(question.id);
    setState((current) => ({ ...current, error: "" }));

    const { error } = await markStudentQuestionDone(supabase, question.id);

    if (error) {
      setState((current) => ({ ...current, error: error.message }));
      setActionId("");
      return;
    }

    setState((current) => ({
      ...current,
      questions: removeStudentQuestionById(current.questions, question.id)
    }));
    setActionId("");
    setNotice("Question marked done.");
    notifyStudentQuestionsUpdated();
  }

  function handleChangeDate(question) {
    setDateTarget(question);
    setDateValue(question.reminder_date || "");
  }

  async function handleSaveDate(event) {
    event.preventDefault();

    if (!dateTarget || !dateValue) return;

    const supabase = getSupabaseBrowserClient();
    if (!supabase || !session) {
      setState((current) => ({ ...current, error: "You must be signed in before updating a question." }));
      return;
    }

    setActionId(dateTarget.id);
    setState((current) => ({ ...current, error: "" }));

    const { data, error } = await changeStudentQuestionDate(supabase, dateTarget.id, dateValue);

    if (error) {
      setState((current) => ({ ...current, error: error.message }));
      setActionId("");
      return;
    }

    setState((current) => ({
      ...current,
      questions: replaceStudentQuestionById(current.questions, data)
    }));
    setActionId("");
    setDateTarget(null);
    setDateValue("");
    setNotice("Question date updated.");
    notifyStudentQuestionsUpdated();
  }

  function handleRequestDelete(question) {
    setDeleteError("");
    setDeleteTarget(question);
  }

  function handleCancelDelete() {
    if (actionId === deleteTarget?.id) return;

    setDeleteError("");
    setDeleteTarget(null);
  }

  async function handleConfirmDelete() {
    if (!deleteTarget) return;

    const supabase = getSupabaseBrowserClient();
    if (!supabase || !session) {
      setDeleteError("You must be signed in before deleting a question.");
      return;
    }

    setActionId(deleteTarget.id);
    setDeleteError("");
    setState((current) => ({ ...current, error: "" }));

    const { error } = await deleteStudentQuestion(supabase, deleteTarget.id);

    if (error) {
      setDeleteError(error.message);
      setActionId("");
      return;
    }

    setState((current) => ({
      ...current,
      questions: removeStudentQuestionById(current.questions, deleteTarget.id)
    }));
    setActionId("");
    setDeleteTarget(null);
    setNotice("Question deleted.");
    notifyStudentQuestionsUpdated();
  }

  if (!mayManage) {
    return (
      <>
        <PageHeader eyebrow="Student reminders" title="Questions" />
        <DataSurface>
          <EmptyState
            title="Questions are not available"
            description="Your current role can view assigned school records but cannot manage student questions."
          />
        </DataSurface>
      </>
    );
  }

  return (
    <>
      <PageHeader
        eyebrow="Student reminders"
        title="Questions"
        description="Open questions to ask students, including today's reminders and overdue follow-ups."
      />

      {state.error ? <p className="inline-alert">{state.error}</p> : null}
      {notice ? <p className="inline-success">{notice}</p> : null}

      {deleteTarget ? (
        <QuestionDeleteDialog
          deleting={actionId === deleteTarget.id}
          error={deleteError}
          onCancel={handleCancelDelete}
          onConfirm={handleConfirmDelete}
        />
      ) : null}

      <DataSurface aria-label="Student questions list">
        {state.loading ? (
          <div className="table-placeholder">Loading questions...</div>
        ) : state.questions.length ? (
          <ResponsiveTable>
            <table>
              <thead>
                <tr>
                  <th>Due date</th>
                  <th>Student</th>
                  <th>Question</th>
                  <th>School</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {state.questions.map((question) => (
                  <QuestionRow
                    actionId={actionId}
                    dateTarget={dateTarget}
                    dateValue={dateValue}
                    key={question.id}
                    onCancelDateChange={() => setDateTarget(null)}
                    onChangeDate={handleChangeDate}
                    onDateValueChange={setDateValue}
                    onDelete={handleRequestDelete}
                    onMarkDone={handleMarkDone}
                    onSaveDate={handleSaveDate}
                    question={question}
                    today={today}
                  />
                ))}
              </tbody>
            </table>
          </ResponsiveTable>
        ) : (
          <EmptyState title="No open questions" description="No visible student questions are open right now." />
        )}
      </DataSurface>
    </>
  );
}

function QuestionRow({
  actionId,
  dateTarget,
  dateValue,
  onCancelDateChange,
  onChangeDate,
  onDateValueChange,
  onDelete,
  onMarkDone,
  onSaveDate,
  question,
  today
}) {
  return (
    <tr className={isStudentQuestionOverdue(question, today) ? "overdue-row" : ""}>
      <td>{formatDate(question.reminder_date)}</td>
      <td>
        <Link href={`/students/profile/?id=${question.student_id}`}>{formatPersonName(question.students)}</Link>
      </td>
      <td>{question.question}</td>
      <td>{question.schools?.name || "Not assigned"}</td>
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
            <Link className="secondary-button" href={`/students/profile/?id=${question.student_id}`}>
              View student
            </Link>
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
  );
}
