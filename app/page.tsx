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
        <div className="brand-mark" aria-label="My Wine Experience"><span>My Wine</span><span>Experience</span></div>
      </header>

      <section className="landing-hero" aria-labelledby="landing-title">
        <div className="landing-copy">
          <p className="eyebrow">A PRIVATE WINE JOURNAL</p>
          <h1 id="landing-title">Remember the bottles.<br /><em>Keep the feeling.</em></h1>
          <p className="landing-lead">My Wine Experience is a quiet place to save the wines, people and places that made a day worth remembering.</p>
          <div className="landing-art-row">
            <a className="landing-cta" href="#account">Start your journal <span aria-hidden="true">→</span></a>
            <div className="wine-bottle-art" aria-hidden="true">
              <svg viewBox="0 0 180 250" role="presentation">
                <path d="M74 20h32M79 20v28c0 9-8 17-16 27-9 12-13 28-13 51v87c0 9 7 16 16 16h38c9 0 16-7 16-16v-87c0-23-4-39-13-51-8-10-16-18-16-27V20" />
                <path d="M65 77c13 7 37 7 50 0M52 139c20 7 56 7 76 0M55 171c18 6 52 6 70 0" />
                <path d="M72 105c-16-15-30-17-42-8 12 5 22 13 28 25M108 105c16-15 30-17 42-8-12 5-22 13-28 25" />
                <path d="M73 129c-12 8-14 22-7 31 9-2 16-9 18-19M107 129c12 8 14 22 7 31-9-2-16-9-18-19" />
                <rect x="66" y="145" width="48" height="48" rx="4" />
                <path d="M78 166h24M82 175h16" />
              </svg>
              <span>KEEP THE POUR</span>
            </div>
          </div>
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
