// The Supabase client owns the live access token. React consumers only use the
// session for signed-in identity, so token recovery must not reset page state.
export function shouldReplaceVisibleSession(currentSession, nextSession, event) {
  if (event === "USER_UPDATED") return true;
  return currentSession?.user?.id !== nextSession?.user?.id;
}
