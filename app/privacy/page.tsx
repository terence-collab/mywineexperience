import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy · Kept",
  description: "How Kept handles your journal, media, and optional details.",
};

export default function PrivacyPage() {
  return <main className="privacy-page"><Link className="privacy-back" href="/">← Back to Kept</Link><p className="eyebrow">KEPT · PRIVACY</p><h1>Your memories<br /><em>stay yours.</em></h1><p className="privacy-lead">Kept is personal by design. We collect only what is needed to help you remember a wine moment and keep your data under your control.</p><section><h2>What you keep</h2><p>Your tastings, places, feelings, notes, photos, and optional voice recordings belong to your account. Precise location and timestamps are private memory details and are not shown publicly.</p></section><section><h2>Audio and photos</h2><p>Photos and voice notes help you keep a moment in your own words. If details are filled in later, the original capture remains your source of truth.</p></section><section><h2>Details we find</h2><p>When enabled, captured media may be used to suggest wine details. Suggestions stay optional: you can confirm, edit, or leave them for later.</p></section><section><h2>Your choices</h2><p>You can use your journal offline, export a private copy, and delete the memories saved on your device. With a connected account, your journal can sync securely.</p></section><section><h2>Private by default</h2><p>Kept is not a public review feed, marketplace, or scorecard. We do not publish your notes, recordings, ratings, or wine preferences.</p></section></main>;
}
