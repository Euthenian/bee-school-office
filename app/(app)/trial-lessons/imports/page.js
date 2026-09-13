"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";
import { DataSurface, ResponsiveTable } from "@/components/Surface";
import { useAuth } from "@/components/AuthProvider";
import { formatLessonTime } from "@/lib/class-details";
import { fetchPendingTrialBookingImports } from "@/lib/data";
import { formatDate, formatDateTime, humanize } from "@/lib/format";
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
            <table className="pending-imports-table">
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
                  <th className="pending-import-status-column">Parse</th>
                  <th className="pending-import-status-column">Review</th>
                  <th className="pending-import-action-column">Actions</th>
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
      <td className="pending-import-status-cell">
        <CompactStatusIcon status={pendingImport.parse_status} type="parse" />
      </td>
      <td className="pending-import-status-cell">
        <CompactStatusIcon status={pendingImport.review_status} type="review" />
      </td>
      <td className="pending-import-action-cell">
        <Link
          aria-label="Review"
          className="primary-button action-icon-button pending-import-action-link"
          href={`/trial-lessons/imports/review/?id=${pendingImport.id}`}
          title="Review"
        >
          <PendingImportIcon name="eye" />
        </Link>
      </td>
    </tr>
  );
}

function CompactStatusIcon({ status, type }) {
  const { icon, label, tone } = getCompactStatusConfig(status, type);

  return (
    <span aria-label={label} className={`pending-import-status-icon ${tone}`} role="img" title={label}>
      <PendingImportIcon name={icon} />
    </span>
  );
}

function getCompactStatusConfig(status, type) {
  const value = status || "unknown";
  const label = humanize(value);

  if (type === "parse") {
    if (value === "parsed") return { icon: "check", label, tone: "success" };
    if (value === "parse_error") return { icon: "alert", label, tone: "warning" };
    if (value === "ignored") return { icon: "minus", label, tone: "muted" };
    return { icon: "info", label, tone: "neutral" };
  }

  if (value === "pending_review") return { icon: "clock", label, tone: "warning" };
  if (value === "reviewed" || value === "converted") return { icon: "check", label, tone: "success" };
  if (value === "dismissed") return { icon: "minus", label, tone: "muted" };
  return { icon: "info", label, tone: "neutral" };
}

function PendingImportIcon({ name }) {
  const icons = {
    alert: (
      <>
        <path
          d="M12 8v5"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
        />
        <path
          d="M12 17h.01"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="3"
        />
        <path
          d="m10.3 4.7-7.8 13.5A2 2 0 0 0 4.2 21h15.6a2 2 0 0 0 1.7-2.8L13.7 4.7a2 2 0 0 0-3.4 0Z"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
        />
      </>
    ),
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
    clock: (
      <>
        <circle cx="12" cy="12" fill="none" r="8.5" stroke="currentColor" strokeWidth="2" />
        <path
          d="M12 7.5V12l3 2"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
        />
      </>
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
    info: (
      <>
        <circle cx="12" cy="12" fill="none" r="8.5" stroke="currentColor" strokeWidth="2" />
        <path
          d="M12 11.5v5"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
        />
        <path
          d="M12 7.5h.01"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="3"
        />
      </>
    ),
    minus: (
      <path
        d="M7 12h10"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
    )
  };

  return (
    <svg aria-hidden="true" className="action-icon" focusable="false" viewBox="0 0 24 24">
      {icons[name]}
    </svg>
  );
}
