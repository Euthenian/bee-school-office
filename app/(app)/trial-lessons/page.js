"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
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
import { formatLessonTime, formatLessonType, formatTeacherName, lessonTypes } from "@/lib/class-details";
import {
  confirmTrialLesson,
  createTrialPackageFromTrialLesson,
  convertTrialLessonParticipant,
  convertTrialLessonProspect,
  queueCommunication,
  deleteTrialLessons,
  deleteTrialLesson,
  fetchClassLevels,
  fetchPendingTrialBookingImportCount,
  fetchSchoolTeachers,
  fetchSchools,
  fetchTrialPackages,
  fetchTrialLessons,
  markTrialLessonPhoneFollowUpComplete,
  updateTrialPackageLesson,
  updateTrialPackageStatus,
  updateTrialLessonConversionDetails
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
  formatUpcomingTrialLessonDate,
  getNearestUpcomingTrialLesson,
  getLocalDateKey,
  getMissingTrialLessonConversionFields,
  getPrimaryParticipant,
  getTrialLessonPersonSearchValue,
  hasActiveTrialLessonColumnFilters,
  hasActiveTrialLessonSort,
  removeTrialLessonById,
  resetTrialLessonTableFilters,
  trialLessonDateFilterPresets,
  trialLessonStatuses
} from "@/lib/trial-lessons";
import {
  formatTrialPackageLessonStatus,
  formatTrialPackageLessonSchedule,
  formatTrialPackageLessonTeacher,
  formatTrialPackageSummary,
  formatTrialPackageType,
  getTrialPackageProgress,
  sortTrialPackageLessons,
  trialPackageLessonStatuses,
  trialPackageStatuses
} from "@/lib/trial-packages";
import { canManageTrialLessons } from "@/lib/roles";
import { getSupabaseBrowserClient } from "@/lib/supabase";

