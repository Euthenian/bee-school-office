"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";
import { DataSurface, ResponsiveTable } from "@/components/Surface";
import { useAuth } from "@/components/AuthProvider";
import { formatLessonTime } from "@/lib/class-details";
import { dismissPendingTrialBookingImport, fetchPendingTrialBookingImports } from "@/lib/data";
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
  const [discardTarget, setDiscardTarget] = useState(null);
  const [discardingId, setDiscardingId] = useState("");
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

  async function handleConfirmDiscard() {
    if (!discardTarget) return;

    const target = discardTarget;
    const supabase = getSupabaseBrowserClient();
    setDiscardTarget(null);

    if (!supabase || !session) {
      setState((current) => ({ ...current, error: "You must be signed in before discarding a pending booking." }));
      return;
    }

    setDiscardingId(target.id);
    setState((current) => ({
      ...current,
      error: "",
      imports: current.imports.filter((pendingImport) => pendingImport.id !== target.id)
    }));

    const { error } = await dismissPendingTrialBookingImport(supabase, target.id);
    if (error) {
      setState((current) => ({
        ...current,
        error: error.message,
        imports: [target, ...current.imports]
      }));
    }
    setDiscardingId("");
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
      {discardTarget ? (
        <DiscardPendingImportDialog
          booking={discardTarget}
          onCancel={() => setDiscardTarget(null)}
          onConfirm={handleConfirmDiscard}
        />
      ) : null}

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
                  <PendingImportRow
                    discarding={discardingId === pendingImport.id}
                    key={pendingImport.id}
                    onDiscard={setDiscardTarget}
                    pendingImport={pendingImport}
                  />
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

function PendingImportRow({ discarding, onDiscard, pendingImport }) {
  const canDiscard = pendingImport.review_status === "pending_review";
  const discardLabel = `Discard pending booking for ${pendingImport.student_name || "unnamed student"}`;

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
        <div className="table-actions pending-import-actions">
          <Link
            aria-label="Review"
            className="primary-button action-icon-button pending-import-action-link"
            href={`/trial-lessons/imports/review/?id=${pendingImport.id}`}
            title="Review"
          >
            <PendingImportIcon name="eye" />
          </Link>
          {canDiscard ? (
            <button
              aria-label={discardLabel}
              className="danger-button action-icon-button pending-import-action-link"
              disabled={discarding}
              onClick={() => onDiscard(pendingImport)}
              title="Discard pending booking"
              type="button"
            >
              <PendingImportIcon name="trash" />
            </button>
          ) : null}
        </div>
      </td>
    </tr>
  );
}

function DiscardPendingImportDialog({ booking, onCancel, onConfirm }) {
  const studentName = booking.student_name || "this pending booking";

  return (
    <div className="modal-backdrop" role="presentation">
      <section
        aria-describedby="discard-pending-booking-description"
        aria-labelledby="discard-pending-booking-title"
        aria-modal="true"
        className="communication-modal confirmation-modal"
        role="dialog"
      >
        <header className="communication-modal-header">
          <h2 id="discard-pending-booking-title">Discard pending booking?</h2>
        </header>
        <div className="confirmation-modal-body">
          <p id="discard-pending-booking-description">
            This will remove {studentName} from the Pending Bookings list. It will not delete the original Gmail message,
            any Trial Lesson, or any student/customer CRM record.
          </p>
        </div>
        <div className="form-actions confirmation-modal-actions">
          <button className="secondary-button" onClick={onCancel} type="button">
            Cancel
          </button>
          <button className="danger-button" onClick={onConfirm} type="button">
            Discard pending booking
          </button>
        </div>
      </section>
    </div>
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
    )
  };

  return (
    <svg aria-hidden="true" className="action-icon" focusable="false" viewBox="0 0 24 24">
      {icons[name]}
    </svg>
  );
}
