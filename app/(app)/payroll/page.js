"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { DataSurface, ResponsiveTable } from "@/components/Surface";
import { useAuth } from "@/components/AuthProvider";
import { fetchPayrollPeriods } from "@/lib/data";
import { formatDate } from "@/lib/format";
import { formatPayrollAmount, getPayrollEntryPaidTotal } from "@/lib/payroll";
import { canManagePayroll } from "@/lib/roles";
import { getSupabaseBrowserClient } from "@/lib/supabase";

export default function PayrollPage() {
  const { profile, session } = useAuth();
  const mayManage = canManagePayroll(profile);
  const [state, setState] = useState({ loading: true, error: "", periods: [] });

  useEffect(() => {
    let active = true;

    async function loadPeriods() {
      const supabase = getSupabaseBrowserClient();
      if (!supabase || !session || !mayManage) {
        setState({ loading: false, error: "", periods: [] });
        return;
      }

      setState((current) => ({ ...current, loading: true }));
      const { data, error } = await fetchPayrollPeriods(supabase);
      if (!active) return;

      setState({
        loading: false,
        error: error ? error.message : "",
        periods: data || []
      });
    }

    loadPeriods();

    return () => {
      active = false;
    };
  }, [mayManage, session]);

  if (!mayManage) {
    return (
      <>
        <PageHeader eyebrow="Restricted admin" title="Payroll" />
        <DataSurface>
          <EmptyState
            title="Payroll is restricted"
            description="Your current role cannot access payroll compensation or payment records."
          />
        </DataSurface>
      </>
    );
  }

  return (
    <>
      <PageHeader
        eyebrow="Restricted admin"
        title="Payroll"
        description="Manage payroll periods, historical entries, and payment records separately from staff profiles."
        actions={
          <Link className="primary-button" href="/payroll/periods/new/">
            New period
          </Link>
        }
      />

      {state.error ? <p className="inline-alert">{state.error}</p> : null}

      <DataSurface aria-label="Payroll periods">
        {state.loading ? (
          <div className="table-placeholder">Loading payroll periods...</div>
        ) : state.periods.length ? (
          <ResponsiveTable>
            <table>
              <thead>
                <tr>
                  <th>Period</th>
                  <th>Scope</th>
                  <th>Status</th>
                  <th>Entries</th>
                  <th>Gross</th>
                  <th>Net payable</th>
                  <th>Paid</th>
                </tr>
              </thead>
              <tbody>
                {state.periods.map((period) => {
                  const totals = getPeriodTotals(period);

                  return (
                    <tr key={period.id}>
                      <td>
                        <Link href={`/payroll/periods/detail/?id=${period.id}`}>
                          {formatDate(period.period_start)} - {formatDate(period.period_end)}
                        </Link>
                      </td>
                      <td>{period.scope === "school" ? period.schools?.name || "School" : period.organizations?.name || "Organization"}</td>
                      <td>
                        <StatusBadge value={period.status} />
                      </td>
                      <td>{period.payroll_entries?.length || 0}</td>
                      <td>{formatPayrollAmount(totals.gross, totals.currency)}</td>
                      <td>{formatPayrollAmount(totals.net, totals.currency)}</td>
                      <td>{formatPayrollAmount(totals.paid, totals.currency)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </ResponsiveTable>
        ) : (
          <EmptyState title="No payroll periods" description="Create a payroll period before adding staff payroll entries." />
        )}
      </DataSurface>
    </>
  );
}

function getPeriodTotals(period) {
  const entries = period?.payroll_entries || [];
  const currency = entries[0]?.currency || "JPY";

  return entries.reduce(
    (totals, entry) => ({
      currency,
      gross: totals.gross + Number(entry.gross_amount || 0),
      net: totals.net + Number(entry.net_payable || 0),
      paid: totals.paid + getPayrollEntryPaidTotal(entry)
    }),
    { currency, gross: 0, net: 0, paid: 0 }
  );
}
