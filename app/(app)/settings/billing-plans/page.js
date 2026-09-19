"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";
import { DataSurface, ResponsiveTable, SurfaceHeader } from "@/components/Surface";
import { useAuth } from "@/components/AuthProvider";
import {
  createBillingPlan,
  fetchBillingPlans,
  fetchOrganizations,
  fetchSchools,
  setBillingPlanActive,
  updateBillingPlan
} from "@/lib/data";
import { formatBillingAmount } from "@/lib/billing";
import { canEditStudentFinance } from "@/lib/roles";
import { createBillingPlanForm, validateBillingPlanForm } from "@/lib/billing-plans";
import { getSupabaseBrowserClient } from "@/lib/supabase";

export default function BillingPlansSettingsPage() {
  const { loading: authLoading, profile, session } = useAuth();
  const mayManage = canEditStudentFinance(profile);
  const [foundation, setFoundation] = useState({ loading: true, organizations: [], schools: [] });
  const [state, setState] = useState({ error: "", loading: true, plans: [], saving: false, success: "" });
  const [filters, setFilters] = useState({ organizationId: "" });
  const [editingId, setEditingId] = useState("");
  const [form, setForm] = useState(createBillingPlanForm({}, { organizationId: "" }));

  useEffect(() => {
    let active = true;

    async function loadFoundation() {
      if (authLoading) return;

      const supabase = getSupabaseBrowserClient();
      if (!supabase || !session || !mayManage) {
        setFoundation({ loading: false, organizations: [], schools: [] });
        setState((current) => ({ ...current, loading: false }));
        return;
      }

      const [organizationsResult, schoolsResult] = await Promise.all([fetchOrganizations(supabase), fetchSchools(supabase)]);
      if (!active) return;

      const organizations = organizationsResult.data || [];
      const schools = schoolsResult.data || [];
      const organizationId = filters.organizationId || organizations[0]?.id || "";

      setFoundation({ loading: false, organizations, schools });
      setFilters((current) => ({ ...current, organizationId }));
      setForm((current) => ({ ...current, organizationId: current.organizationId || organizationId }));

      const error = [organizationsResult.error, schoolsResult.error]
        .filter(Boolean)
        .map((item) => item.message)
        .join(" ");
      if (error) setState((current) => ({ ...current, error, loading: false }));
    }

    loadFoundation();

    return () => {
      active = false;
    };
  }, [authLoading, filters.organizationId, mayManage, session]);

  useEffect(() => {
    let active = true;

    async function loadPlans() {
      const supabase = getSupabaseBrowserClient();
      if (!supabase || !session || !mayManage || !filters.organizationId) {
        setState((current) => ({ ...current, loading: false, plans: [] }));
        return;
      }

      setState((current) => ({ ...current, error: "", loading: true }));
      const result = await fetchBillingPlans(supabase, { organizationId: filters.organizationId });
      if (!active) return;

      setState((current) => ({
        ...current,
        error: result.error ? result.error.message : "",
        loading: false,
        plans: result.data || []
      }));
    }

    loadPlans();

    return () => {
      active = false;
    };
  }, [filters.organizationId, mayManage, session]);

  const schoolOptions = useMemo(
    () => foundation.schools.filter((school) => school.organization_id === form.organizationId),
    [form.organizationId, foundation.schools]
  );
  const scopeSchools = useMemo(
    () => new Map(foundation.schools.map((school) => [school.id, school])),
    [foundation.schools]
  );

  function updateFilter(field, value) {
    setFilters((current) => ({ ...current, [field]: value }));
    if (field === "organizationId") {
      setEditingId("");
      setForm(createBillingPlanForm({}, { organizationId: value }));
    }
  }

  function updateField(field, value) {
    setForm((current) => ({
      ...current,
      [field]: value,
      ...(field === "organizationId" ? { schoolId: "" } : {})
    }));
  }

  function startEdit(plan) {
    setEditingId(plan.id);
    setForm(createBillingPlanForm(plan, { organizationId: filters.organizationId }));
    setState((current) => ({ ...current, error: "", success: "" }));
  }

  function resetForm() {
    setEditingId("");
    setForm(createBillingPlanForm({}, { organizationId: filters.organizationId }));
  }

  async function reloadPlans(supabase, success = "") {
    const result = await fetchBillingPlans(supabase, { organizationId: filters.organizationId });
    setState((current) => ({
      ...current,
      error: result.error ? result.error.message : "",
      loading: false,
      plans: result.data || [],
      saving: false,
      success
    }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setState((current) => ({ ...current, error: "", success: "" }));

    const validationError = validateBillingPlanForm(form);
    if (validationError) {
      setState((current) => ({ ...current, error: validationError }));
      return;
    }

    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;

    setState((current) => ({ ...current, saving: true }));
    const result = editingId ? await updateBillingPlan(supabase, editingId, form) : await createBillingPlan(supabase, form);
    if (result.error) {
      setState((current) => ({ ...current, error: result.error.message, saving: false }));
      return;
    }

    resetForm();
    await reloadPlans(supabase, editingId ? "Billing Plan updated." : "Billing Plan created.");
  }

  async function handleActiveChange(plan, active) {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;

    setState((current) => ({ ...current, error: "", saving: true, success: "" }));
    const result = await setBillingPlanActive(supabase, plan.id, active);
    if (result.error) {
      setState((current) => ({ ...current, error: result.error.message, saving: false }));
      return;
    }

    await reloadPlans(supabase, active ? "Billing Plan activated." : "Billing Plan deactivated.");
  }

  if (!authLoading && !mayManage) {
    return (
      <>
        <PageHeader eyebrow="Settings" title="Billing Plans" />
        <DataSurface>
          <EmptyState title="Billing Plans are restricted" description="Your current role cannot manage finance configuration." />
        </DataSurface>
      </>
    );
  }

  return (
    <>
      <PageHeader
        eyebrow="Settings"
        title="Billing Plans"
        actions={
          <Link className="secondary-button" href="/settings/">
            Back to settings
          </Link>
        }
      />

      {state.error ? <p className="inline-alert">{state.error}</p> : null}
      {state.success ? <p className="inline-success">{state.success}</p> : null}

      <DataSurface>
        <SurfaceHeader>
          <h2>{editingId ? "Edit Billing Plan" : "Create Billing Plan"}</h2>
        </SurfaceHeader>
        <form className="student-form" onSubmit={handleSubmit}>
          <div className="form-grid">
            <label>
              Organization
              <select onChange={(event) => updateField("organizationId", event.target.value)} value={form.organizationId}>
                {foundation.organizations.map((organization) => (
                  <option key={organization.id} value={organization.id}>
                    {organization.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              School scope
              <select onChange={(event) => updateField("schoolId", event.target.value)} value={form.schoolId}>
                <option value="">Organization-wide</option>
                {schoolOptions.map((school) => (
                  <option key={school.id} value={school.id}>
                    {school.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Name
              <input onChange={(event) => updateField("name", event.target.value)} value={form.name} />
            </label>
            <label>
              Monthly fee
              <input
                inputMode="numeric"
                maxLength="6"
                onChange={(event) => updateField("monthlyFeeYen", event.target.value)}
                pattern="[0-9]*"
                value={form.monthlyFeeYen}
              />
            </label>
            <label>
              Sort order
              <input inputMode="numeric" onChange={(event) => updateField("sortOrder", event.target.value)} value={form.sortOrder} />
            </label>
            <label>
              Status
              <select onChange={(event) => updateField("active", event.target.value === "active")} value={form.active ? "active" : "inactive"}>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </label>
          </div>
          <div className="form-actions">
            {editingId ? (
              <button className="secondary-button" onClick={resetForm} type="button">
                Cancel edit
              </button>
            ) : null}
            <button className="primary-button" disabled={state.saving || foundation.loading} type="submit">
              {state.saving ? "Saving..." : editingId ? "Save Billing Plan" : "Create Billing Plan"}
            </button>
          </div>
        </form>
      </DataSurface>

      <DataSurface>
        <SurfaceHeader>
          <h2>Billing Plans</h2>
        </SurfaceHeader>
        <div className="form-grid">
          <label>
            Organization
            <select onChange={(event) => updateFilter("organizationId", event.target.value)} value={filters.organizationId}>
              {foundation.organizations.map((organization) => (
                <option key={organization.id} value={organization.id}>
                  {organization.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        {state.loading ? (
          <div className="table-placeholder">Loading Billing Plans...</div>
        ) : state.plans.length ? (
          <ResponsiveTable>
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Monthly fee</th>
                  <th>Scope</th>
                  <th>Status</th>
                  <th>Sort order</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {state.plans.map((plan) => (
                  <tr key={plan.id}>
                    <td>{plan.name}</td>
                    <td>{formatBillingAmount(plan.monthly_fee_yen, "JPY")}</td>
                    <td>{plan.school_id ? scopeSchools.get(plan.school_id)?.name || "School-specific" : "Organization-wide"}</td>
                    <td><span className={`status-badge ${plan.active ? "active" : "inactive"}`}>{plan.active ? "active" : "inactive"}</span></td>
                    <td>{plan.sort_order}</td>
                    <td>
                      <div className="table-actions">
                        <button className="secondary-button" onClick={() => startEdit(plan)} type="button">
                          Edit
                        </button>
                        <button className="secondary-button" onClick={() => handleActiveChange(plan, !plan.active)} type="button">
                          {plan.active ? "Deactivate" : "Activate"}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ResponsiveTable>
        ) : (
          <EmptyState title="No Billing Plans" description="Create the first predefined Billing Plan for this organization." />
        )}
      </DataSurface>
    </>
  );
}