export default function TrialLessonsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { profile, session } = useAuth();
  const createdTrialLessonId = searchParams.get("created") || "";
  const [search, setSearch] = useState("");
  const initializedCreatedSearchIdRef = useRef("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [schoolFilter, setSchoolFilter] = useState("");
  const [teacherFilter, setTeacherFilter] = useState("");
  const [schools, setSchools] = useState([]);
  const [classLevels, setClassLevels] = useState([]);
  const [teachers, setTeachers] = useState([]);
  const [state, setState] = useState({ loading: true, error: "", trialLessons: [] });
  const [packageState, setPackageState] = useState({ loading: true, error: "", trialPackages: [] });
  const [packageTeacherOptionsBySchool, setPackageTeacherOptionsBySchool] = useState({});
  const [pendingState, setPendingState] = useState({ loading: true, count: 0 });
  const [actionNotice, setActionNotice] = useState("");
  const [communicatingTrialLesson, setCommunicatingTrialLesson] = useState(null);
  const [bulkCommunicatingTrialLessons, setBulkCommunicatingTrialLessons] = useState([]);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleteError, setDeleteError] = useState("");
  const [conversionCompletion, setConversionCompletion] = useState(null);
  const [confirmingId, setConfirmingId] = useState("");
  const [convertingId, setConvertingId] = useState("");
  const [deletingId, setDeletingId] = useState("");
  const [isDeletingBulk, setIsDeletingBulk] = useState(false);
  const [deletingIds, setDeletingIds] = useState([]);
  const [phoneFollowUpId, setPhoneFollowUpId] = useState("");
  const [packageActionId, setPackageActionId] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [packageRefreshKey, setPackageRefreshKey] = useState(0);
  const [columnFilters, setColumnFilters] = useState(defaultTrialLessonColumnFilters);
  const [tableSort, setTableSort] = useState(defaultTrialLessonSort);
  const [selectedTrialLessonIds, setSelectedTrialLessonIds] = useState(() => new Set());
  const mayManage = canManageTrialLessons(profile);

  useEffect(() => {
    if (!createdTrialLessonId || initializedCreatedSearchIdRef.current === createdTrialLessonId) return;

    if (search.trim()) {
      initializedCreatedSearchIdRef.current = createdTrialLessonId;
      return;
    }

    let active = true;

    async function initializeCreatedTrialLessonSearch() {
      const supabase = getSupabaseBrowserClient();
      if (!supabase || !session) return;

      const { data, error } = await fetchTrialLessons(supabase, { trialLessonId: createdTrialLessonId });
      if (!active) return;

      if (!error) {
        const createdSearchValue = getTrialLessonPersonSearchValue(data?.[0]);
        if (createdSearchValue) {
          setSearch(createdSearchValue);
        }
      }
      initializedCreatedSearchIdRef.current = createdTrialLessonId;
    }

    initializeCreatedTrialLessonSearch();

    return () => {
      active = false;
    };
  }, [createdTrialLessonId, search, session]);

  useEffect(() => {
    let active = true;

    async function loadFoundation() {
      const supabase = getSupabaseBrowserClient();
      if (!supabase || !session) return;

      const [schoolsResult, levelsResult] = await Promise.all([fetchSchools(supabase), fetchClassLevels(supabase)]);
      if (!active) return;

      if (schoolsResult.error || levelsResult.error) {
        setState((current) => ({ ...current, error: schoolsResult.error?.message || levelsResult.error?.message }));
        setSchools([]);
        setClassLevels([]);
      } else {
        setSchools(schoolsResult.data || []);
        setClassLevels(levelsResult.data || []);
      }
    }

    loadFoundation();

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

      const { data } = await fetchSchoolTeachers(supabase, schoolFilter, { requireProfile: true });
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

    async function loadPackageTeachers() {
      if (!session || !mayManage || !packageState.trialPackages.length) {
        setPackageTeacherOptionsBySchool({});
        return;
      }

      const supabase = getSupabaseBrowserClient();
      if (!supabase) return;

      const schoolIds = [...new Set(packageState.trialPackages.map((trialPackage) => trialPackage.school_id).filter(Boolean))];
      const entries = await Promise.all(
        schoolIds.map(async (schoolId) => {
          const { data } = await fetchSchoolTeachers(supabase, schoolId);
          return [schoolId, data || []];
        })
      );
      if (!active) return;

      setPackageTeacherOptionsBySchool(Object.fromEntries(entries));
    }

    loadPackageTeachers();

    return () => {
      active = false;
    };
  }, [mayManage, packageState.trialPackages, session]);

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
      setPackageState((current) => ({ ...current, loading: true }));
      setPendingState((current) => ({ ...current, loading: true }));
      const filters = {
        search,
        schoolId: schoolFilter,
        teacherId: teacherFilter,
        scope: ["upcoming", "needs_follow_up"].includes(statusFilter) ? statusFilter : "",
        status: statusFilter !== "all" && !["upcoming", "needs_follow_up"].includes(statusFilter) ? statusFilter : ""
      };
      const packageFilters = {
        search,
        schoolId: schoolFilter
      };
      const [trialLessonsResult, trialPackagesResult, pendingBookingsResult] = await Promise.all([
        fetchTrialLessons(supabase, filters),
        fetchTrialPackages(supabase, packageFilters),
        mayManage ? fetchPendingTrialBookingImportCount(supabase, { reviewStatus: "needs_action" }) : { count: 0, error: null }
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
      setPackageState({
        loading: false,
        error: trialPackagesResult.error?.message || "",
        trialPackages: trialPackagesResult.data || []
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
  }, [mayManage, packageRefreshKey, refreshKey, search, schoolFilter, session, statusFilter, teacherFilter]);

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
  const nearestUpcomingTrialLesson = useMemo(
    () => getNearestUpcomingTrialLesson(state.trialLessons, todayKey),
    [state.trialLessons, todayKey]
  );
  const packagedTrialLessonIds = useMemo(() => {
    const ids = new Set();
    for (const trialPackage of packageState.trialPackages) {
      for (const lesson of trialPackage.trial_package_lessons || []) {
        if (lesson.trial_lesson_id) {
          ids.add(lesson.trial_lesson_id);
        }
      }
    }
    return ids;
  }, [packageState.trialPackages]);
  const packagedProspectIds = useMemo(
    () => new Set(packageState.trialPackages.map((trialPackage) => trialPackage.prospect_id).filter(Boolean)),
    [packageState.trialPackages]
  );
  const isPackageEligibilityLoading = packageState.loading && !packageState.trialPackages.length;
  const selectedTrialLessonCount = validSelectedTrialLessonIds.size;
  const visibleSelectedTrialLessonCount = visibleTrialLessons.filter((trialLesson) => validSelectedTrialLessonIds.has(trialLesson.id)).length;
  const allVisibleSelected =
    Boolean(visibleTrialLessons.length) && visibleSelectedTrialLessonCount === visibleTrialLessons.length;
  const hasAnyFilters =
    Boolean(search.trim() || statusFilter !== "all" || schoolFilter || teacherFilter) ||
    hasActiveTrialLessonColumnFilters(columnFilters) ||
    hasActiveTrialLessonSort(tableSort);
  const isUpcomingFilter = statusFilter === "upcoming";

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

  async function handleConvert(trialLesson, participantId = "") {
    const trialLessonId = typeof trialLesson === "string" ? trialLesson : trialLesson.id;
    const conversionKey = participantId || `prospect:${trialLessonId}`;
    if (!participantId && typeof trialLesson !== "string") {
      const missingFields = getMissingTrialLessonConversionFields(trialLesson);
      if (missingFields.length) {
        setConversionCompletion({
          converting: false,
          error: "",
          levelId: trialLesson.level_id || trialLesson.class_levels?.id || "",
          lessonType: trialLesson.lesson_type || "",
          missingFields,
          trialLesson
        });
        return;
      }
    }

    setConvertingId(conversionKey);
    setState((current) => ({ ...current, error: "" }));

    const supabase = getSupabaseBrowserClient();
    if (!supabase || !session) {
      setState((current) => ({ ...current, error: "You must be signed in before converting a trial lesson." }));
      setConvertingId("");
      return;
    }

    const { data: studentId, error } = participantId
      ? await convertTrialLessonParticipant(supabase, trialLessonId, participantId)
      : await convertTrialLessonProspect(supabase, trialLessonId);
    if (error) {
      setState((current) => ({ ...current, error: error.message }));
      setConvertingId("");
      return;
    }

    router.push(`/students/profile/?id=${studentId}`);
  }

  function handleConversionCompletionCancel() {
    setConversionCompletion(null);
  }

  function updateConversionCompletionField(field, value) {
    setConversionCompletion((current) => (current ? { ...current, [field]: value, error: "" } : current));
  }

  async function handleConversionCompletionConfirm() {
    if (!conversionCompletion?.trialLesson) return;

    setConversionCompletion((current) => (current ? { ...current, converting: true, error: "" } : current));
    const supabase = getSupabaseBrowserClient();
    if (!supabase || !session) {
      setConversionCompletion((current) =>
        current ? { ...current, converting: false, error: "You must be signed in before converting a trial lesson." } : current
      );
      return;
    }

    const trialLessonId = conversionCompletion.trialLesson.id;
    const detailsResult = await updateTrialLessonConversionDetails(supabase, {
      trialLessonId,
      lessonType: conversionCompletion.lessonType,
      levelId: conversionCompletion.levelId
    });
    if (detailsResult.error) {
      setConversionCompletion((current) => (current ? { ...current, converting: false, error: detailsResult.error.message } : current));
      return;
    }

    const { data: studentId, error } = await convertTrialLessonProspect(supabase, trialLessonId);
    if (error) {
      setConversionCompletion((current) => (current ? { ...current, converting: false, error: error.message } : current));
      return;
    }

    setConversionCompletion(null);
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

  async function handlePackageLessonSave(lesson, draft) {
    setPackageActionId(lesson.id);
    setActionNotice("");
    setPackageState((current) => ({ ...current, error: "" }));

    const supabase = getSupabaseBrowserClient();
    if (!supabase || !session) {
      setPackageState((current) => ({ ...current, error: "You must be signed in before updating a trial package lesson." }));
      setPackageActionId("");
      return;
    }

    const { error } = await updateTrialPackageLesson(supabase, {
      trialPackageLessonId: lesson.id,
      lessonDate: draft.lessonDate,
      lessonTime: draft.lessonTime,
      assignedTeacherStaffId: draft.assignedTeacherStaffId,
      status: draft.status,
      notes: draft.notes
    });

    if (error) {
      setPackageState((current) => ({ ...current, error: error.message }));
      setPackageActionId("");
      return;
    }

    setActionNotice("Trial package lesson updated.");
    setPackageActionId("");
    setPackageRefreshKey((current) => current + 1);
  }

  async function handlePackageStatusChange(trialPackage, status) {
    setPackageActionId(trialPackage.id);
    setActionNotice("");
    setPackageState((current) => ({ ...current, error: "" }));

    const supabase = getSupabaseBrowserClient();
    if (!supabase || !session) {
      setPackageState((current) => ({ ...current, error: "You must be signed in before updating a trial package." }));
      setPackageActionId("");
      return;
    }

    const { error } = await updateTrialPackageStatus(supabase, {
      trialPackageId: trialPackage.id,
      status
    });

    if (error) {
      setPackageState((current) => ({ ...current, error: error.message }));
      setPackageActionId("");
      return;
    }

    setActionNotice("Trial package status updated.");
    setPackageActionId("");
    setPackageRefreshKey((current) => current + 1);
  }

  async function handleCreatePackageFromTrialLesson(trialLesson) {
    const actionKey = `create-package:${trialLesson.id}`;
    setPackageActionId(actionKey);
    setActionNotice("");
    setPackageState((current) => ({ ...current, error: "" }));

    const supabase = getSupabaseBrowserClient();
    if (!supabase || !session) {
      setPackageState((current) => ({ ...current, error: "You must be signed in before creating a trial package." }));
      setPackageActionId("");
      return;
    }

    const { error } = await createTrialPackageFromTrialLesson(supabase, trialLesson.id);
    if (error) {
      setPackageState((current) => ({ ...current, error: error.message }));
      setPackageActionId("");
      return;
    }

    setActionNotice("4-lesson trial package created from the existing trial lesson.");
    setPackageActionId("");
    setPackageRefreshKey((current) => current + 1);
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
              {nearestUpcomingTrialLesson ? (
                <span className="upcoming-trial-lesson-indicator">
                  <span aria-hidden="true" className="upcoming-trial-lesson-star">
                    ★
                  </span>
                  <span className="status-badge upcoming-trial-lesson-pill">
                    Upcoming Trial Lesson &middot; {formatUpcomingTrialLessonDate(nearestUpcomingTrialLesson)}
                  </span>
                </span>
              ) : null}
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

      {[state.error, packageState.error].filter(Boolean).map((message) => (
        <p className="inline-alert" key={message}>
          {message}
        </p>
      ))}
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
      {conversionCompletion ? (
        <ConversionCompletionDialog
          classLevels={classLevels}
          completion={conversionCompletion}
          onCancel={handleConversionCompletionCancel}
          onConfirm={handleConversionCompletionConfirm}
          onUpdate={updateConversionCompletionField}
        />
      ) : null}

      {isUpcomingFilter ? null : (
        <TrialPackageTracker
          actionId={packageActionId}
          loading={packageState.loading}
          mayManage={mayManage}
          onLessonSave={handlePackageLessonSave}
          onStatusChange={handlePackageStatusChange}
          teacherOptionsBySchool={packageTeacherOptionsBySchool}
          trialPackages={packageState.trialPackages}
        />
      )}

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
                {visibleTrialLessons.map((trialLesson) => {
                  const prospectId = getTrialLessonProspectId(trialLesson);
                  const hasLinkedPackage = packagedTrialLessonIds.has(trialLesson.id);
                  const hasProspectPackage = Boolean(prospectId && packagedProspectIds.has(prospectId));
                  const canCreateTrialPackage =
                    trialLesson.lesson_type === "group" && !hasLinkedPackage && !hasProspectPackage;

                  return (
                    <TrialLessonRow
                      canCreateTrialPackage={canCreateTrialPackage}
                      isSelected={validSelectedTrialLessonIds.has(trialLesson.id)}
                      confirmingId={confirmingId}
                      convertingId={convertingId}
                      isPackageEligibilityLoading={isPackageEligibilityLoading}
                      packageActionId={packageActionId}
                      key={trialLesson.id}
                      mayManage={mayManage}
                      onConfirm={handleConfirm}
                      onConvert={handleConvert}
                      onCreateTrialPackage={handleCreatePackageFromTrialLesson}
                      onSelectionChange={setTrialLessonSelection}
                      onRequestDelete={handleDeleteRequest}
                      onOpenComposer={setCommunicatingTrialLesson}
                      onPhoneFollowUpComplete={handlePhoneFollowUpComplete}
                      phoneFollowUpId={phoneFollowUpId}
                      todayKey={todayKey}
                      trialLesson={trialLesson}
                    />
                  );
                })}
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

function TrialPackageTracker({
  actionId,
  loading,
  mayManage,
  onLessonSave,
  onStatusChange,
  teacherOptionsBySchool,
  trialPackages
}) {
  if (loading) {
    return (
      <DataSurface aria-label="Trial package tracker">
        <div className="table-placeholder">Loading trial packages...</div>
      </DataSurface>
    );
  }

  if (!trialPackages.length) {
    return null;
  }

  return (
    <DataSurface aria-label="Trial package tracker">
      <div className="section-heading-row">
        <div>
          <p className="eyebrow">Trial Package Tracker</p>
          <h2>Trial Packages</h2>
        </div>
      </div>
      <div className="stack-list">
        {trialPackages.map((trialPackage) => (
          <TrialPackageCard
            actionId={actionId}
            key={trialPackage.id}
            mayManage={mayManage}
            onLessonSave={onLessonSave}
            onStatusChange={onStatusChange}
            teacherOptions={teacherOptionsBySchool[trialPackage.school_id] || []}
            trialPackage={trialPackage}
          />
        ))}
      </div>
    </DataSurface>
  );
}

function TrialPackageCard({ actionId, mayManage, onLessonSave, onStatusChange, teacherOptions, trialPackage }) {
  const progress = getTrialPackageProgress(trialPackage);
  const nextLesson = progress.nextLesson;
  const nextScheduledLesson = progress.nextScheduledLesson;
  const lessons = sortTrialPackageLessons(trialPackage.trial_package_lessons || []);
  const nextSchedule = nextLesson ? formatTrialPackageLessonSchedule(nextLesson) || "Not scheduled" : "Not scheduled";
  const nextScheduledSchedule = nextScheduledLesson
    ? formatTrialPackageLessonSchedule(nextScheduledLesson) || "Not scheduled"
    : "None scheduled";

  return (
    <article className="list-card trial-package-card">
      <div className="list-card-header">
        <div className="table-cell-stack">
          <strong>Trial Package - {formatTrialPackageType(trialPackage.package_type)}</strong>
          <span>{formatTrialPackageSummary(trialPackage)}</span>
        </div>
        <StatusBadge value={trialPackage.status} />
      </div>
      <div className="trial-package-summary-grid">
        <div>
          <span className="eyebrow">Progress</span>
          <strong>{progress.label}</strong>
        </div>
        <div>
          <span className="eyebrow">Next lesson</span>
          <strong>
            {nextLesson ? `Lesson ${nextLesson.lesson_number}/${progress.total} - ${formatTrialPackageLessonStatus(nextLesson.status)}` : "None"}
          </strong>
          <span>{nextLesson ? nextSchedule : "All required lessons are closed"}</span>
        </div>
        <div>
          <span className="eyebrow">Next scheduled</span>
          <strong>
            {nextScheduledLesson ? `Lesson ${nextScheduledLesson.lesson_number}/${progress.total}` : "None"}
          </strong>
          <span>{nextScheduledSchedule}</span>
        </div>
        <div>
          <span className="eyebrow">Teacher</span>
          <strong>{nextLesson ? formatTrialPackageLessonTeacher(nextLesson) : "No teacher"}</strong>
        </div>
        <div>
          <span className="eyebrow">Unscheduled</span>
          <strong>{progress.unscheduled}</strong>
        </div>
        {mayManage ? (
          <label>
            <span className="eyebrow">Package status</span>
            <select
              disabled={actionId === trialPackage.id}
              onChange={(event) => onStatusChange(trialPackage, event.target.value)}
              value={trialPackage.status}
            >
              {trialPackageStatuses.map((status) => (
                <option key={status.value} value={status.value}>
                  {status.label}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>
      <div className="trial-package-lessons">
        {lessons.map((lesson) => (
          <TrialPackageLessonEditor
            key={`${lesson.id}:${lesson.status}:${lesson.lesson_date || ""}:${lesson.lesson_time || ""}:${lesson.assigned_teacher_staff_id || ""}`}
            lesson={lesson}
            mayManage={mayManage}
            onSave={onLessonSave}
            saving={actionId === lesson.id}
            teacherOptions={teacherOptions}
            totalLessons={progress.total}
          />
        ))}
      </div>
    </article>
  );
}

function TrialPackageLessonEditor({ lesson, mayManage, onSave, saving, teacherOptions, totalLessons }) {
  const [draft, setDraft] = useState(() => buildTrialPackageLessonDraft(lesson));
  const linkedTrialLesson = lesson.linked_trial_lesson;
  const lessonSchedule = formatTrialPackageLessonSchedule(lesson) || "Not scheduled";

  function updateDraft(field, value) {
    setDraft((current) => {
      const next = { ...current, [field]: value };
      if ((field === "lessonDate" || field === "lessonTime") && next.lessonDate && next.lessonTime && next.status === "not_scheduled") {
        next.status = "scheduled";
      }
      if (field === "status" && value === "not_scheduled") {
        next.lessonDate = "";
        next.lessonTime = "";
      }
      return next;
    });
  }

  if (!mayManage || linkedTrialLesson) {
    return (
      <div className="trial-package-lesson-row">
        <strong>
          Lesson {lesson.lesson_number}/{totalLessons}
        </strong>
        <span>{formatTrialPackageLessonStatus(lesson.status)}</span>
        <span>{lessonSchedule}</span>
        <span>{formatTrialPackageLessonTeacher(lesson)}</span>
        {linkedTrialLesson ? (
          <span>
            Linked Trial Lesson: <StatusBadge value={linkedTrialLesson.status || "booked"} />
          </span>
        ) : null}
      </div>
    );
  }

  return (
    <div className="trial-package-lesson-row">
      <strong>
        Lesson {lesson.lesson_number}/{totalLessons}
      </strong>
      <label>
        <span>Status</span>
        <select onChange={(event) => updateDraft("status", event.target.value)} value={draft.status}>
          {trialPackageLessonStatuses.map((status) => (
            <option key={status.value} value={status.value}>
              {status.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>Date</span>
        <input onChange={(event) => updateDraft("lessonDate", event.target.value)} type="date" value={draft.lessonDate} />
      </label>
      <label>
        <span>Time</span>
        <input onChange={(event) => updateDraft("lessonTime", event.target.value)} type="time" value={draft.lessonTime} />
      </label>
      <label>
        <span>Teacher</span>
        <select onChange={(event) => updateDraft("assignedTeacherStaffId", event.target.value)} value={draft.assignedTeacherStaffId}>
          <option value="">No teacher assigned</option>
          {teacherOptions.map((teacher) => (
            <option key={teacher.staff_id} value={teacher.staff_id}>
              {teacher.full_name || teacher.email}
            </option>
          ))}
        </select>
      </label>
      <button className="secondary-button" disabled={saving} onClick={() => onSave(lesson, draft)} type="button">
        {saving ? "Saving..." : "Save"}
      </button>
    </div>
  );
}

function buildTrialPackageLessonDraft(lesson) {
  return {
    lessonDate: lesson.lesson_date || "",
    lessonTime: String(lesson.lesson_time || "").slice(0, 5),
    assignedTeacherStaffId: lesson.assigned_teacher_staff_id || "",
    status: lesson.status || "not_scheduled",
    notes: lesson.notes || ""
  };
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
  canCreateTrialPackage,
  confirmingId,
  convertingId,
  isPackageEligibilityLoading,
  mayManage,
  isSelected,
  onConfirm,
  onConvert,
  onCreateTrialPackage,
  onSelectionChange,
  onOpenComposer,
  onPhoneFollowUpComplete,
  onRequestDelete,
  packageActionId,
  phoneFollowUpId,
  todayKey,
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
    !linkedStudentId &&
    trialLesson.status !== "booked" &&
    !["joined", "cancelled", "did_not_join"].includes(trialLesson.status) &&
    trialLesson.trial_date &&
    trialLesson.trial_time;
  const canConvertMissingParticipant =
    !linkedStudentId &&
    !conversionParticipants.length &&
    Boolean(prospect?.id) &&
    trialLesson.status === "booked" &&
    trialLesson.trial_date &&
    (!todayKey || trialLesson.trial_date < todayKey);
  const fallbackConversionId = `prospect:${trialLesson.id}`;
  const createPackageActionId = `create-package:${trialLesson.id}`;

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
            ) : conversionParticipants.length ? (
              conversionParticipants.map((item) => (
                <button
                  aria-label={`Convert ${item.japanese_name}`}
                  className="convert-button action-icon-button"
                  disabled={Boolean(convertingId)}
                  key={item.id}
                  onClick={() => onConvert(trialLesson, item.id)}
                  title={convertingId === item.id ? "Converting..." : `Convert ${item.japanese_name}`}
                  type="button"
                >
                  <ActionIcon name="user-plus" />
                </button>
              ))
            ) : canConvertMissingParticipant ? (
              <button
                aria-label="Convert prospect to student"
                className="convert-button action-icon-button"
                disabled={Boolean(convertingId)}
                onClick={() => onConvert(trialLesson)}
                title={convertingId === fallbackConversionId ? "Converting..." : "Convert to student"}
                type="button"
              >
                <ActionIcon name="user-plus" />
              </button>
            ) : null}
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
            {canCreateTrialPackage ? (
              <button
                className="secondary-button"
                disabled={isPackageEligibilityLoading || packageActionId === createPackageActionId}
                onClick={() => onCreateTrialPackage(trialLesson)}
                type="button"
              >
                {packageActionId === createPackageActionId
                  ? "Creating..."
                  : isPackageEligibilityLoading
                    ? "Checking package..."
                    : "Create 4-Lesson Trial Package"}
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

function getTrialLessonProspectId(trialLesson) {
  return trialLesson?.prospect_id || trialLesson?.prospects?.id || "";
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

function ConversionCompletionDialog({ classLevels, completion, onCancel, onConfirm, onUpdate }) {
  const needsLessonType = completion.missingFields.includes("lessonType");
  const needsLevel = completion.missingFields.includes("levelId");
  const canConvert = Boolean(completion.lessonType && completion.levelId) && !completion.converting;

  return (
    <div className="modal-backdrop" role="presentation">
      <section
        aria-describedby="conversion-completion-description"
        aria-labelledby="conversion-completion-title"
        aria-modal="true"
        className="communication-modal confirmation-modal"
        role="dialog"
      >
        <header className="communication-modal-header">
          <h2 id="conversion-completion-title">Complete conversion details</h2>
        </header>
        <div className="confirmation-modal-body">
          <p id="conversion-completion-description">Select the remaining class details before creating the student.</p>
          <div className="form-grid">
            {needsLessonType ? (
              <label>
                Lesson type
                <select
                  disabled={completion.converting}
                  onChange={(event) => onUpdate("lessonType", event.target.value)}
                  required
                  value={completion.lessonType}
                >
                  <option value="">Select lesson type</option>
                  {lessonTypes.map((type) => (
                    <option key={type.value} value={type.value}>
                      {type.label}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            {needsLevel ? (
              <label>
                Level
                <select
                  disabled={completion.converting || !classLevels.length}
                  onChange={(event) => onUpdate("levelId", event.target.value)}
                  required
                  value={completion.levelId}
                >
                  <option value="">{classLevels.length ? "Select a level" : "Loading levels..."}</option>
                  {classLevels.map((level) => (
                    <option key={level.id} value={level.id}>
                      {level.label}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </div>
          {completion.error ? <p className="inline-alert">{completion.error}</p> : null}
        </div>
        <div className="form-actions confirmation-modal-actions">
          <button className="secondary-button" disabled={completion.converting} onClick={onCancel} type="button">
            Cancel
          </button>
          <button className="primary-button" disabled={!canConvert} onClick={onConfirm} type="button">
            {completion.converting ? "Converting..." : "Convert to student"}
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
