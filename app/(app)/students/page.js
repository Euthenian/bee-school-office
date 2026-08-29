"use client";

import { useEffect, useState } from "react";
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
import { fetchStudents, sendAiEigoStudentInvitation } from "@/lib/data";
import { canCreateStudents, canManageAiEigoInvitations } from "@/lib/roles";
import { getSupabaseBrowserClient } from "@/lib/supabase";

export default function StudentsPage() {
  const { profile, session } = useAuth();
  const [search, setSearch] = useState("");
  const [state, setState] = useState({ loading: true, error: "", students: [] });
  const [notice, setNotice] = useState("");
  const [aiEigoActionStudentId, setAiEigoActionStudentId] = useState("");
  const mayManageAiEigo = canManageAiEigoInvitations(profile);

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(async () => {
      const supabase = getSupabaseBrowserClient();
      if (!supabase || !session) {
        setState({ loading: false, error: "", students: [] });
        return;
      }

      setState((current) => ({ ...current, loading: true }));
      const { data, error } = await fetchStudents(supabase, search);
      if (!active) return;

      setState({
        loading: false,
        error: error ? error.message : "",
        students: data || []
      });
    }, 180);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [search, session]);

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
    setNotice("AI-EIGO invitation queued for secure Gmail sending.");
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
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Name, preferred name, or status"
            type="search"
            value={search}
          />
        </label>
      </div>

      {state.error ? <p className="inline-alert">{state.error}</p> : null}
      {notice ? <p className="inline-success">{notice}</p> : null}

      <DataSurface aria-label="Students list">
        {state.loading ? (
          <div className="table-placeholder">Loading students...</div>
        ) : state.students.length ? (
          <ResponsiveTable>
            <table>
              <thead>
                <tr>
                  <th>Student</th>
                  <th>Status</th>
                  <th>School</th>
                  <th>Course / class</th>
                  <th>Start date</th>
                  {mayManageAiEigo ? <th>AI-EIGO</th> : null}
                </tr>
              </thead>
              <tbody>
                {state.students.map((student) => (
                  <tr key={student.id}>
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
