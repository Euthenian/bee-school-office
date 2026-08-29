"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { LoadingScreen } from "@/components/LoadingScreen";
import { useAuth } from "@/components/AuthProvider";

export default function HomePage() {
  const router = useRouter();
  const { configured, loading, session } = useAuth();

  useEffect(() => {
    if (!loading) {
      router.replace(configured && session ? "/dashboard/" : "/login/");
    }
  }, [configured, loading, router, session]);

  return <LoadingScreen label="Opening Bee School Office" />;
}
