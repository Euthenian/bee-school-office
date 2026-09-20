"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ClassEditor } from "@/components/ClassEditor";
import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";
import { DataSurface } from "@/components/Surface";
import { useAuth } from "@/components/AuthProvider";
import { buildClassMutation } from "@/lib/classes";
import { createClass, fetchClassLevels, fetchSchoolTeachers, fetchSchools } from "@/lib/data";
import { canManageClasses } from "@/lib/roles";
import { getSupabaseBrowserClient } from "@/lib/supabase";

export default function NewClassPage() {
  const router = useRouter();
  const { profile, session } = useAuth();
  const mayManage = canManageClasses(profile);
  const [form, setForm] = useState(() => buildClassMutation());
  const [foundation, setFoundation] = useState({ classLevels: [], schools: [] });
  const [teachers, setTeachers] = useState([]);
  const [state, setState] = useState({ error: "", loading: true });
  const [loadingTeachers, setLoadingTeachers] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let active = true;

    async function loadFoundation() {
      const supabase = getSupabaseBrowserClient();
      if (!supabase || !session || !mayManage) {
        setState({ error: "", loading: false });
        return;
      }

      const [schoolsResult, levelsResult] = await Promise.all([fetchSchools(supabase), fetchClassLevels(supabase)]);
      if (!active) return;

      const loadError = [schoolsResult.error, levelsResult.error]
        .filter(Boolean)
        .map((error) => error.message)
        .join(" ");

      setFoundation({ classLevels: levelsResult.data || [], schools: schoolsResult.data || [] });
      setState({ error: loadError, loading: false });
    }

    loadFoundation();

    return () => {
      active = false;
    };
  }, [mayManage, session]);

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

  const activeSchools = useMemo(() => foundation.schools.filter((school) => school.status === "active"), [foundation.schools]);

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
    if (!supabase || !session) {
      setState((current) => ({ ...current, error: "You must be signed in before creating a class." }));
      setSubmitting(false);
      return;
    }

    const { data: classId, error } = await createClass(supabase, form);
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
        <PageHeader eyebrow="Teaching operations" title="Add Class" />
        <DataSurface>
          <EmptyState title="Class creation is not available" description="Your current role cannot create class records." />
        </DataSurface>
      </>
    );
  }

  if (state.loading) {
    return (
      <>
        <PageHeader eyebrow="Teaching operations" title="Loading class form" />
        <div className="table-placeholder">Loading class foundation...</div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        eyebrow="Teaching operations"
        title="Add Class"
        description="Create a scheduled teaching unit. Students enroll into this class separately."
        actions={
          <Link className="secondary-button" href="/classes/">
            Back to classes
          </Link>
        }
      />

      {state.error ? <p className="inline-alert">{state.error}</p> : null}

      <DataSurface>
        <ClassEditor
          cancelHref="/classes/"
          classLevels={foundation.classLevels}
          form={form}
          loadingTeachers={loadingTeachers}
          onChange={updateField}
          onSubmit={handleSubmit}
          schools={activeSchools}
          submitLabel="Create class"
          submitting={submitting}
          teachers={teachers}
        />
      </DataSurface>
    </>
  );
}
