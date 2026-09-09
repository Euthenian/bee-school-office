"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CommunicationComposer } from "@/components/CommunicationComposer";
import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { DataSurface, ResponsiveTable } from "@/components/Surface";
import { useAuth } from "@/components/AuthProvider";
import {
  buildTrialLessonCommunicationContext,
  getDefaultTrialLessonEmail,
  getDefaultTrialLessonPhone
} from "@/lib/communication-templates";
import { formatLessonTime, formatLessonType, formatTeacherName } from "@/lib/class-details";
import {
  confirmTrialLesson,
  convertTrialLessonParticipant,
  deleteTrialLesson,
  fetchPendingTrialBookingImportCount,
  fetchSchoolTeachers,
  fetchSchools,
  fetchTrialLessons,
  markTrialLessonPhoneFollowUpComplete
} from "@/lib/data";
import { formatDate, formatDateTime } from "@/lib/format";
import {
  buildTrialLessonColumnFilterOptions,
  defaultTrialLessonColumnFilters,
  defaultTrialLessonSort,
  filterAndSortTrialLessons,
  formatParticipantAgeGroup,
  formatParticipantName,
  formatProspectName,
  formatTrialLevel,
  getLocalDateKey,
  getPrimaryParticipant,
  hasActiveTrialLessonColumnFilters,
  hasActiveTrialLessonSort,
  removeTrialLessonById,
  resetTrialLessonTableFilters,
  trialLessonDateFilterPresets,
  trialLessonStatuses
} from "@/lib/trial-lessons";
import { canManageTrialLessons } from "@/lib/roles";
import { getSupabaseBrowserClient } from "@/lib/supabase";

