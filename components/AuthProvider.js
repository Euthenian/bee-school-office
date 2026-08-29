"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { loadProfile } from "@/lib/auth-profile";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const configured = isSupabaseConfigured();
  const [loading, setLoading] = useState(configured);
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [profileError, setProfileError] = useState("");

  const refreshProfile = useCallback(async (userId) => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase || !userId) {
      setProfile(null);
      return;
    }

    const { data, error } = await loadProfile(supabase, userId);
    setProfile(data);
    setProfileError(error ? error.message : "");
  }, []);

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();

    if (!configured || !supabase) {
      return undefined;
    }

    let mounted = true;

    async function hydrateSession() {
      const { data, error } = await supabase.auth.getSession();
      if (!mounted) return;

      if (error) {
        setProfileError(error.message);
        setLoading(false);
        return;
      }

      setSession(data.session);
      if (data.session?.user) {
        await refreshProfile(data.session.user.id);
      }
      if (mounted) {
        setLoading(false);
      }
    }

    hydrateSession();

    const {
      data: { subscription }
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      if (nextSession?.user) {
        refreshProfile(nextSession.user.id);
      } else {
        setProfile(null);
        setProfileError("");
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [configured, refreshProfile]);

  const signOut = useCallback(async () => {
    const supabase = getSupabaseBrowserClient();
    if (supabase) {
      await supabase.auth.signOut();
    }
    setSession(null);
    setProfile(null);
  }, []);

  const value = useMemo(
    () => ({
      configured,
      loading,
      profile,
      profileError,
      refreshProfile,
      session,
      signOut
    }),
    [configured, loading, profile, profileError, refreshProfile, session, signOut]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return value;
}
