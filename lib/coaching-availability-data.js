import { calculateCoachingAvailability } from "./coaching-availability.js";

// Call with the authenticated Supabase browser client from an internal screen.
// The RPC checks school permissions before returning any scheduling facts.
export async function fetchInternalCoachingAvailability(supabase, { schoolId, programId, startDate, endDate = startDate }) {
  const { data, error } = await supabase.rpc("get_internal_coaching_availability_facts", {
    p_school_id: schoolId,
    p_program_id: programId,
    p_start_date: startDate,
    p_end_date: endDate
  });
  if (error) return { data: [], error };
  try {
    return { data: calculateCoachingAvailability(data), error: null };
  } catch (cause) {
    return { data: [], error: cause };
  }
}
