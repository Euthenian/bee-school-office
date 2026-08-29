export async function loadProfile(supabase, userId) {
  if (!userId) {
    return { data: null, error: null };
  }

  const { data, error } = await supabase
    .from("profiles")
    .select(
      `
        id,
        email,
        full_name,
        status,
        organization_memberships (
          id,
          organization_id,
          role,
          organizations (
            id,
            name,
            type,
            status
          )
        ),
        school_memberships (
          id,
          school_id,
          role,
          schools (
            id,
            name,
            status,
            organization_id
          )
        )
      `
    )
    .eq("id", userId)
    .maybeSingle();

  return { data, error };
}
