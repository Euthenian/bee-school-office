"use client";

import { useEffect, useState } from "react";
import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { DataSurface, ResponsiveTable } from "@/components/Surface";
import { useAuth } from "@/components/AuthProvider";
import { fetchUsers } from "@/lib/data";
import { formatDate, formatUserRoles } from "@/lib/format";
import { getSupabaseBrowserClient } from "@/lib/supabase";

export default function UsersPage() {
  const { session } = useAuth();
  const [state, setState] = useState({ loading: true, error: "", users: [] });

  useEffect(() => {
    let active = true;

    async function loadUsers() {
      const supabase = getSupabaseBrowserClient();
      if (!supabase || !session) {
        setState({ loading: false, error: "", users: [] });
        return;
      }

      const { data, error } = await fetchUsers(supabase);
      if (!active) return;

      setState({
        loading: false,
        error: error ? error.message : "",
        users: data || []
      });
    }

    loadUsers();

    return () => {
      active = false;
    };
  }, [session]);

  return (
    <>
      <PageHeader
        eyebrow="Access foundation"
        title="Users"
        description="Profiles and role memberships are separated so people can belong to organizations and schools independently."
      />

      {state.error ? <p className="inline-alert">{state.error}</p> : null}

      <DataSurface aria-label="Users list">
        {state.loading ? (
          <div className="table-placeholder">Loading users...</div>
        ) : state.users.length ? (
          <ResponsiveTable>
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Status</th>
                  <th>Roles</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {state.users.map((user) => (
                  <tr key={user.id}>
                    <td>{user.full_name || "Unnamed user"}</td>
                    <td>{user.email || "No email"}</td>
                    <td>
                      <StatusBadge value={user.status} />
                    </td>
                    <td>{formatUserRoles(user)}</td>
                    <td>{formatDate(user.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ResponsiveTable>
        ) : (
          <EmptyState title="No readable users" description="User profiles will appear after Auth users and memberships are created." />
        )}
      </DataSurface>
    </>
  );
}
