"use client";

import { useState } from "react";
import {
  sendPasswordlessLink,
  signInWithEmail,
  signInWithGoogle,
  signUpWithEmail,
} from "../lib/auth";
import { firebaseEnabled } from "../lib/firebase";

type AccountAccessProps = {
  onAuthenticated: () => void;
};

export default function AccountAccess({ onAuthenticated }: AccountAccessProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"sign-in" | "sign-up" | "magic">("sign-up");
  const [message, setMessage] = useState("");

  if (!firebaseEnabled) {
    return (
      <div className="account-status">
        <span className="sync-dot" />
        <div>
          <strong>Sign-in is not available yet</strong>
          <p>Firebase needs to be configured for this environment.</p>
        </div>
      </div>
    );
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setMessage("");
    try {
      if (mode === "sign-in") {
        await signInWithEmail(email, password);
        onAuthenticated();
      } else if (mode === "sign-up") {
        await signUpWithEmail(email, password);
        onAuthenticated();
      } else {
        await sendPasswordlessLink(email);
        setMessage("Check your email for a secure sign-in link.");
      }
    } catch {
      setMessage("That did not work. Check your details and try again.");
    }
  }

  async function continueWithGoogle() {
    setMessage("");
    try {
      const result = await signInWithGoogle();
      if (result) onAuthenticated();
    } catch {
      setMessage("Google sign-in did not work. Please try again.");
    }
  }

  return (
    <form className="account-form" onSubmit={submit}>
      <div className="account-form-heading">
        <strong>
          {mode === "sign-in"
            ? "Welcome back"
            : mode === "sign-up"
              ? "Create your private journal"
              : "Email me a sign-in link"}
        </strong>
        {mode !== "magic" && (
          <button
            type="button"
            onClick={() => setMode(mode === "sign-in" ? "sign-up" : "sign-in")}
          >
            {mode === "sign-in" ? "Create account" : "I already have one"}
          </button>
        )}
      </div>
      <button className="google-button" type="button" onClick={() => void continueWithGoogle()}>
        <span className="google-mark" aria-hidden="true">G</span>
        Continue with Google
      </button>
      <div className="auth-divider" aria-hidden="true"><span>or</span></div>
      <input
        type="email"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        placeholder="Email address"
        required
      />
      {mode !== "magic" && (
        <input
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder="Password"
          minLength={6}
          required
        />
      )}
      <button className="primary-button">
        {mode === "sign-in"
          ? "Sign in"
          : mode === "sign-up"
            ? "Create account"
            : "Send secure link"}
        <span aria-hidden="true">→</span>
      </button>
      {mode === "magic" ? (
        <button type="button" className="text-button" onClick={() => setMode("sign-in")}>
          Use email and password instead
        </button>
      ) : (
        <button type="button" className="text-button" onClick={() => setMode("magic")}>
          Use a passwordless email link
        </button>
      )}
      {message && <p className="form-message">{message}</p>}
    </form>
  );
}
