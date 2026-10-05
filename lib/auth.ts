import {
  createUserWithEmailAndPassword,
  isSignInWithEmailLink,
  linkWithPopup,
  OAuthProvider,
  onAuthStateChanged,
  sendSignInLinkToEmail,
  signInWithEmailLink,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  type User,
} from "firebase/auth";
import { auth, firebaseEnabled } from "./firebase";

function requireAuth() {
  if (!firebaseEnabled || !auth) throw new Error("Firebase Authentication is not configured for this environment.");
  return auth;
}

export function observeUser(callback: (user: User | null) => void) {
  if (!firebaseEnabled || !auth) return () => undefined;
  return onAuthStateChanged(auth, callback);
}

export async function signUpWithEmail(email: string, password: string) {
  return createUserWithEmailAndPassword(requireAuth(), email, password);
}

export async function signInWithEmail(email: string, password: string) {
  return signInWithEmailAndPassword(requireAuth(), email, password);
}

export async function sendPasswordlessLink(email: string) {
  const actionCodeSettings = { url: window.location.origin, handleCodeInApp: true };
  await sendSignInLinkToEmail(requireAuth(), email, actionCodeSettings);
  window.localStorage.setItem("my-wine-email-for-sign-in", email);
}

export async function completePasswordlessSignIn() {
  const configuredAuth = requireAuth();
  if (!isSignInWithEmailLink(configuredAuth, window.location.href)) return null;
  const email = window.localStorage.getItem("my-wine-email-for-sign-in");
  if (!email) return null;
  const result = await signInWithEmailLink(configuredAuth, email, window.location.href);
  window.localStorage.removeItem("my-wine-email-for-sign-in");
  return result;
}

export async function signInWithApple() {
  const configuredAuth = requireAuth();
  const provider = new OAuthProvider("apple.com");
  return configuredAuth.currentUser
    ? linkWithPopup(configuredAuth.currentUser, provider)
    : signInWithPopup(configuredAuth, provider);
}

export async function signOutUser() {
  return signOut(requireAuth());
}
