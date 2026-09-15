"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { DataSurface, MetricCard, ResponsiveTable, SurfaceHeader } from "@/components/Surface";
import { useAuth } from "@/components/AuthProvider";
import {
  createOfficeTodo,
  fetchOfficeTodos,
  fetchProfilesForStaff,
  fetchSchools,
  markOfficeTodoCompleted
} from "@/lib/data";
import { formatDate, formatDateTime, humanize } from "@/lib/format";
import {
  createOfficeTodoForm,
  notifyOfficeTodosUpdated,
  officeTodoStatuses,
  validateOfficeTodoForm
} from "@/lib/office-todos";
import { canManageOfficeTodos } from "@/lib/roles";
import { getSupabaseBrowserClient } from "@/lib/supabase";

export default function TodoPage() {
  const { profile, session } = useAuth();
  const mayManage = canManageOfficeTodos(profile);
  const [filters, setFilters] = useState({ search: "", status: "open" });
  const [form, setForm] = useState(() => createOfficeTodoForm());
  const [notice, setNotice] = useState("");
  const [actionId, setActionId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [state, setState] = useState({
    error: "",
    loading: true,
    profiles: [],
    schools: [],
    todos: []
  });

  const openCount = state.todos.filter((todo) => todo.status === "open").length;
  const selectedSchool = useMemo(
    () => state.schools.find((school) => school.id === form.schoolId) || null,
    [form.schoolId, state.schools]
  );

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(async () => {
      const supabase = getSupabaseBrowserClient();
      if (!supabase || !session || !mayManage) {
        setState({ error: "", loading: false, profiles: [], schools: [], todos: [] });
        return;
      }

      setState((current) => ({ ...current, loading: true }));
      const [todosResult, schoolsResult, profilesResult] = await Promise.all([
        fetchOfficeTodos(supabase, filters),
        fetchSchools(supabase),
        fetchProfilesForStaff(supabase)
      ]);
      if (!active) return;

      const loadError = [todosResult.error, schoolsResult.error, profilesResult.error]
        .filter(Boolean)
        .map((error) => error.message)
        .join(" ");

      setState({
        error: loadError,
        loading: false,
        profiles: profilesResult.data || [],
        schools: schoolsResult.data || [],
        todos: todosResult.data || []
      });
    }, 180);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [filters, mayManage, session]);

  async function reloadTodos() {
    const supabase = getSupabaseBrowserClient();
    if (!supabase || !session) return;
    const { data, error } = await fetchOfficeTodos(supabase, filters);
    setState((current) => ({
      ...current,
      error: error ? error.message : "",
      todos: data || []
    }));
  }

  function updateForm(field, value) {
    setForm((current) => {
      const next = { ...current, [field]: value };
      if (field === "schoolId") {
        const school = state.schools.find((row) => row.id === value);
        next.organizationId = school?.organization_id || "";
      }
      return next;
    });
  }

  async function handleCreateTodo(event) {
    event.preventDefault();
    setNotice("");

    const validationError = validateOfficeTodoForm(form);
    if (validationError) {
      setState((current) => ({ ...current, error: validationError }));
      return;
    }

    const supabase = getSupabaseBrowserClient();
    if (!supabase || !session) {
      setState((current) => ({ ...current, error: "You must be signed in before creating To Do items." }));
      return;
    }

    setSubmitting(true);
    const { error } = await createOfficeTodo(supabase, form);
    if (error) {
      setState((current) => ({ ...current, error: error.message }));
      setSubmitting(false);
      return;
    }

    setForm(createOfficeTodoForm());
    await reloadTodos();
    setNotice("To Do item created.");
    setSubmitting(false);
    notifyOfficeTodosUpdated();
  }

  async function handleComplete(todo) {
    const supabase = getSupabaseBrowserClient();
    if (!supabase || !session) {
      setState((current) => ({ ...current, error: "You must be signed in before completing To Do items." }));
      return;
    }

    setActionId(todo.id);
    setNotice("");
    const { error } = await markOfficeTodoCompleted(supabase, todo.id);
    if (error) {
      setState((current) => ({ ...current, error: error.message }));
      setActionId("");
      return;
    }

    await reloadTodos();
    setNotice("To Do item completed.");
    setActionId("");
    notifyOfficeTodosUpdated();
  }

  if (!mayManage) {
    return (
      <>
        <PageHeader eyebrow="Office workflow" title="To Do" />
        <DataSurface>
          <EmptyState title="To Do is not available" description="Your current role cannot manage office To Do items." />
        </DataSurface>
      </>
    );
  }

  return (
    <>
      <PageHeader eyebrow="Office workflow" title="To Do" description="Open staff tasks and financial document follow-ups." />

      {state.error ? <p className="inline-alert">{state.error}</p> : null}
      {notice ? <p className="inline-success">{notice}</p> : null}

      <div className="metric-grid">
        <MetricCard label="Outstanding" loading={state.loading} value={openCount} />
        <MetricCard label="Visible tasks" loading={state.loading} value={state.todos.length} />
        <MetricCard label="Schools" loading={state.loading} value={state.schools.length} />
      </div>

      <form className="student-form" onSubmit={handleCreateTodo}>
        <DataSurface>
          <SurfaceHeader>
            <h2>New To Do</h2>
          </SurfaceHeader>
          <div className="form-grid">
            <label>
              School
              <select onChange={(event) => updateForm("schoolId", event.target.value)} required value={form.schoolId}>
                <option value="">Select school</option>
                {state.schools.map((school) => (
                  <option key={school.id} value={school.id}>
                    {school.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Assigned staff
              <select onChange={(event) => updateForm("assignedProfileId", event.target.value)} value={form.assignedProfileId}>
                <option value="">Unassigned</option>
                {state.profiles.map((staffProfile) => (
                  <option key={staffProfile.id} value={staffProfile.id}>
                    {staffProfile.full_name || staffProfile.email}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Title
              <input onChange={(event) => updateForm("title", event.target.value)} required value={form.title} />
            </label>
            <label>
              Due date
              <input onChange={(event) => updateForm("dueDate", event.target.value)} type="date" value={form.dueDate} />
            </label>
          </div>
          <div className="form-grid single-column">
            <label>
              Description
              <textarea onChange={(event) => updateForm("description", event.target.value)} rows="3" value={form.description} />
            </label>
          </div>
        </DataSurface>
        <div className="form-actions">
          <span className="eyebrow">{selectedSchool?.organizations?.name || ""}</span>
          <button className="primary-button" disabled={submitting} type="submit">
            {submitting ? "Saving..." : "Add To Do"}
          </button>
        </div>
      </form>

      <DataSurface>
        <SurfaceHeader>
          <h2>Filters</h2>
        </SurfaceHeader>
        <div className="form-grid">
          <label>
            Search
            <input
              onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value }))}
              placeholder="Title, description, assignee"
              type="search"
              value={filters.search}
            />
          </label>
          <label>
            Status
            <select onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value }))} value={filters.status}>
              <option value="all">All statuses</option>
              {officeTodoStatuses.map((status) => (
                <option key={status.value} value={status.value}>
                  {status.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </DataSurface>

      <DataSurface aria-label="To Do list">
        <SurfaceHeader>
          <h2>Tasks</h2>
        </SurfaceHeader>
        {state.loading ? (
          <div className="table-placeholder">Loading To Do items...</div>
        ) : state.todos.length ? (
          <ResponsiveTable>
            <table>
              <thead>
                <tr>
                  <th>Due</th>
                  <th>Title</th>
                  <th>School</th>
                  <th>Assigned</th>
                  <th>Source</th>
                  <th>Status</th>
                  <th>Created</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {state.todos.map((todo) => (
                  <tr key={todo.id}>
                    <td>{todo.due_date ? formatDate(todo.due_date) : "No due date"}</td>
                    <td>{todo.title}</td>
                    <td>{todo.schools?.name || "Unknown school"}</td>
                    <td>{todo.assigned_profile?.full_name || todo.assigned_profile?.email || "Unassigned"}</td>
                    <td>{renderSource(todo)}</td>
                    <td>
                      <StatusBadge value={todo.status} />
                    </td>
                    <td>{formatDateTime(todo.created_at)}</td>
                    <td>
                      {todo.status === "open" ? (
                        <button
                          className="secondary-button"
                          disabled={actionId === todo.id}
                          onClick={() => handleComplete(todo)}
                          type="button"
                        >
                          {actionId === todo.id ? "Saving..." : "Complete"}
                        </button>
                      ) : (
                        "Done"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ResponsiveTable>
        ) : (
          <EmptyState title="No To Do items" description="Open tasks and financial document review items will appear here." />
        )}
      </DataSurface>
    </>
  );
}

function renderSource(todo) {
  if (todo.source_type === "financial_document" && todo.source_reference) {
    return <Link href={`/expenses/financial-docs/review/?id=${todo.source_reference}`}>Financial document</Link>;
  }

  return humanize(todo.source_type);
}