export default function TrialLessonsPage() {
  const router = useRouter();
  const { profile, session } = useAuth();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [schoolFilter, setSchoolFilter] = useState("");
  const [teacherFilter, setTeacherFilter] = useState("");
  const [schools, setSchools] = useState([]);
  const [teachers, setTeachers] = useState([]);
  const [state, setState] = useState({ loading: true, error: "", trialLessons: [] });
  const [pendingState, setPendingState] = useState({ loading: true, count: 0 });
  const [actionNotice, setActionNotice] = useState("");
  const [communicatingTrialLesson, setCommunicatingTrialLesson] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleteError, setDeleteError] = useState("");
  const [confirmingId, setConfirmingId] = useState("");
  const [convertingId, setConvertingId] = useState("");
  const [deletingId, setDeletingId] = useState("");
  const [phoneFollowUpId, setPhoneFollowUpId] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [columnFilters, setColumnFilters] = useState(defaultTrialLessonColumnFilters);
  const [tableSort, setTableSort] = useState(defaultTrialLessonSort);
  const mayManage = canManageTrialLessons(profile);

  useEffect(() => {
    let active = true;

    async function loadSchools() {
      const supabase = getSupabaseBrowserClient();
      if (!supabase || !session) return;

      const { data, error } = await fetchSchools(supabase);
      if (!active) return;

      if (error) {
        setState((current) => ({ ...current, error: error.message }));
        setSchools([]);
      } else {
        setSchools(data || []);
      }
    }

    loadSchools();

    return () => {
      active = false;
    };
  }, [session]);

  useEffect(() => {
    let active = true;

    async function loadTeachers() {
      setTeachers([]);
      setTeacherFilter("");
      if (!schoolFilter || !session || !mayManage) return;

      const supabase = getSupabaseBrowserClient();
      if (!supabase) return;

      const { data } = await fetchSchoolTeachers(supabase, schoolFilter);
      if (active) {
        setTeachers(data || []);
      }
    }

    loadTeachers();

    return () => {
      active = false;
    };
  }, [mayManage, schoolFilter, session]);

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(async () => {
      const supabase = getSupabaseBrowserClient();
      if (!supabase || !session) {
        setState({ loading: false, error: "", trialLessons: [] });
        setPendingState({ loading: false, count: 0 });
        return;
      }

      setState((current) => ({ ...current, loading: true }));
      setPendingState((current) => ({ ...current, loading: true }));
      const filters = {
        search,
        schoolId: schoolFilter,
        teacherId: teacherFilter,
        scope: ["upcoming", "needs_follow_up"].includes(statusFilter) ? statusFilter : "",
        status: statusFilter !== "all" && !["upcoming", "needs_follow_up"].includes(statusFilter) ? statusFilter : ""
      };
      const [trialLessonsResult, pendingBookingsResult] = await Promise.all([
        fetchTrialLessons(supabase, filters),
        mayManage ? fetchPendingTrialBookingImportCount(supabase, { reviewStatus: "pending_review" }) : { count: 0, error: null }
      ]);
      if (!active) return;

      setState({
        loading: false,
        error: [trialLessonsResult.error, pendingBookingsResult.error]
          .filter(Boolean)
          .map((error) => error.message)
          .join(" "),
        trialLessons: trialLessonsResult.data || []
      });
      setPendingState({
        loading: false,
        count: pendingBookingsResult.count || 0
      });
    }, 180);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [mayManage, refreshKey, search, schoolFilter, session, statusFilter, teacherFilter]);

  const activeSchools = useMemo(() => schools.filter((school) => school.status === "active"), [schools]);
  const todayKey = useMemo(() => getLocalDateKey(), []);
  const columnFilterOptions = useMemo(
    () => buildTrialLessonColumnFilterOptions(state.trialLessons),
    [state.trialLessons]
  );
  const visibleTrialLessons = useMemo(
    () => filterAndSortTrialLessons(state.trialLessons, { columnFilters, sort: tableSort, today: todayKey }),
    [columnFilters, state.trialLessons, tableSort, todayKey]
  );
  const hasAnyFilters =
    Boolean(search.trim() || statusFilter !== "all" || schoolFilter || teacherFilter) ||
    hasActiveTrialLessonColumnFilters(columnFilters) ||
    hasActiveTrialLessonSort(tableSort);

  function updateColumnFilter(key, value) {
    setColumnFilters((current) => ({ ...current, [key]: value }));
  }

  function updateTableSort(column, direction) {
    setTableSort({ column, direction });
  }

  function clearAllFilters() {
    const reset = resetTrialLessonTableFilters();
    setSearch("");
    setStatusFilter("all");
    setSchoolFilter("");
    setTeacherFilter("");
    setColumnFilters(reset.columnFilters);
    setTableSort(reset.sort);
  }

  async function handleConvert(trialLessonId, participantId) {
    setConvertingId(participantId);
    setState((current) => ({ ...current, error: "" }));

    const supabase = getSupabaseBrowserClient();
    if (!supabase || !session) {
      setState((current) => ({ ...current, error: "You must be signed in before converting a trial lesson." }));
      setConvertingId("");
      return;
    }

    const { data: studentId, error } = await convertTrialLessonParticipant(supabase, trialLessonId, participantId);
    if (error) {
      setState((current) => ({ ...current, error: error.message }));
      setConvertingId("");
      return;
    }

    router.push(`/students/profile/?id=${studentId}`);
  }

  async function handleConfirm(trialLesson) {
    setConfirmingId(trialLesson.id);
    setActionNotice("");
    setState((current) => ({ ...current, error: "" }));

    const supabase = getSupabaseBrowserClient();
    if (!supabase || !session) {
      setState((current) => ({ ...current, error: "You must be signed in before confirming a trial lesson." }));
      setConfirmingId("");
      return;
    }

    const { error } = await confirmTrialLesson(supabase, {
      trialLessonId: trialLesson.id,
      trialDate: trialLesson.trial_date,
      trialTime: trialLesson.trial_time,
      assignedTeacherProfileId: trialLesson.assigned_teacher?.id || ""
    });

    if (error) {
      setState((current) => ({ ...current, error: error.message }));
      setConfirmingId("");
      return;
    }

    setActionNotice("Trial lesson confirmation queued and calendar action recorded.");
    setConfirmingId("");
    setRefreshKey((current) => current + 1);
  }

  async function handlePhoneFollowUpComplete(trialLesson) {
    setPhoneFollowUpId(trialLesson.id);
    setActionNotice("");
    setState((current) => ({ ...current, error: "" }));

    const supabase = getSupabaseBrowserClient();
    if (!supabase || !session) {
      setState((current) => ({ ...current, error: "You must be signed in before updating follow-up." }));
      setPhoneFollowUpId("");
      return;
    }

    const { error } = await markTrialLessonPhoneFollowUpComplete(supabase, trialLesson.id);

    if (error) {
      setState((current) => ({ ...current, error: error.message }));
      setPhoneFollowUpId("");
      return;
    }

    setActionNotice("Phone follow-up marked complete.");
    setPhoneFollowUpId("");
    setRefreshKey((current) => current + 1);
  }

  function handleDeleteRequest(trialLesson) {
    setActionNotice("");
    setDeleteError("");
    setDeleteTarget(trialLesson);
  }

  function handleDeleteCancel() {
    if (deletingId) return;

    setDeleteError("");
    setDeleteTarget(null);
  }

  async function handleDeleteConfirm() {
    if (!deleteTarget) return;

    setDeletingId(deleteTarget.id);
    setActionNotice("");
    setDeleteError("");
    setState((current) => ({ ...current, error: "" }));

    const supabase = getSupabaseBrowserClient();
    if (!supabase || !session) {
      setDeleteError("You must be signed in before deleting a trial lesson.");
      setDeletingId("");
      return;
    }

    const { error } = await deleteTrialLesson(supabase, deleteTarget.id);

    if (error) {
      setDeleteError(error.message);
      setDeletingId("");
      return;
    }

    setState((current) => ({
      ...current,
      trialLessons: removeTrialLessonById(current.trialLessons, deleteTarget.id)
    }));
    setActionNotice("Trial lesson deleted.");
    setDeleteTarget(null);
    setDeletingId("");
  }

  function handleEmailSent() {
    setCommunicatingTrialLesson(null);
    setActionNotice("Email queued for secure sending.");
    setRefreshKey((current) => current + 1);
  }

  return (
    <>
      <PageHeader
        eyebrow="Trial lesson management"
        title="Trial Lessons"
        description="Manage prospects, trial bookings, and conversion history without creating students before they join."
        actions={
          mayManage ? (
            <div className="form-actions">
              <Link className="secondary-button" href="/trial-lessons/imports/">
                Pending bookings {pendingState.loading ? "..." : pendingState.count}
              </Link>
              <Link className="primary-button" href="/trial-lessons/new/">
                Add trial lesson
              </Link>
            </div>
          ) : null
        }
      />

      {mayManage ? (
        <DataSurface className="pending-bookings-banner" aria-label="Pending imported bookings">
          <div>
            <p className="eyebrow">Pending bookings</p>
            <strong>{pendingState.loading ? "..." : pendingState.count}</strong>
            <span>Gmail Trial Booking imports waiting for staff review.</span>
          </div>
          <Link className="secondary-button" href="/trial-lessons/imports/">
            Review pending bookings
          </Link>
        </DataSurface>
      ) : null}

      <div className="toolbar">
        <label className="search-field">
          <span>Search trial lessons</span>
          <input
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Name, teacher, or school"
            type="search"
            value={search}
          />
        </label>
        <label className="search-field">
          <span>Filter</span>
          <select onChange={(event) => setStatusFilter(event.target.value)} value={statusFilter}>
            <option value="all">All trial lessons</option>
            <option value="upcoming">Upcoming</option>
            <option value="needs_follow_up">Needs follow-up</option>
            {trialLessonStatuses.map((status) => (
              <option key={status.value} value={status.value}>
                {status.label}
              </option>
            ))}
          </select>
        </label>
        <label className="search-field">
          <span>School</span>
          <select onChange={(event) => setSchoolFilter(event.target.value)} value={schoolFilter}>
            <option value="">All schools</option>
            {activeSchools.map((school) => (
              <option key={school.id} value={school.id}>
                {school.name}
              </option>
            ))}
          </select>
        </label>
        <label className="search-field">
          <span>Teacher</span>
          <select disabled={!schoolFilter || !mayManage} onChange={(event) => setTeacherFilter(event.target.value)} value={teacherFilter}>
            <option value="">All teachers</option>
            {teachers.map((teacher) => (
              <option key={teacher.profile_id} value={teacher.profile_id}>
                {teacher.full_name || teacher.email}
              </option>
            ))}
          </select>
        </label>
        <div className="toolbar-filter-actions">
          {hasAnyFilters ? (
            <button className="ghost-button" onClick={clearAllFilters} type="button">
              Clear all filters
            </button>
          ) : null}
        </div>
      </div>

      {state.error ? <p className="inline-alert">{state.error}</p> : null}
      {actionNotice ? <p className="inline-success">{actionNotice}</p> : null}

      {communicatingTrialLesson ? (
        <CommunicationComposer
          context={{
            defaultMessageType:
              communicatingTrialLesson.status === "no_show" ? "no_show_follow_up" : "trial_lesson_confirmation",
            defaultRecipient: getDefaultTrialLessonEmail(communicatingTrialLesson),
            organizationId: communicatingTrialLesson.organization_id,
            prospectId: communicatingTrialLesson.prospects?.id,
            schoolId: communicatingTrialLesson.school_id,
            templateContext: buildTrialLessonCommunicationContext(communicatingTrialLesson),
            trialLessonId: communicatingTrialLesson.id
          }}
          onCancel={() => setCommunicatingTrialLesson(null)}
          onSent={handleEmailSent}
        />
      ) : null}

      {deleteTarget ? (
        <DeleteTrialLessonDialog
          deleting={deletingId === deleteTarget.id}
          error={deleteError}
          onCancel={handleDeleteCancel}
          onConfirm={handleDeleteConfirm}
        />
      ) : null}

      <DataSurface aria-label="Trial lessons list" className="trial-lessons-surface">
        {state.loading ? (
          <div className="table-placeholder">Loading trial lessons...</div>
        ) : visibleTrialLessons.length ? (
          <ResponsiveTable>
            <table>
              <thead>
                <tr>
                  <ColumnFilterHeader
                    active={columnFilters.datePreset !== defaultTrialLessonColumnFilters.datePreset || tableSort.column === "trial_date"}
                    column="trial_date"
                    label="Trial date"
                    onSortChange={updateTableSort}
                    sort={tableSort}
                    sortLabels={{ asc: "Oldest first", desc: "Newest first" }}
                  >
                    <label>
                      <span>Filter</span>
                      <select onChange={(event) => updateColumnFilter("datePreset", event.target.value)} value={columnFilters.datePreset}>
                        {trialLessonDateFilterPresets.map((preset) => (
                          <option key={preset.value} value={preset.value}>
                            {preset.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    {columnFilters.datePreset === "custom" ? (
                      <div className="column-filter-menu-grid">
                        <label>
                          <span>From</span>
                          <input onChange={(event) => updateColumnFilter("dateFrom", event.target.value)} type="date" value={columnFilters.dateFrom} />
                        </label>
                        <label>
                          <span>To</span>
                          <input onChange={(event) => updateColumnFilter("dateTo", event.target.value)} type="date" value={columnFilters.dateTo} />
                        </label>
                      </div>
                    ) : null}
                  </ColumnFilterHeader>
                  <ColumnFilterHeader
                    active={columnFilters.time !== defaultTrialLessonColumnFilters.time || tableSort.column === "trial_time"}
                    column="trial_time"
                    label="Trial time"
                    onSortChange={updateTableSort}
                    sort={tableSort}
                    sortLabels={{ asc: "Earliest first", desc: "Latest first" }}
                  >
                    <OptionColumnFilter
                      label="Filter"
                      onChange={(value) => updateColumnFilter("time", value)}
                      options={columnFilterOptions.times}
                      value={columnFilters.time}
                    />
                  </ColumnFilterHeader>
                  <ColumnFilterHeader
                    active={Boolean(columnFilters.nameSearch.trim()) || tableSort.column === "name"}
                    column="name"
                    label="Prospect / student name"
                    onSortChange={updateTableSort}
                    sort={tableSort}
                    sortLabels={{ asc: "A-Z", desc: "Z-A" }}
                  >
                    <label>
                      <span>Contains</span>
                      <input
                        onChange={(event) => updateColumnFilter("nameSearch", event.target.value)}
                        type="search"
                        value={columnFilters.nameSearch}
                      />
                    </label>
                  </ColumnFilterHeader>
                  <ColumnFilterHeader
                    active={columnFilters.ageGroup !== defaultTrialLessonColumnFilters.ageGroup || tableSort.column === "age_group"}
                    column="age_group"
                    label="Age group"
                    onSortChange={updateTableSort}
                    sort={tableSort}
                  >
                    <OptionColumnFilter
                      label="Filter"
                      onChange={(value) => updateColumnFilter("ageGroup", value)}
                      options={columnFilterOptions.ageGroups}
                      value={columnFilters.ageGroup}
                    />
                  </ColumnFilterHeader>
                  <ColumnFilterHeader
                    active={columnFilters.level !== defaultTrialLessonColumnFilters.level || tableSort.column === "level"}
                    column="level"
                    label="Course / level"
                    onSortChange={updateTableSort}
                    sort={tableSort}
                  >
                    <OptionColumnFilter
                      label="Filter"
                      onChange={(value) => updateColumnFilter("level", value)}
                      options={columnFilterOptions.levels}
                      value={columnFilters.level}
                    />
                  </ColumnFilterHeader>
                  <ColumnFilterHeader
                    active={columnFilters.lessonType !== defaultTrialLessonColumnFilters.lessonType || tableSort.column === "lesson_type"}
                    column="lesson_type"
                    label="Lesson type"
                    onSortChange={updateTableSort}
                    sort={tableSort}
                  >
                    <OptionColumnFilter
                      label="Filter"
                      onChange={(value) => updateColumnFilter("lessonType", value)}
                      options={columnFilterOptions.lessonTypes}
                      value={columnFilters.lessonType}
                    />
                  </ColumnFilterHeader>
                  <ColumnFilterHeader
                    active={columnFilters.teacher !== defaultTrialLessonColumnFilters.teacher || tableSort.column === "teacher"}
                    column="teacher"
                    label="Assigned teacher"
                    onSortChange={updateTableSort}
                    sort={tableSort}
                  >
                    <OptionColumnFilter
                      label="Filter"
                      onChange={(value) => updateColumnFilter("teacher", value)}
                      options={columnFilterOptions.teachers}
                      value={columnFilters.teacher}
                    />
                  </ColumnFilterHeader>
                  <ColumnFilterHeader
                    active={columnFilters.inquirySource !== defaultTrialLessonColumnFilters.inquirySource || tableSort.column === "inquiry_source"}
                    column="inquiry_source"
                    label="Inquiry source"
                    onSortChange={updateTableSort}
                    sort={tableSort}
                  >
                    <OptionColumnFilter
                      label="Filter"
                      onChange={(value) => updateColumnFilter("inquirySource", value)}
                      options={columnFilterOptions.inquirySources}
                      value={columnFilters.inquirySource}
                    />
                  </ColumnFilterHeader>
                  <ColumnFilterHeader
                    active={columnFilters.status !== defaultTrialLessonColumnFilters.status || tableSort.column === "status"}
                    column="status"
                    label="Status"
                    onSortChange={updateTableSort}
                    sort={tableSort}
                  >
                    <OptionColumnFilter
                      label="Filter"
                      onChange={(value) => updateColumnFilter("status", value)}
                      options={columnFilterOptions.statuses}
                      value={columnFilters.status}
                    />
                  </ColumnFilterHeader>
                  {mayManage ? <th>Actions</th> : null}
                </tr>
              </thead>
              <tbody>
                {visibleTrialLessons.map((trialLesson) => (
                  <TrialLessonRow
                    confirmingId={confirmingId}
                    convertingId={convertingId}
                    key={trialLesson.id}
                    mayManage={mayManage}
                    onConfirm={handleConfirm}
                    onConvert={handleConvert}
                    onRequestDelete={handleDeleteRequest}
                    onOpenComposer={setCommunicatingTrialLesson}
                    onPhoneFollowUpComplete={handlePhoneFollowUpComplete}
                    phoneFollowUpId={phoneFollowUpId}
                    trialLesson={trialLesson}
                  />
                ))}
              </tbody>
            </table>
          </ResponsiveTable>
        ) : (
          <EmptyState title="No trial lessons found" description="No readable trial lessons matched the current filters." />
        )}
      </DataSurface>
    </>
  );
}

function ColumnFilterHeader({ active, children, column, label, onSortChange, sort, sortLabels = { asc: "A-Z", desc: "Z-A" } }) {
  const sortValue = sort.column === column ? sort.direction : "";

  function handleSortChange(event) {
    const direction = event.target.value;
    if (!direction) {
      onSortChange(defaultTrialLessonSort.column, defaultTrialLessonSort.direction);
      return;
    }

    onSortChange(column, direction);
  }

  return (
    <th>
      <details className={`table-header-filter${active ? " active" : ""}`}>
        <summary className="column-filter-summary">
          <span>{label}</span>
          <span aria-hidden="true" className="column-filter-arrow">
            v
          </span>
        </summary>
        <div className="column-filter-menu">
          <label>
            <span>Sort</span>
            <select aria-label={`Sort ${label}`} onChange={handleSortChange} value={sortValue}>
              <option value="">No sort</option>
              <option value="asc">{sortLabels.asc}</option>
              <option value="desc">{sortLabels.desc}</option>
            </select>
          </label>
          {children}
        </div>
      </details>
    </th>
  );
}

function OptionColumnFilter({ label, onChange, options, value }) {
  return (
    <label>
      <span>{label}</span>
      <select onChange={(event) => onChange(event.target.value)} value={value}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function TrialLessonRow({
  confirmingId,
  convertingId,
  mayManage,
  onConfirm,
  onConvert,
  onOpenComposer,
  onPhoneFollowUpComplete,
  onRequestDelete,
  phoneFollowUpId,
  trialLesson
}) {
  const participant = getPrimaryParticipant(trialLesson);
  const prospect = trialLesson.prospects;
  const conversionParticipants = trialLesson.trial_lesson_participants?.filter((item) => !item.converted_student_id) || [];
  const convertedParticipant = trialLesson.trial_lesson_participants?.find((item) => item.converted_student_id);
  const linkedStudentId = trialLesson.converted_student_id || convertedParticipant?.converted_student_id;
  const prospectEmail = getDefaultTrialLessonEmail(trialLesson);
  const prospectPhone = getDefaultTrialLessonPhone(trialLesson);
  const needsPhoneFollowUp =
    trialLesson.status === "no_show" && !trialLesson.phone_follow_up_completed_at && trialLesson.follow_up_state !== "resolved";
  const canConfirm =
    !linkedStudentId && !["joined", "cancelled", "did_not_join"].includes(trialLesson.status) && trialLesson.trial_date && trialLesson.trial_time;

  return (
    <tr>
      <td>{formatDate(trialLesson.trial_date)}</td>
      <td>{formatLessonTime(trialLesson.trial_time)}</td>
      <td>
        <div className="table-cell-stack">
          <strong>{formatProspectName(prospect)}</strong>
          <span>{participant ? formatParticipantName(participant) : "No participant"}</span>
          <span>{[prospectEmail || "No email", prospectPhone || "No phone"].join(" / ")}</span>
        </div>
      </td>
      <td>{participant ? formatParticipantAgeGroup(participant) : "Not set"}</td>
      <td>{participant?.requested_level?.label || formatTrialLevel(trialLesson)}</td>
      <td>{formatLessonType(trialLesson.lesson_type)}</td>
      <td>{formatTeacherName(trialLesson.assigned_teacher)}</td>
      <td>{[prospect?.inquiry_methods?.label, prospect?.acquisition_sources?.label].filter(Boolean).join(" / ") || "Not set"}</td>
      <td>
        <StatusBadge value={trialLesson.status || "unresolved"} />
        {trialLesson.status === "no_show" ? <FollowUpStatus trialLesson={trialLesson} /> : null}
      </td>
      {mayManage ? (
        <td>
          <div className="table-actions">
            {linkedStudentId ? (
              <Link className="primary-button" href={`/students/profile/?id=${linkedStudentId}`}>
                View student
              </Link>
            ) : (
              conversionParticipants.map((item) => (
                <button
                  className="convert-button"
                  disabled={Boolean(convertingId)}
                  key={item.id}
                  onClick={() => onConvert(trialLesson.id, item.id)}
                  type="button"
                >
                  {convertingId === item.id ? "Converting..." : `Convert ${item.japanese_name}`}
                </button>
              ))
            )}
            {canConfirm ? (
              <button
                className="secondary-button"
                disabled={confirmingId === trialLesson.id}
                onClick={() => onConfirm(trialLesson)}
                type="button"
              >
                {confirmingId === trialLesson.id ? "Confirming..." : "Confirm trial lesson"}
              </button>
            ) : null}
            <button className="secondary-button" disabled={!prospectEmail} onClick={() => onOpenComposer(trialLesson)} type="button">
              Send email
            </button>
            {needsPhoneFollowUp ? (
              <button
                className="ghost-button"
                disabled={phoneFollowUpId === trialLesson.id}
                onClick={() => onPhoneFollowUpComplete(trialLesson)}
                type="button"
              >
                {phoneFollowUpId === trialLesson.id ? "Saving..." : "Mark phone follow-up complete"}
              </button>
            ) : null}
            <button className="danger-button" onClick={() => onRequestDelete(trialLesson)} type="button">
              Delete
            </button>
          </div>
        </td>
      ) : null}
    </tr>
  );
}

function DeleteTrialLessonDialog({ deleting, error, onCancel, onConfirm }) {
  return (
    <div className="modal-backdrop" role="presentation">
      <section
        aria-describedby="delete-trial-lesson-description"
        aria-labelledby="delete-trial-lesson-title"
        aria-modal="true"
        className="communication-modal confirmation-modal"
        role="dialog"
      >
        <header className="communication-modal-header">
          <h2 id="delete-trial-lesson-title">Delete this trial lesson?</h2>
        </header>
        <div className="confirmation-modal-body">
          <p id="delete-trial-lesson-description">This action cannot be undone.</p>
          {error ? <p className="inline-alert">{error}</p> : null}
        </div>
        <div className="form-actions confirmation-modal-actions">
          <button className="secondary-button" disabled={deleting} onClick={onCancel} type="button">
            Cancel
          </button>
          <button className="danger-button" disabled={deleting} onClick={onConfirm} type="button">
            {deleting ? "Deleting..." : "Delete trial lesson"}
          </button>
        </div>
      </section>
    </div>
  );
}

function FollowUpStatus({ trialLesson }) {
  return (
    <div className="follow-up-lines">
      <span>{formatAutomatedEmailStatus(trialLesson)}</span>
      <span>
        Phone:{" "}
        {trialLesson.phone_follow_up_completed_at
          ? `Complete ${formatDateTime(trialLesson.phone_follow_up_completed_at)}`
          : "Needs follow-up"}
      </span>
    </div>
  );
}

function formatAutomatedEmailStatus(trialLesson) {
  if (trialLesson.automated_follow_up_sent_at) {
    return `Auto email: Sent ${formatDateTime(trialLesson.automated_follow_up_sent_at)}`;
  }

  if (trialLesson.follow_up_state === "automated_email_queued") {
    return "Auto email: Queued";
  }

  if (trialLesson.follow_up_state === "automated_email_failed") {
    return "Auto email: Failed";
  }

  if (trialLesson.follow_up_due_at) {
    return `Auto email due: ${formatDateTime(trialLesson.follow_up_due_at)}`;
  }

  return "Auto email: Not scheduled";
}
