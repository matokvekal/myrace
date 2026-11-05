/**
 * Privacy Policy content (added for Google Play Store submission — Play
 * requires a reachable privacy policy URL even for local-only apps).
 *
 * ⚠️ DRAFT / PLACEHOLDER — NOT reviewed by a lawyer.
 * Have the final wording reviewed by a qualified lawyer before relying on it.
 *
 * Everything rendered on the /privacy page reads from this file.
 *
 * Bump PRIVACY_VERSION whenever the wording changes materially.
 */

export const PRIVACY_VERSION = "2026-08-draft-1";

export const PRIVACY_EFFECTIVE_DATE = "4 August 2026";

export interface PrivacySection {
  heading: string;
  body: string[];
}

export const PRIVACY_SECTIONS: PrivacySection[] = [
  {
    heading: "1. Overview",
    body: [
      "Commissaire is a race-management tool for recording, managing, and displaying results for sporting events, primarily cycling.",
      "By default, Commissaire does not require an account and does not send the race data you enter (riders, laps, times, results) to any server — it is stored locally on your device.",
    ],
  },
  {
    heading: "2. Data stored locally on your device",
    body: [
      "Race, rider, category, and results data you enter is stored in your browser's local database (IndexedDB) and, for some settings, local storage.",
      "This data stays on your device and is not transmitted anywhere unless you explicitly enable optional cloud sync (see below).",
      "Clearing your browser storage, resetting your device, or uninstalling the app permanently deletes this data. You are responsible for your own backups (see the Terms & Conditions).",
    ],
  },
  {
    heading: "3. Optional cloud sync",
    body: [
      "Commissaire may offer an optional cloud-sync feature (built on Supabase) that lets a race be shared between devices and collaborators with assigned roles.",
      "This feature is off unless explicitly configured/enabled for your deployment. When enabled and a user chooses to sync a race, the race data for that race — and the account information needed to authenticate and assign roles (such as an email address) — is sent to and stored by the cloud sync provider.",
      "Data synced this way is used solely to provide the multi-device/multi-user race-management feature and is not sold or used for advertising.",
    ],
  },
  {
    heading: "4. Analytics",
    body: [
      "If analytics is configured for a given deployment, Commissaire may use Firebase Analytics (Google) to collect basic, aggregated usage information such as app opens, feature usage, and approximate device/browser type, to help understand how the app is used and improve it.",
      "Analytics does not include the contents of your race data (rider names, times, results).",
      "Analytics is a no-op and collects nothing when not configured for a given build.",
    ],
  },
  {
    heading: "5. On-device photo/OCR import",
    body: [
      "The optional \"Scan Start List\" photo-import feature processes images entirely on your device using an offline OCR engine (tesseract.js). Photos you scan are not uploaded to any server.",
    ],
  },
  {
    heading: "6. Third-party services",
    body: [
      "Depending on configuration, the app may load resources from third-party services such as Google Fonts/Maps or Firebase. These services may receive standard technical information (such as IP address) as part of normal web requests, subject to their own privacy policies.",
    ],
  },
  {
    heading: "7. Children's privacy",
    body: [
      "Commissaire is an administrative tool intended for event organisers, officials, and staff, not directed at children. Do not enter more personal information about participants than is necessary for the event (see the Terms & Conditions).",
    ],
  },
  {
    heading: "8. Changes to this policy",
    body: [
      "This policy may be updated from time to time. The effective date and version at the top of this page indicate the current version.",
    ],
  },
  {
    heading: "9. Contact",
    body: [
      "Questions about this privacy policy can be sent via the Contact page in the app.",
    ],
  },
];
