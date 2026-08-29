"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { DataSurface, ResponsiveTable } from "@/components/Surface";
import { useAuth } from "@/components/AuthProvider";
import { fetchStaffMembers } from "@/lib/data";
import { formatDate, humanize } from "@/lib/format";
import { canManageStaff } from "@/lib/roles";
import { formatStaffAssignmentSummary, formatStaffName, hasTeachingAssignment } from "@/lib/staff";
import { getSupabaseBrowserClient } from "@/lib/supabase";

export default function StaffPage() {
  const { profile, session } = useAuth();
  const mayManage = canManageStaff(profile);
  const [search, setSearch] = useState("");
  const [state, setState] = useState({ loading: true, error: "", staff: [] });

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(async () => {
      const supabase = getSupabaseBrowserClient();
      if (!supabase || !session || !mayManage) {
        setState({ loading: false, error: "", staff: [] });
        return;
      }

      setState((current) => ({ ...current, loading: true }));
      const { data, error } = await fetchStaffMembers(supabase, search);
      if (!active) return;

      setState({
        loading: false,
        error: error ? error.message : "",
        staff: data || []
      });
    }, 180);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [mayManage, search, session]);

  if (!mayManage) {
    return (
      <>
        <PageHeader eyebrow="Staff management" title="Staff" />
        <DataSurface>
          <EmptyState
            title="Staff management is not available"
            description="Your current role can view teaching work but cannot edit staff records."
          />
        </DataSurface>
      </>
    );
  }

  return (
    <>
      <PageHeader
        eyebrow="Staff management"
        title="Staff"
        description="Manage employment identities, school assignments, and teacher eligibility separately from login roles."
        actions={
          <Link className="primary-button" href="/staff/new/">
            Add staff
          </Link>
        }
      />

      <div className="toolbar">
        <label className="search-field">
          <span>Search staff</span>
          <input
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Name, email, phone, school, or status"
            type="search"
            value={search}
          />
        </label>
      </div>

      {state.error ? <p className="inline-alert">{state.error}</p> : null}

      <DataSurface aria-label="Staff list">
        {state.loading ? (
          <div className="table-placeholder">Loading staff...</div>
        ) : state.staff.length ? (
          <ResponsiveTable>
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Status</th>
                  <th>Contact</th>
                  <th>Employment</th>
                  <th>Schools</th>
                  <th>Teacher</th>
                  <th>Start date</th>
                </tr>
              </thead>
              <tbody>
                {state.staff.map((staffMember) => (
                  <tr key={staffMember.id}>
                    <td>
                      <Link href={`/staff/profile/?id=${staffMember.id}`}>{formatStaffName(staffMember)}</Link>
                    </td>
                    <td>
                      <StatusBadge value={staffMember.status} />
                    </td>
                    <td>
                      <div className="table-cell-stack">
                        <span>{staffMember.email || staffMember.profiles?.email || "No email"}</span>
                        <span>{staffMember.phone || "No phone"}</span>
                      </div>
                    </td>
                    <td>{humanize(staffMember.employment_type)}</td>
                    <td>{formatStaffAssignmentSummary(staffMember)}</td>
                    <td>{hasTeachingAssignment(staffMember) ? <span className="status-badge active">Teacher</span> : "No"}</td>
                    <td>{formatDate(staffMember.employment_start_date)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ResponsiveTable>
        ) : (
          <EmptyState title="No staff found" description="No readable staff records matched the current search." />
        )}
      </DataSurface>
    </>
  );
}
