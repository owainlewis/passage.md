import type { Metadata } from "next";
import { PolicyPage, SupportLink } from "../legal";

export const metadata: Metadata = {
  title: "Privacy Policy | passage.md",
  description: "How passage.md handles account and document data."
};

export default function Privacy() {
  return (
    <PolicyPage title="Privacy Policy" summary="How Passage collects, uses, shares, retains, and protects your data.">
      <section>
        <h2>Data Passage handles</h2>
        <p>
          Passage stores your email address, password hash, account and subscription status, sessions, API-token
          metadata, account dates, and the policy version and time you accepted at signup.
          It stores the Markdown documents you save, including document titles, sharing state, and timestamps.
        </p>
        <p>
          Password-reset requests, security rate-limit records, and ordinary server logs may contain your email address,
          an IP address or a one-way hash, request details, and error information.
          Passage does not sell your personal data or use third-party advertising trackers.
        </p>
      </section>
      <section>
        <h2>Why it is used</h2>
        <p>
          This data is used to provide and secure the service, authenticate you, save and share documents at your
          direction, deliver account email, manage subscriptions, prevent abuse, support users, and meet legal and
          accounting obligations.
        </p>
      </section>
      <section>
        <h2>Service providers</h2>
        <p>
          Google Cloud hosts the application, database, logs, and backups.
          Stripe processes subscription payments and keeps billing records.
          Resend delivers account email.
          These providers process data under their own terms and may process it outside your country.
        </p>
        <p>
          Data may also be disclosed when required by law, to protect Passage or others, or as part of a business
          transfer.
          Public documents are disclosed only when you enable their share link.
        </p>
      </section>
      <section>
        <h2>Retention and deletion</h2>
        <p>
          Account and document data is kept while your account is active.
          Removing a document from the workspace currently archives it in the account rather than erasing it
          permanently.
          A verified permanent-deletion request removes the account and its documents, shares, sessions, API tokens,
          grants, and local billing state from the active database.
          If Stripe cleanup must be retried, Passage temporarily keeps the account email and Stripe customer ID in a
          restricted cleanup record and removes that record when cleanup succeeds.
        </p>
        <p>
          Routine database backups and point-in-time recovery data follow a seven-backup and seven-day schedule.
          Deleted data cannot be removed from an individual backup and remains there until that backup expires.
          Stripe may retain invoices, payments, and related data for legal, fraud-prevention, and accounting reasons.
          Limited records may be retained where law or a security investigation requires it.
        </p>
      </section>
      <section>
        <h2>Security</h2>
        <p>
          Passage uses access controls, encrypted connections, hashed passwords and tokens, restricted production
          secrets, backups, and provider security controls.
          No online service can guarantee absolute security.
        </p>
      </section>
      <section>
        <h2>Your requests</h2>
        <p>
          You may ask for a machine-readable export, correction, or permanent deletion of your account data.
          Send the request from your account email to <SupportLink />.
          We may ask for reasonable proof that you control the account before acting.
          Applicable law may give you additional privacy rights.
        </p>
      </section>
      <section>
        <h2>Changes and contact</h2>
        <p>
          Material changes will be posted here with a new effective date.
          Privacy questions can be sent to <SupportLink />.
        </p>
      </section>
    </PolicyPage>
  );
}
