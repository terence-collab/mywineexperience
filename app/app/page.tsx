"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import WineDashboard from "../../components/wine-dashboard";
import { observeUser } from "../../lib/auth";
import { firebaseEnabled } from "../../lib/firebase";

export default function AuthenticatedAppPage() {
  const router = useRouter();
  const [resolved, setResolved] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);

  useEffect(() => {
    if (!firebaseEnabled) {
      router.replace("/");
      return;
    }
    return observeUser((user) => {
      setAuthenticated(Boolean(user));
      setResolved(true);
      if (!user) router.replace("/");
    });
  }, [router]);

  if (!resolved || !authenticated) {
    return <main className="auth-loading" aria-live="polite">Opening your private journal…</main>;
  }

  return <WineDashboard />;
}
