"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import AccountAccess from "../components/account-access";
import { completeGoogleRedirectSignIn, completePasswordlessSignIn, observeUser } from "../lib/auth";
import { auth, firebaseEnabled } from "../lib/firebase";

export default function LandingPage() {
  const router = useRouter();
  const [checkingSession, setCheckingSession] = useState(() => firebaseEnabled);

  useEffect(() => {
    if (!firebaseEnabled) {
      return;
    }

    let redirectPending = true;
    let active = true;
    const unsubscribe = observeUser((user) => {
      if (!active) return;
      if (user) router.replace("/app");
      else if (!redirectPending) setCheckingSession(false);
    });

    void Promise.all([
      completeGoogleRedirectSignIn(),
      completePasswordlessSignIn(),
    ]).then(([googleResult, emailResult]) => {
      const redirectedUser = googleResult?.user ?? emailResult?.user;
      if (redirectedUser) router.replace("/app");
    }).catch(() => undefined).finally(() => {
      redirectPending = false;
      if (active && !auth?.currentUser) setCheckingSession(false);
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, [router]);

  return (
    <main className="landing-shell">
      <header className="landing-header">
        <div className="brand-mark" aria-label="Kept"><span>Kept</span><span>Wine memories, kept close</span></div>
      </header>

      <section className="landing-hero" aria-labelledby="landing-title">
        <div className="landing-copy">
          <p className="eyebrow">YOUR PRIVATE WINE JOURNAL</p>
          <h1 id="landing-title">Remember the bottles.<br /><em>Keep the feeling.</em></h1>
          <p className="landing-lead">Kept is a quiet place to save the wines, people, and places that made a day worth remembering.</p>
          <div className="landing-art-row">
            <a className="landing-cta" href="#account">Start keeping <span aria-hidden="true">→</span></a>
            <div className="pour-ripple-mark" aria-hidden="true"><i /><i /><i /><span>KEPT CLOSE</span></div>
          </div>
          <p className="landing-reassurance">Private by default. Your wine memories are yours.</p>
        </div>
        <aside className="landing-card" id="account" aria-label="Create or sign in to your private journal">
          {checkingSession ? <p className="landing-checking">Checking your journal…</p> : <AccountAccess onAuthenticated={() => router.replace("/app")} />}
        </aside>
      </section>

      <section className="landing-how" aria-labelledby="how-it-works">
        <p className="eyebrow">HOW IT WORKS</p>
        <h2 id="how-it-works">One good day,<br /><em>kept close.</em></h2>
        <div className="landing-steps">
          <article><span>01</span><h3>Place</h3><p>Choose a farm, a table, or the comfort of home.</p></article>
          <article><span>02</span><h3>Pour</h3><p>Keep as much or as little of the wine as feels right.</p></article>
          <article><span>03</span><h3>Revisit</h3><p>Return to the bottles and moments you want to keep close.</p></article>
        </div>
      </section>

      <footer className="landing-footer">
        <span>KEPT · PRIVATE WINE JOURNAL</span>
        <Link href="/privacy">Privacy and your data</Link>
      </footer>
    </main>
  );
}
