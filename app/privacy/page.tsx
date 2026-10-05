import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy · My Wine Experience",
  description: "How My Wine Experience handles your journal, media, and AI enrichment.",
};

export default function PrivacyPage() {
  return <main className="privacy-page"><Link className="privacy-back" href="/">← Back to My Wine Experience</Link><p className="eyebrow">MY WINE EXPERIENCE · PRIVACY</p><h1>Your memories<br /><em>stay yours.</em></h1><p className="privacy-lead">This journal is personal by design. We collect only what is needed to help you remember a tasting and keep your data under your control.</p><section><h2>What you save</h2><p>Your experiences, farm selections, wine reactions, notes, photos, and optional voice recordings belong to your account. Precise location and timestamps are private experience metadata and are not shown publicly.</p></section><section><h2>Audio and photos</h2><p>Audio is a capture input first. When transcription and enrichment succeed, original audio can be deleted by default. If you choose to keep original recordings, they remain available in your account. Failed processing never silently removes the only source capture.</p></section><section><h2>AI processing</h2><p>When enabled, captured media is sent to the configured Gemini service to transcribe and suggest wine details. Suggestions are marked as suggestions until you confirm or edit them. The original media remains the source of truth.</p></section><section><h2>Your choices</h2><p>You can use the journal offline, export a local JSON copy, and delete the journal saved on your device. With a connected Firebase account, cloud deletion and export should be handled through the account controls and remove associated media.</p></section><section><h2>Private by default</h2><p>My Wine Experience is not a public review feed, marketplace, or social network. We do not publish your ratings, notes, recordings, or wine preferences.</p></section></main>;
}
