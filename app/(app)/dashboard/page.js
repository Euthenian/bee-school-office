"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { DataSurface, MetricCard, ResponsiveTable, SurfaceHeader } from "@/components/Surface";
import { useAuth } from "@/components/AuthProvider";
import {
  getGmailTrialBookingCronHealthAlertTone,
  shouldShowGmailTrialBookingCronHealthAlert
} from "@/lib/cron-health";
import { formatDate, formatDateTime, formatPersonName } from "@/lib/format";
import { fetchDashboardData } from "@/lib/data";
import { canManageTrialLessons } from "@/lib/roles";
import { getSupabaseBrowserClient } from "@/lib/supabase";

export default function DashboardPage() {
  const { profile, session } = useAuth();
  const mayViewCronHealth = canManageTrialLessons(profile);
  const [state, setState] = useState({
    loading: true,
    error: "",
    metrics: null,
    recentStudents: [],
    cronHealth: null
  });

  useEffect(() => {
    let active = true;

    async function loadDashboard() {
      const supabase = getSupabaseBrowserClient();
      if (!supabase || !session) {
        setState((current) => ({ ...current, loading: false }));
        return;
      }

      const { data, error } = await fetchDashboardData(supabase, { includeCronHealth: mayViewCronHealth });
      if (!active) return;

      if (error) {
        setState({ loading: false, error: error.message, metrics: null, recentStudents: [], cronHealth: null });
        return;
      }

      setState({
        loading: false,
        error: "",
        metrics: data.metrics,
        recentStudents: data.recentStudents,
        cronHealth: data.cronHealth
      });
    }

    loadDashboard();

    return () => {
      active = false;
    };
  }, [mayViewCronHealth, session]);

  return (
    <>
      <PageHeader
        eyebrow="Network overview"
        title="Dashboard"
        description="Live counts are shown only for rows your role can read through Supabase RLS."
      />

      {state.error ? <p className="inline-alert">{state.error}</p> : null}
      {shouldShowGmailTrialBookingCronHealthAlert(state.cronHealth) ? <CronHealthAlert health={state.cronHealth} /> : null}

      <section className="metric-grid" aria-label="Dashboard metrics">
        <MetricCard label="Active Students" loading={state.loading} value={state.metrics?.activeStudents} />
        <MetricCard label="Schools" loading={state.loading} value={state.metrics?.schools} />
        <MetricCard label="Staff" loading={state.loading} value={state.metrics?.staff} />
      </section>

      <DataSurface aria-labelledby="recent-students-heading">
        <SurfaceHeader
          actions={
            <Link className="secondary-button" href="/students/">
              View all
            </Link>
          }
        >
          <div>
            <p className="eyebrow">Recent activity</p>
            <h2 id="recent-students-heading">Recent Students</h2>
          </div>
        </SurfaceHeader>

        {state.loading ? (
          <div className="table-placeholder">Loading students...</div>
        ) : state.recentStudents.length ? (
          <ResponsiveTable>
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Status</th>
                  <th>School</th>
                  <th>Start date</th>
                </tr>
              </thead>
              <tbody>
                {state.recentStudents.map((student) => (
                  <tr key={student.id}>
                    <td>
                      <Link href={`/students/profile/?id=${student.id}`}>{formatPersonName(student)}</Link>
                    </td>
                    <td>
                      <StatusBadge value={student.status} />
                    </td>
                    <td>{student.schools?.name || "Unassigned"}</td>
                    <td>{formatDate(student.start_date)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ResponsiveTable>
        ) : (
          <EmptyState title="No readable students yet" description="Students will appear here after records are added for your organization or school." />
        )}
      </DataSurface>
    </>
  );
}

function CronHealthAlert({ health }) {
  const tone = getGmailTrialBookingCronHealthAlertTone(health);
  const lastSuccess =
    health.lastSuccessAt && Number.isFinite(Number(health.minutesSinceLastSuccess))
      ? `${health.minutesSinceLastSuccess} minutes ago`
      : "not recorded";
  const lastRun = health.lastRunAt ? formatDateTime(health.lastRunAt) : "not recorded";

  return (
    <div className={`cron-health-alert ${tone}`} role="alert">
      <strong>{tone === "critical" ? "Trial Booking import critical" : "Trial Booking import delayed"}</strong>
      <span>
        Trial Booking email import may be delayed. Last successful run: {lastSuccess}. Last run: {lastRun}. Result:{" "}
        {health.lastResult || "unknown"}.
      </span>
    </div>
  );
}
