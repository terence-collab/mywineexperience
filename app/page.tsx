"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import AccountAccess from "../components/account-access";
import { completeGoogleRedirectSignIn, completePasswordlessSignIn, observeUser } from "../lib/auth";
import { firebaseEnabled } from "../lib/firebase";

export default function LandingPage() {
  const router = useRouter();
  const [checkingSession, setCheckingSession] = useState(() => firebaseEnabled);

  useEffect(() => {
    void completePasswordlessSignIn().catch(() => undefined);
    void completeGoogleRedirectSignIn().catch(() => undefined);
    if (!firebaseEnabled) {
      return;
    }
    return observeUser((user) => {
      if (user) router.replace("/app");
      else setCheckingSession(false);
    });
  }, [router]);

  return (
    <main className="landing-shell">
      <header className="landing-header">
        <div className="brand-mark" aria-label="My Wine Experience"><span>MY</span><span>WINE</span></div>
        <a className="landing-sign-in" href="#account">Sign in</a>
      </header>

      <section className="landing-hero" aria-labelledby="landing-title">
        <div className="landing-copy">
          <p className="eyebrow">A PRIVATE WINE JOURNAL</p>
          <h1 id="landing-title">Remember the bottles.<br /><em>Keep the feeling.</em></h1>
          <p className="landing-lead">My Wine Experience is a quiet place to save the wines, people and places that made a day worth remembering.</p>
          <a className="landing-cta" href="#account">Start your journal <span aria-hidden="true">→</span></a>
          <p className="landing-reassurance">Private by default. Your tasting memories stay yours.</p>
        </div>
        <aside className="landing-card" id="account" aria-label="Create or sign in to your private journal">
          {checkingSession ? <p className="landing-checking">Checking your journal…</p> : <AccountAccess onAuthenticated={() => router.replace("/app")} />}
        </aside>
      </section>

      <section className="landing-how" aria-labelledby="how-it-works">
        <p className="eyebrow">HOW IT WORKS</p>
        <h2 id="how-it-works">One good day,<br /><em>kept close.</em></h2>
        <div className="landing-steps">
          <article><span>01</span><h3>Taste</h3><p>Choose a farm, a table, or a bottle at home.</p></article>
          <article><span>02</span><h3>Capture</h3><p>Photograph, record, and note what made it memorable.</p></article>
          <article><span>03</span><h3>Remember</h3><p>Return to the wines and places you want to keep close.</p></article>
        </div>
      </section>

      <footer className="landing-footer">
        <span>MY WINE EXPERIENCE</span>
        <Link href="/privacy">Privacy and your data</Link>
      </footer>
    </main>
  );
}
