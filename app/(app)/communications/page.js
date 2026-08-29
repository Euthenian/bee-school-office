"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { DataSurface, ResponsiveTable } from "@/components/Surface";
import { useAuth } from "@/components/AuthProvider";
import { fetchCommunications } from "@/lib/data";
import { formatDateTime, humanize } from "@/lib/format";
import { canManageCommunications } from "@/lib/roles";
import { getSupabaseBrowserClient } from "@/lib/supabase";

export default function CommunicationsPage() {
  return (
    <Suspense fallback={<CommunicationsLoading />}>
      <CommunicationsContent />
    </Suspense>
  );
}

function CommunicationsContent() {
  const { loading: authLoading, profile, session } = useAuth();
  const searchParams = useSearchParams();
  const studentId = searchParams.get("studentId") || "";
  const prospectId = searchParams.get("prospectId") || "";
  const trialLessonId = searchParams.get("trialLessonId") || "";
  const mayCommunicate = canManageCommunications(profile);
  const [state, setState] = useState({ communications: [], error: "", loading: true });

  useEffect(() => {
    let active = true;

    async function loadCommunications() {
      const supabase = getSupabaseBrowserClient();
      if (!supabase || !session || authLoading) {
        setState((current) => ({ ...current, loading: Boolean(authLoading) }));
        return;
      }

      if (!mayCommunicate) {
        setState({ communications: [], error: "", loading: false });
        return;
      }

      setState((current) => ({ ...current, loading: true }));
      const { data, error } = await fetchCommunications(supabase, {
        prospectId,
        studentId,
        trialLessonId
      });
      if (!active) return;

      setState({
        communications: data || [],
        error: error ? error.message : "",
        loading: false
      });
    }

    loadCommunications();

    return () => {
      active = false;
    };
  }, [authLoading, mayCommunicate, prospectId, session, studentId, trialLessonId]);

  if (state.loading) {
    return <CommunicationsLoading />;
  }

  if (!mayCommunicate) {
    return (
      <>
        <PageHeader eyebrow="Communications" title="Communication history" />
        <EmptyState title="Not available for this role" description="Communication history is restricted to administrative roles." />
      </>
    );
  }

  return (
    <>
      <PageHeader
        eyebrow="Communications"
        title="Communication history"
        description="Outbound customer messages recorded through Bee School Office."
        actions={
          studentId ? (
            <Link className="secondary-button" href={`/students/profile/?id=${studentId}`}>
              Back to student
            </Link>
          ) : null
        }
      />

      {state.error ? <p className="inline-alert">{state.error}</p> : null}

      <DataSurface aria-label="Communication history">
        {state.communications.length ? (
          <ResponsiveTable>
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Type</th>
                  <th>Recipient</th>
                  <th>Subject</th>
                  <th>Source</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {state.communications.map((communication) => (
                  <tr key={communication.id}>
                    <td>{formatDateTime(communication.sent_at || communication.created_at)}</td>
                    <td>{humanize(communication.communication_type)}</td>
                    <td>{communication.recipient || "No recipient"}</td>
                    <td>{communication.subject || "No subject"}</td>
                    <td>{humanize(communication.source)}</td>
                    <td>
                      <StatusBadge value={communication.delivery_status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ResponsiveTable>
        ) : (
          <EmptyState title="No communication history" description="Messages queued or sent from Bee School Office will appear here." />
        )}
      </DataSurface>
    </>
  );
}

function CommunicationsLoading() {
  return (
    <>
      <PageHeader eyebrow="Communications" title="Communication history" />
      <div className="table-placeholder">Loading communication history...</div>
    </>
  );
}
