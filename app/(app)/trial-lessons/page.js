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
  buildCommunicationDraft,
  communicationMessageTypes,
  buildTrialLessonCommunicationContext,
  getDefaultTrialLessonEmail,
  getDefaultTrialLessonPhone
} from "@/lib/communication-templates";
import { formatLessonTime, formatLessonType, formatTeacherName } from "@/lib/class-details";
import {
  confirmTrialLesson,
  convertTrialLessonParticipant,
  queueCommunication,
  deleteTrialLessons,
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
  const [bulkCommunicatingTrialLessons, setBulkCommunicatingTrialLessons] = useState([]);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleteError, setDeleteError] = useState("");
  const [confirmingId, setConfirmingId] = useState("");
  const [convertingId, setConvertingId] = useState("");
  const [deletingId, setDeletingId] = useState("");
  const [isDeletingBulk, setIsDeletingBulk] = useState(false);
  const [deletingIds, setDeletingIds] = useState([]);
  const [phoneFollowUpId, setPhoneFollowUpId] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [columnFilters, setColumnFilters] = useState(defaultTrialLessonColumnFilters);
  const [tableSort, setTableSort] = useState(defaultTrialLessonSort);
  const [selectedTrialLessonIds, setSelectedTrialLessonIds] = useState(() => new Set());
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
  const availableTrialLessonIds = useMemo(() => new Set(state.trialLessons.map((trialLesson) => trialLesson.id)), [state.trialLessons]);
  const columnFilterOptions = useMemo(
    () => buildTrialLessonColumnFilterOptions(state.trialLessons),
    [state.trialLessons]
  );
  const visibleTrialLessons = useMemo(
    () => filterAndSortTrialLessons(state.trialLessons, { columnFilters, sort: tableSort, today: todayKey }),
    [columnFilters, state.trialLessons, tableSort, todayKey]
  );
  const validSelectedTrialLessonIds = useMemo(() => {
    const next = new Set();
    for (const selectedTrialLessonId of selectedTrialLessonIds) {
      if (availableTrialLessonIds.has(selectedTrialLessonId)) {
        next.add(selectedTrialLessonId);
      }
    }

    return next;
  }, [availableTrialLessonIds, selectedTrialLessonIds]);
  const selectedTrialLessons = useMemo(
    () => state.trialLessons.filter((trialLesson) => validSelectedTrialLessonIds.has(trialLesson.id)),
    [state.trialLessons, validSelectedTrialLessonIds]
  );
  const selectedTrialLessonCount = validSelectedTrialLessonIds.size;
  const visibleSelectedTrialLessonCount = visibleTrialLessons.filter((trialLesson) => validSelectedTrialLessonIds.has(trialLesson.id)).length;
  const allVisibleSelected =
    Boolean(visibleTrialLessons.length) && visibleSelectedTrialLessonCount === visibleTrialLessons.length;
  const hasAnyFilters =
    Boolean(search.trim() || statusFilter !== "all" || schoolFilter || teacherFilter) ||
    hasActiveTrialLessonColumnFilters(columnFilters) ||
    hasActiveTrialLessonSort(tableSort);

  function getBulkEmailDefaultMessageType() {
    return selectedTrialLessons.length && selectedTrialLessons.every((trialLesson) => trialLesson.status === "no_show")
      ? "no_show_follow_up"
      : "trial_lesson_confirmation";
  }

  function setTrialLessonSelection(trialLessonId, shouldSelect) {
    setSelectedTrialLessonIds((current) => {
      const next = new Set(current);
      if (shouldSelect) {
        next.add(trialLessonId);
      } else {
        next.delete(trialLessonId);
      }

      return next;
    });
  }

  function toggleSelectAllVisible() {
    setSelectedTrialLessonIds((current) => {
      const next = new Set(current);
      if (allVisibleSelected) {
        for (const lesson of visibleTrialLessons) {
          next.delete(lesson.id);
        }
      } else {
        for (const lesson of visibleTrialLessons) {
          next.add(lesson.id);
        }
      }

      return next;
    });
  }

  function clearTrialLessonSelection() {
    setSelectedTrialLessonIds(new Set());
  }

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

  function handleBulkDeleteRequest() {
    setActionNotice("");
    setDeleteError("");
    setDeletingIds(Array.from(validSelectedTrialLessonIds));
    setDeleteTarget(null);
    setIsDeletingBulk(false);
  }

  function clearBulkDeleteState() {
    setDeletingIds([]);
    setDeleteError("");
    setIsDeletingBulk(false);
  }

  function handleDeleteCancel() {
    if (deletingId || isDeletingBulk) return;

    setDeleteError("");
    setDeleteTarget(null);
    clearBulkDeleteState();
  }

  async function handleDeleteConfirm() {
    if (deleteTarget) {
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
      return;
    }

    if (!deletingIds.length) return;

    const ids = [...deletingIds];
    setDeletingIds(ids);
    setIsDeletingBulk(true);
    const deletableIds = state.trialLessons
      .filter((trialLesson) => ids.includes(trialLesson.id))
      .map((trialLesson) => trialLesson.id);
    if (!deletableIds.length) {
      clearBulkDeleteState();
      return;
    }

    setActionNotice("");
    setDeleteError("");
    setState((current) => ({ ...current, error: "" }));
    setDeletingIds(ids);

    const supabase = getSupabaseBrowserClient();
    if (!supabase || !session) {
      setDeleteError("You must be signed in before deleting trial lessons.");
      clearBulkDeleteState();
      return;
    }

    const { error } = await deleteTrialLessons(supabase, deletableIds);
    if (error) {
      setDeleteError(error.message);
      clearBulkDeleteState();
      return;
    }

    setState((current) => ({
      ...current,
      trialLessons: current.trialLessons.filter((trialLesson) => !deletableIds.includes(trialLesson.id))
    }));
    setActionNotice(`${deletableIds.length} trial lessons deleted.`);
    clearTrialLessonSelection();
    clearBulkDeleteState();
  }

  function handleBulkEmailOpen() {
    setActionNotice("");
    setBulkCommunicatingTrialLessons(selectedTrialLessons);
  }

  function handleBulkEmailSent(sentSummary = { sentCount: 0, skippedCount: 0, total: 0 }) {
    setBulkCommunicatingTrialLessons([]);
    const { sentCount = 0, skippedCount = 0 } = sentSummary;
    const suffix = sentCount === 1 ? "" : "s";
    setActionNotice(
      `${sentCount} email${suffix} queued for secure sending.${skippedCount ? ` ${skippedCount} recipient(s) skipped (no valid email).` : ""}`
    );
    setRefreshKey((current) => current + 1);
    clearTrialLessonSelection();
  }

  function handleBulkEmailCancel() {
    setBulkCommunicatingTrialLessons([]);
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

      {selectedTrialLessonCount > 0 && mayManage ? (
        <div className="trial-lesson-selection-bar">
          <p>
            <strong>{selectedTrialLessonCount}</strong> selected
          </p>
          <div className="trial-lesson-selection-actions">
            <button className="primary-button" onClick={handleBulkEmailOpen} type="button">
              Send email
            </button>
            <button className="danger-button" onClick={handleBulkDeleteRequest} type="button">
              Delete {selectedTrialLessonCount}
            </button>
            <button className="ghost-button" onClick={clearTrialLessonSelection} type="button">
              Clear selection
            </button>
          </div>
        </div>
      ) : null}

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

      {bulkCommunicatingTrialLessons.length ? (
        <BulkCommunicationComposer
          isSignedIn={Boolean(session)}
          defaultMessageType={getBulkEmailDefaultMessageType()}
          onCancel={handleBulkEmailCancel}
          onSent={handleBulkEmailSent}
          trialLessons={bulkCommunicatingTrialLessons}
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
      {deletingIds.length ? (
        <BulkDeleteTrialLessonDialog
          deleting={isDeletingBulk}
          deleteCount={deletingIds.length}
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
                  {mayManage ? (
                    <th className="selection-column trial-lesson-select-header">
                      <input
                        aria-label="Select all visible trial lessons"
                        checked={allVisibleSelected}
                        disabled={visibleTrialLessons.length === 0}
                        onChange={toggleSelectAllVisible}
                        type="checkbox"
                      />
                    </th>
                  ) : null}
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
                    isSelected={validSelectedTrialLessonIds.has(trialLesson.id)}
                    confirmingId={confirmingId}
                    convertingId={convertingId}
                    key={trialLesson.id}
                    mayManage={mayManage}
                    onConfirm={handleConfirm}
                    onConvert={handleConvert}
                    onSelectionChange={setTrialLessonSelection}
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

const trialLessonEmailPattern = /^[^@\s,<>]+@[^@\s,<>]+\.[^@\s,<>]+$/;

function isValidTrialLessonEmail(value) {
  return trialLessonEmailPattern.test(String(value || "").trim());
}

function BulkCommunicationComposer({ defaultMessageType, isSignedIn, onCancel, onSent, trialLessons }) {
  const [state, setState] = useState({ error: "", sending: false });
  const [form, setForm] = useState(() => {
    const context = buildTrialLessonCommunicationContext(trialLessons[0]);
    const draft = buildCommunicationDraft(defaultMessageType || "trial_lesson_confirmation", context);

    return {
      body: draft.body,
      messageType: defaultMessageType || "trial_lesson_confirmation",
      subject: draft.subject,
      subjectTouched: false,
      bodyTouched: false
    };
  });

  const recipients = useMemo(
    () =>
      trialLessons.map((trialLesson) => {
        const email = getDefaultTrialLessonEmail(trialLesson);
        return {
          context: buildTrialLessonCommunicationContext(trialLesson),
          email,
          trialLessonId: trialLesson.id,
          prospectId: trialLesson.prospects?.id || "",
          schoolId: trialLesson.school_id,
          organizationId: trialLesson.organization_id,
          validEmail: isValidTrialLessonEmail(email)
        };
      }),
    [trialLessons]
  );

  const sendableRecipients = useMemo(() => recipients.filter((item) => item.validEmail), [recipients]);
  const skippedRecipientCount = recipients.length - sendableRecipients.length;

  function updateField(field, value) {
    setForm((current) => ({
      ...current,
      [field]: value,
      ...(field === "subject" ? { subjectTouched: true } : {}),
      ...(field === "body" ? { bodyTouched: true } : {})
    }));
  }

  function updateMessageType(value) {
    const context = buildTrialLessonCommunicationContext(trialLessons[0]);
    const draft = buildCommunicationDraft(value, context);

    setForm({
      body: draft.body,
      messageType: value,
      subject: draft.subject,
      subjectTouched: false,
      bodyTouched: false
    });
  }

  function getDraftForRecipient(recipient) {
    const rendered = buildCommunicationDraft(form.messageType, recipient.context);
    return {
      body: form.bodyTouched ? form.body : rendered.body,
      subject: form.subjectTouched ? form.subject : rendered.subject,
      templateKey: rendered.templateKey
    };
  }

  async function handleSubmit(event) {
    event.preventDefault();

    setState({ error: "", sending: true });

    const supabase = getSupabaseBrowserClient();
    if (!supabase || !isSignedIn) {
      setState({ error: "You must be signed in before sending email.", sending: false });
      return;
    }

    for (const recipient of sendableRecipients) {
      const draft = getDraftForRecipient(recipient);
      const { error } = await queueCommunication(supabase, {
        channel: "email",
        communicationType: form.messageType,
        organizationId: recipient.organizationId,
        prospectId: recipient.prospectId,
        recipient: recipient.email,
        schoolId: recipient.schoolId,
        subject: draft.subject,
        body: draft.body,
        templateKey: draft.templateKey,
        trialLessonId: recipient.trialLessonId
      });

      if (error) {
        setState({ error: error.message, sending: false });
        return;
      }
    }

    onSent({ sentCount: sendableRecipients.length, skippedCount: skippedRecipientCount, total: recipients.length });
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <section aria-labelledby="bulk-communications-title" aria-modal="true" className="communication-modal" role="dialog">
        <header className="communication-modal-header">
          <div>
            <p className="eyebrow">Communication</p>
            <h2 id="bulk-communications-title">Send bulk email</h2>
          </div>
          <button className="ghost-button" onClick={onCancel} type="button">
            Cancel
          </button>
        </header>
        <div className="communication-form-grid single-column communication-form-grid">
          <p className="eyebrow" id="bulk-communications-selection-summary">
            {trialLessons.length} selected
          </p>
          <p className="eyebrow">{sendableRecipients.length} sendable</p>
          <p className="eyebrow">
            {skippedRecipientCount} skipped — no valid email
          </p>
        </div>
        <form className="student-form" onSubmit={handleSubmit}>
          {state.error ? <p className="inline-alert">{state.error}</p> : null}

          <div className="form-grid single-column communication-form-grid">
            <label>
              <span>Message type</span>
              <select onChange={(event) => updateMessageType(event.target.value)} value={form.messageType}>
                {communicationMessageTypes.map((type) => (
                  <option key={type.value} value={type.value}>
                    {type.label}
                  </option>
                ))}
              </select>
            </label>

            <label>
              <span>Subject</span>
              <input onChange={(event) => updateField("subject", event.target.value)} required type="text" value={form.subject} />
            </label>

            <label>
              <span>Message body</span>
              <textarea onChange={(event) => updateField("body", event.target.value)} required value={form.body} />
            </label>
          </div>

          <div className="form-actions communication-form-actions">
            <button className="secondary-button" onClick={onCancel} type="button">
              Cancel
            </button>
            <button className="primary-button" disabled={state.sending} type="submit">
              {state.sending ? "Sending..." : "Send"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

function TrialLessonRow({
  confirmingId,
  convertingId,
  mayManage,
  isSelected,
  onConfirm,
  onConvert,
  onSelectionChange,
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
      {mayManage ? (
        <td className="selection-cell trial-lesson-select-cell">
          <input
            aria-label={`Select trial lesson ${trialLesson.id}`}
            checked={Boolean(isSelected)}
            onChange={(event) => onSelectionChange(trialLesson.id, event.target.checked)}
            type="checkbox"
          />
        </td>
      ) : null}
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
          <div className="table-actions trial-lesson-actions">
            {linkedStudentId ? (
              <Link
                aria-label="View student"
                className="primary-button action-icon-button"
                href={`/students/profile/?id=${linkedStudentId}`}
                title="View student"
              >
                <ActionIcon name="eye" />
              </Link>
            ) : (
              conversionParticipants.map((item) => (
                <button
                  aria-label={`Convert ${item.japanese_name}`}
                  className="convert-button action-icon-button"
                  disabled={Boolean(convertingId)}
                  key={item.id}
                  onClick={() => onConvert(trialLesson.id, item.id)}
                  title={convertingId === item.id ? "Converting..." : `Convert ${item.japanese_name}`}
                  type="button"
                >
                  <ActionIcon name="user-plus" />
                </button>
              ))
            )}
            {canConfirm ? (
              <button
                aria-label="Confirm trial lesson"
                className="secondary-button action-icon-button"
                disabled={confirmingId === trialLesson.id}
                onClick={() => onConfirm(trialLesson)}
                title={confirmingId === trialLesson.id ? "Confirming..." : "Confirm trial lesson"}
                type="button"
              >
                <ActionIcon name="check" />
              </button>
            ) : null}
            <button
              aria-label="Send email"
              className="secondary-button action-icon-button"
              disabled={!prospectEmail}
              onClick={() => onOpenComposer(trialLesson)}
              title="Send email"
              type="button"
            >
              <ActionIcon name="send" />
            </button>
            {needsPhoneFollowUp ? (
              <button
                aria-label="Mark phone follow-up complete"
                className="ghost-button action-icon-button"
                disabled={phoneFollowUpId === trialLesson.id}
                onClick={() => onPhoneFollowUpComplete(trialLesson)}
                title={phoneFollowUpId === trialLesson.id ? "Saving..." : "Mark phone follow-up complete"}
                type="button"
              >
                <ActionIcon name="phone" />
              </button>
            ) : null}
            <button
              aria-label="Delete"
              className="danger-button action-icon-button"
              onClick={() => onRequestDelete(trialLesson)}
              title="Delete"
              type="button"
            >
              <ActionIcon name="trash" />
            </button>
          </div>
        </td>
      ) : null}
    </tr>
  );
}

function ActionIcon({ name }) {
  const icons = {
    check: (
      <path
        d="M5 12.5 9.1 16.5 19 6.5"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
    ),
    eye: (
      <>
        <path
          d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
        />
        <circle cx="12" cy="12" fill="none" r="3" stroke="currentColor" strokeWidth="2" />
      </>
    ),
    phone: (
      <path
        d="M6.5 4.5 9 4l2 4-1.8 1.2a11 11 0 0 0 5.6 5.6L16 13l4 2-.5 2.5c-.2 1-1.1 1.7-2.1 1.6C10.5 18.6 5.4 13.5 4.9 6.6c-.1-1 .6-1.9 1.6-2.1Z"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
    ),
    send: (
      <>
        <path
          d="M21 3 10 14"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
        />
        <path
          d="m21 3-7 18-4-7-7-4 18-7Z"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
        />
      </>
    ),
    trash: (
      <>
        <path
          d="M4 7h16"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
        />
        <path
          d="M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
        />
      </>
    ),
    "user-plus": (
      <>
        <path
          d="M15 19c0-2.2-2.2-4-5-4s-5 1.8-5 4"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
        />
        <circle cx="10" cy="8" fill="none" r="3" stroke="currentColor" strokeWidth="2" />
        <path
          d="M19 8v6M16 11h6"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
        />
      </>
    )
  };

  return (
    <svg aria-hidden="true" className="action-icon" focusable="false" viewBox="0 0 24 24">
      {icons[name]}
    </svg>
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

function BulkDeleteTrialLessonDialog({ deleteCount, deleting, error, onCancel, onConfirm }) {
  return (
    <div className="modal-backdrop" role="presentation">
      <section
        aria-describedby="bulk-delete-trial-lessons-description"
        aria-labelledby="bulk-delete-trial-lessons-title"
        aria-modal="true"
        className="communication-modal confirmation-modal"
        role="dialog"
      >
        <header className="communication-modal-header">
          <h2 id="bulk-delete-trial-lessons-title">Delete {deleteCount} selected Trial Lessons?</h2>
        </header>
        <div className="confirmation-modal-body">
          <p id="bulk-delete-trial-lessons-description">This action cannot be undone.</p>
          {error ? <p className="inline-alert">{error}</p> : null}
        </div>
        <div className="form-actions confirmation-modal-actions">
          <button className="secondary-button" disabled={deleting} onClick={onCancel} type="button">
            Cancel
          </button>
          <button className="danger-button" disabled={deleting} onClick={onConfirm} type="button">
            {deleting ? "Deleting..." : `Delete ${deleteCount}`}
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
