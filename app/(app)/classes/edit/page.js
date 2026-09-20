"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ClassEditor } from "@/components/ClassEditor";
import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";
import { DataSurface } from "@/components/Surface";
import { useAuth } from "@/components/AuthProvider";
import { buildClassMutation, formatClassName } from "@/lib/classes";
import { fetchClassLevels, fetchClassProfile, fetchSchoolTeachers, fetchSchools, updateClass } from "@/lib/data";
import { canManageClasses } from "@/lib/roles";
import { getSupabaseBrowserClient } from "@/lib/supabase";

export default function EditClassPage() {
  return (
    <Suspense fallback={<EditClassLoading />}>
      <EditClassContent />
    </Suspense>
  );
}

function EditClassContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const classId = searchParams.get("id") || "";
  const { profile, session } = useAuth();
  const mayManage = canManageClasses(profile);
  const [classRow, setClassRow] = useState(null);
  const [form, setForm] = useState(() => buildClassMutation());
  const [foundation, setFoundation] = useState({ classLevels: [], schools: [] });
  const [teachers, setTeachers] = useState([]);
  const [state, setState] = useState({ error: "", loading: true });
  const [loadingTeachers, setLoadingTeachers] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let active = true;

    async function loadEditData() {
      const supabase = getSupabaseBrowserClient();
      if (!supabase || !session || !classId || !mayManage) {
        setState({ error: "", loading: false });
        return;
      }

      setState((current) => ({ ...current, loading: true }));
      const [classResult, schoolsResult, levelsResult] = await Promise.all([
        fetchClassProfile(supabase, classId),
        fetchSchools(supabase),
        fetchClassLevels(supabase)
      ]);
      if (!active) return;

      const loadError = [classResult.error, schoolsResult.error, levelsResult.error]
        .filter(Boolean)
        .map((error) => error.message)
        .join(" ");

      setClassRow(classResult.data || null);
      setForm(
        buildClassMutation({
          assignedTeacherProfileId: classResult.data?.assigned_teacher_profile_id,
          classLevelId: classResult.data?.level_id,
          lessonDay: classResult.data?.lesson_day,
          lessonTime: String(classResult.data?.lesson_time || "").slice(0, 5),
          lessonType: classResult.data?.lesson_type,
          schoolId: classResult.data?.school_id,
          status: classResult.data?.status
        })
      );
      setFoundation({ classLevels: levelsResult.data || [], schools: schoolsResult.data || [] });
      setState({ error: loadError, loading: false });
    }

    loadEditData();

    return () => {
      active = false;
    };
  }, [classId, mayManage, session]);

  useEffect(() => {
    let active = true;

    async function loadTeachers() {
      setTeachers([]);
      if (!form.schoolId || !session || !mayManage) {
        setLoadingTeachers(false);
        return;
      }

      const supabase = getSupabaseBrowserClient();
      if (!supabase) {
        setLoadingTeachers(false);
        return;
      }

      setLoadingTeachers(true);
      const { data, error } = await fetchSchoolTeachers(supabase, form.schoolId);
      if (!active) return;

      if (error) {
        setState((current) => ({ ...current, error: error.message }));
      }
      setTeachers(data || []);
      setLoadingTeachers(false);
    }

    loadTeachers();

    return () => {
      active = false;
    };
  }, [form.schoolId, mayManage, session]);

  const availableSchools = useMemo(
    () => foundation.schools.filter((school) => school.status === "active" || school.id === form.schoolId),
    [form.schoolId, foundation.schools]
  );

  function updateField(field, value) {
    setForm((current) => ({
      ...current,
      [field]: value,
      ...(field === "schoolId" ? { assignedTeacherProfileId: "" } : {})
    }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setState((current) => ({ ...current, error: "" }));
    setSubmitting(true);

    const supabase = getSupabaseBrowserClient();
    if (!supabase || !session || !classId) {
      setState((current) => ({ ...current, error: "You must be signed in before editing a class." }));
      setSubmitting(false);
      return;
    }

    const { error } = await updateClass(supabase, { classId, ...form });
    if (error) {
      setState((current) => ({ ...current, error: error.message }));
      setSubmitting(false);
      return;
    }

    router.push(`/classes/profile/?id=${classId}`);
  }

  if (!mayManage) {
    return (
      <>
        <PageHeader eyebrow="Teaching operations" title="Edit Class" />
        <DataSurface>
          <EmptyState title="Class editing is not available" description="Your current role cannot edit class records." />
        </DataSurface>
      </>
    );
  }

  if (!classId && !state.loading) {
    return (
      <>
        <PageHeader eyebrow="Teaching operations" title="Class not selected" />
        <EmptyState title="No class ID was provided" description="Open a class profile before editing." />
      </>
    );
  }

  if (state.loading) return <EditClassLoading />;

  if (!classRow) {
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

  return (
    <>
      <PageHeader
        eyebrow="Teaching operations"
        title="Edit Class"
        description={formatClassName(classRow)}
        actions={
          <Link className="secondary-button" href={`/classes/profile/?id=${classId}`}>
            Back to class
          </Link>
        }
      />

      {state.error ? <p className="inline-alert">{state.error}</p> : null}

      <DataSurface>
        <ClassEditor
          cancelHref={`/classes/profile/?id=${classId}`}
          classLevels={foundation.classLevels}
          form={form}
          loadingTeachers={loadingTeachers}
          onChange={updateField}
          onSubmit={handleSubmit}
          schools={availableSchools}
          submitting={submitting}
          teachers={teachers}
        />
      </DataSurface>
    </>
  );
}

function EditClassLoading() {
  return (
    <>
      <PageHeader eyebrow="Teaching operations" title="Loading class" />
      <div className="table-placeholder">Loading class edit form...</div>
    </>
  );
}
