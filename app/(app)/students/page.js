"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { DataSurface, ResponsiveTable } from "@/components/Surface";
import { useAuth } from "@/components/AuthProvider";
import { formatDate, formatEnrollment, formatPersonName } from "@/lib/format";
import { fetchStudents } from "@/lib/data";
import { canCreateStudents } from "@/lib/roles";
import { getSupabaseBrowserClient } from "@/lib/supabase";

export default function StudentsPage() {
  const { profile, session } = useAuth();
  const [search, setSearch] = useState("");
  const [state, setState] = useState({ loading: true, error: "", students: [] });

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
