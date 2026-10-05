"use client";

import { useCallback, useEffect, useState } from "react";
import { DataSurface, SurfaceHeader } from "@/components/Surface";
import {
  disableStaffAvailabilityBlock,
  disableStaffAvailabilityWindow,
  fetchStaffCapacity,
  saveStaffAvailabilityBlock,
  saveStaffAvailabilityWindow,
  setStaffCoachingEnabled,
  setStaffCoachingProgram
} from "@/lib/data";
import { getSupabaseBrowserClient } from "@/lib/supabase";
import { isValidLocalInterval } from "@/lib/staff-capacity";

const weekdays = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const emptyWindow = { id: "", schoolId: "", weekday: "0", startTime: "12:00", endTime: "21:00" };
const emptyBlock = { schoolId: "", localDate: "", startTime: "", endTime: "", reason: "" };

export function StaffCapacityEditor({ staff }) {
  const assignments = (staff.staff_school_assignments || []).filter((row) => row.status === "active" && row.schools?.status === "active");
  const [capacity, setCapacity] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [windowForm, setWindowForm] = useState({ ...emptyWindow, schoolId: assignments[0]?.school_id || "" });
  const [blockForm, setBlockForm] = useState({ ...emptyBlock, schoolId: assignments[0]?.school_id || "" });

  const load = useCallback(async () => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return null;
    return fetchStaffCapacity(supabase, staff.id);
  }, [staff.id]);

  useEffect(() => {
    let active = true;
    load().then((result) => {
      if (!active || !result) return;
      setCapacity(result.data);
      setError(result.error?.message || "");
    });
    return () => { active = false; };
  }, [load]);

  async function run(action) {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;
    setBusy(true);
    setError("");
    try {
      const result = await action(supabase);
      if (result.error) throw result.error;
      const refreshed = await load();
      if (refreshed?.error) throw refreshed.error;
      if (refreshed) setCapacity(refreshed.data);
      return true;
    } catch (cause) {
      setError(cause.message || "Could not save staff capacity.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function saveWindow(event) {
    event.preventDefault();
    if (!windowForm.schoolId || !isValidLocalInterval(windowForm.startTime, windowForm.endTime)) {
      setError("Choose a school and an end time after the start time.");
      return;
    }
    if (await run((supabase) => saveStaffAvailabilityWindow(supabase, staff, windowForm))) {
      setWindowForm({ ...emptyWindow, schoolId: windowForm.schoolId });
    }
  }

  async function saveBlock(event) {
    event.preventDefault();
    if (!blockForm.schoolId || !blockForm.localDate || !isValidLocalInterval(blockForm.startTime, blockForm.endTime)) {
      setError("Choose a school, date, and an end time after the start time.");
      return;
    }
    if (await run((supabase) => saveStaffAvailabilityBlock(supabase, staff, blockForm))) {
      setBlockForm({ ...emptyBlock, schoolId: blockForm.schoolId });
    }
  }

  async function toggleProgram(programId, eligible) {
    await run(async (supabase) => {
      if (!capacity.hasSettings) {
        const setup = await setStaffCoachingEnabled(supabase, staff, false);
        if (setup.error) return setup;
      }
      return setStaffCoachingProgram(supabase, staff, programId, eligible);
    });
  }

  function schoolName(schoolId) {
    const assignment = assignments.find((row) => row.school_id === schoolId);
    return `${assignment?.schools?.name || "School"} (${assignment?.schools?.timezone || "timezone not set"})`;
  }

  return (
    <DataSurface className="span-two">
      <SurfaceHeader><h2>Internal Coaching and availability</h2></SurfaceHeader>
      <p>Times and block dates are local to each school. These windows do not account for lessons or bookings.</p>
      {error ? <p className="inline-alert" role="alert">{error}</p> : null}
      {!capacity ? <p>Loading capacity...</p> : (
        <>
          <label className="primary-check">
            <input type="checkbox" checked={capacity.enabled} disabled={busy}
              onChange={(event) => run((supabase) => setStaffCoachingEnabled(supabase, staff, event.target.checked))} />
            Coaching enabled
          </label>
          <h3>Eligible programs</h3>
          <div className="form-grid">
            {capacity.programs.map((program) => (
              <label className="primary-check" key={program.id}>
                <input type="checkbox" disabled={busy}
                  checked={capacity.eligibleProgramIds.includes(program.id)}
                  onChange={(event) => toggleProgram(program.id, event.target.checked)} />
                {program.label}
              </label>
            ))}
          </div>

          <h3>Recurring availability</h3>
          {capacity.windows.length ? (
            <ul className="stack-list">
              {capacity.windows.map((window) => (
                <li className="list-card" key={window.id}>
                  {schoolName(window.school_id)}: {weekdays[window.weekday]} {window.start_time.slice(0, 5)}–{window.end_time.slice(0, 5)}
                  <div className="form-actions">
                    <button type="button" className="secondary-button" disabled={busy}
                      onClick={() => setWindowForm({ id: window.id, schoolId: window.school_id, weekday: String(window.weekday), startTime: window.start_time.slice(0, 5), endTime: window.end_time.slice(0, 5) })}>Edit</button>
                    <button type="button" className="secondary-button" disabled={busy}
                      onClick={() => run((supabase) => disableStaffAvailabilityWindow(supabase, staff.id, window.id))}>Remove</button>
                  </div>
                </li>
              ))}
            </ul>
          ) : <p>No recurring availability entered.</p>}
          <form onSubmit={saveWindow}>
            <div className="form-grid">
              <label>School<select required value={windowForm.schoolId} onChange={(event) => setWindowForm({ ...windowForm, schoolId: event.target.value })}>
                <option value="">Select school</option>{assignments.map((row) => <option key={row.school_id} value={row.school_id}>{schoolName(row.school_id)}</option>)}
              </select></label>
              <label>Weekday<select value={windowForm.weekday} onChange={(event) => setWindowForm({ ...windowForm, weekday: event.target.value })}>
                {weekdays.map((day, index) => <option key={day} value={index}>{day}</option>)}
              </select></label>
              <label>Start<input required type="time" value={windowForm.startTime} onChange={(event) => setWindowForm({ ...windowForm, startTime: event.target.value })} /></label>
              <label>End<input required type="time" value={windowForm.endTime} onChange={(event) => setWindowForm({ ...windowForm, endTime: event.target.value })} /></label>
            </div>
            <div className="form-actions">
              {windowForm.id ? <button type="button" className="secondary-button" onClick={() => setWindowForm({ ...emptyWindow, schoolId: windowForm.schoolId })}>Cancel edit</button> : null}
              <button type="submit" className="primary-button" disabled={busy || !assignments.length}>{windowForm.id ? "Save window" : "Add window"}</button>
            </div>
          </form>

          <h3>One-off blocks</h3>
          {capacity.blocks.length ? <ul className="stack-list">{capacity.blocks.map((block) => (
            <li className="list-card" key={block.id}>
              {schoolName(block.school_id)}: {block.local_date} {block.start_time.slice(0, 5)}–{block.end_time.slice(0, 5)}{block.reason ? ` — ${block.reason}` : ""}
              <button type="button" className="secondary-button" disabled={busy}
                onClick={() => run((supabase) => disableStaffAvailabilityBlock(supabase, staff.id, block.id))}>Remove</button>
            </li>
          ))}</ul> : <p>No blocks entered.</p>}
          <form onSubmit={saveBlock}>
            <div className="form-grid">
              <label>School<select required value={blockForm.schoolId} onChange={(event) => setBlockForm({ ...blockForm, schoolId: event.target.value })}>
                <option value="">Select school</option>{assignments.map((row) => <option key={row.school_id} value={row.school_id}>{schoolName(row.school_id)}</option>)}
              </select></label>
              <label>Local date<input required type="date" value={blockForm.localDate} onChange={(event) => setBlockForm({ ...blockForm, localDate: event.target.value })} /></label>
              <label>Start<input required type="time" value={blockForm.startTime} onChange={(event) => setBlockForm({ ...blockForm, startTime: event.target.value })} /></label>
              <label>End<input required type="time" value={blockForm.endTime} onChange={(event) => setBlockForm({ ...blockForm, endTime: event.target.value })} /></label>
              <label>Reason (optional)<input value={blockForm.reason} onChange={(event) => setBlockForm({ ...blockForm, reason: event.target.value })} /></label>
            </div>
            <button type="submit" className="primary-button" disabled={busy || !assignments.length}>Add block</button>
          </form>
        </>
      )}
    </DataSurface>
  );
}
