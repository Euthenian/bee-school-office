"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { DataSurface, ResponsiveTable } from "@/components/Surface";
import { useAuth } from "@/components/AuthProvider";
import { formatLessonTime } from "@/lib/class-details";
import { fetchPendingTrialBookingImports } from "@/lib/data";
import { formatDate, formatDateTime } from "@/lib/format";
import { canManageTrialLessons } from "@/lib/roles";
import { getSupabaseBrowserClient } from "@/lib/supabase";

const reviewStatusOptions = [
  { value: "pending_review", label: "Pending review" },
  { value: "reviewed", label: "Reviewed" },
  { value: "dismissed", label: "Dismissed" },
  { value: "all", label: "All imports" }
];

export default function PendingTrialBookingImportsPage() {
  const { profile, session } = useAuth();
  const [search, setSearch] = useState("");
  const [reviewStatus, setReviewStatus] = useState("pending_review");
  const [state, setState] = useState({ loading: true, error: "", imports: [] });
  const mayManage = canManageTrialLessons(profile);

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(async () => {
      const supabase = getSupabaseBrowserClient();
      if (!supabase || !session || !mayManage) {
        setState({ loading: false, error: "", imports: [] });
        return;
      }

      setState((current) => ({ ...current, loading: true }));
      const { data, error } = await fetchPendingTrialBookingImports(supabase, {
        reviewStatus,
        search
      });
      if (!active) return;

      setState({
        loading: false,
        error: error ? error.message : "",
        imports: data || []
      });
    }, 180);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [mayManage, reviewStatus, search, session]);

  if (!mayManage) {
    return (
      <>
        <PageHeader eyebrow="Trial lesson management" title="Pending Bookings" />
        <DataSurface>
          <EmptyState
            title="Pending booking review is not available"
            description="Your current role can view assigned trial lessons but cannot review imported bookings."
          />
        </DataSurface>
      </>
    );
  }

  return (
    <>
      <PageHeader
        eyebrow="Trial lesson management"
        title="Pending Bookings"
        description="Review imported Gmail Trial Booking messages before any live trial lesson is created."
        actions={
          <Link className="secondary-button" href="/trial-lessons/">
            Back to trial lessons
          </Link>
        }
      />

      <div className="toolbar">
        <label className="search-field">
          <span>Search pending bookings</span>
          <input
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Name, course, email, or phone"
            type="search"
            value={search}
          />
        </label>
        <label className="search-field">
          <span>Review status</span>
          <select onChange={(event) => setReviewStatus(event.target.value)} value={reviewStatus}>
            {reviewStatusOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {state.error ? <p className="inline-alert">{state.error}</p> : null}

      <DataSurface aria-label="Pending imported trial bookings">
        {state.loading ? (
          <div className="table-placeholder">Loading pending bookings...</div>
        ) : state.imports.length ? (
          <ResponsiveTable>
            <table>
              <thead>
                <tr>
                  <th>Student name</th>
                  <th>Course</th>
                  <th>Lesson type</th>
                  <th>First choice</th>
                  <th>Email</th>
                  <th>Phone</th>
                  <th>Booking source</th>
                  <th>Trial type</th>
                  <th>Received</th>
                  <th>Parse</th>
                  <th>Review</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {state.imports.map((pendingImport) => (
                  <PendingImportRow key={pendingImport.id} pendingImport={pendingImport} />
                ))}
              </tbody>
            </table>
          </ResponsiveTable>
        ) : (
          <EmptyState title="No pending bookings found" description="No readable imported bookings matched the current filters." />
        )}
      </DataSurface>
    </>
  );
}

function PendingImportRow({ pendingImport }) {
  return (
    <tr>
      <td>
        <strong>{pendingImport.student_name || "Unnamed student"}</strong>
      </td>
      <td>{pendingImport.course || "Not set"}</td>
      <td>{pendingImport.lesson_type || "Not set"}</td>
      <td>
        {formatDate(pendingImport.first_preferred_date)}
        <br />
        <span>{formatLessonTime(pendingImport.first_preferred_time)}</span>
      </td>
      <td>{pendingImport.email || "Not set"}</td>
      <td>{pendingImport.phone || "Not set"}</td>
      <td>{pendingImport.booking_source || "Not set"}</td>
      <td>{pendingImport.trial_type || "Not set"}</td>
      <td>{formatDateTime(pendingImport.received_at)}</td>
      <td>
        <StatusBadge value={pendingImport.parse_status} />
      </td>
      <td>
        <StatusBadge value={pendingImport.review_status} />
      </td>
      <td>
        <Link className="primary-button" href={`/trial-lessons/imports/review/?id=${pendingImport.id}`}>
          Review
        </Link>
      </td>
    </tr>
  );
}
