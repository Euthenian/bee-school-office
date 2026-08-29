"use client";

import { useEffect, useState } from "react";
import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { DataSurface, ResponsiveTable } from "@/components/Surface";
import { useAuth } from "@/components/AuthProvider";
import { fetchSchools } from "@/lib/data";
import { getSupabaseBrowserClient } from "@/lib/supabase";

export default function SchoolsPage() {
  const { session } = useAuth();
  const [state, setState] = useState({ loading: true, error: "", schools: [] });

  useEffect(() => {
    let active = true;

    async function loadSchools() {
      const supabase = getSupabaseBrowserClient();
      if (!supabase || !session) {
        setState({ loading: false, error: "", schools: [] });
        return;
      }

      const { data, error } = await fetchSchools(supabase);
      if (!active) return;

      setState({
        loading: false,
        error: error ? error.message : "",
        schools: data || []
      });
    }

    loadSchools();

    return () => {
      active = false;
    };
  }, [session]);

  return (
    <>
      <PageHeader
        eyebrow="Locations"
        title="Schools"
        description="School records are scoped to the organization visibility granted by RLS."
      />

      {state.error ? <p className="inline-alert">{state.error}</p> : null}

      <DataSurface aria-label="Schools list">
        {state.loading ? (
          <div className="table-placeholder">Loading schools...</div>
        ) : state.schools.length ? (
          <ResponsiveTable>
            <table>
              <thead>
                <tr>
                  <th>School</th>
                  <th>Organization</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {state.schools.map((school) => (
                  <tr key={school.id}>
                    <td>{school.name}</td>
                    <td>{school.organizations?.name || "Not assigned"}</td>
                    <td>
                      <StatusBadge value={school.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ResponsiveTable>
        ) : (
          <EmptyState title="No readable schools" description="Schools will appear after the Bee School HQ bootstrap is completed." />
        )}
      </DataSurface>
    </>
  );
}
