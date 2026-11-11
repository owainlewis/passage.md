import Link from "next/link";
import { Brand } from "./brand";
import paper from "./paper.module.css";
import styles from "./reading.module.css";

export const MERCHANT_NAME = "Gradientwork Limited";
export const MERCHANT_URL = "https://gradientwork.com";
export const SUPPORT_EMAIL = "owain@gradientwork.com";
export const POLICY_DATE = "31 July 2026";

export function MerchantLink() {
  return <a href={MERCHANT_URL}>{MERCHANT_NAME}</a>;
}

export function SupportLink() {
  return <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>;
}

export function documentLimitSupportHref(email: string, savedDocs: number, maxSavedDocs: number, purpose: string) {
  const subject = "Passage document limit increase request";
  const body = [
    `Passage account: ${email}`,
    `Current usage: ${savedDocs} of ${maxSavedDocs} saved documents`,
    "Requested limit:",
    `Purpose for the higher limit: ${purpose.trim()}`,
    "",
    "Please do not include document titles or content."
  ].join("\n");
  return `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

export function PolicyPage({
  title,
  summary,
  children
}: {
  title: string;
  summary: string;
  children: React.ReactNode;
}) {
  return (
    <div className={paper.paper}>
      <header className={paper.bar}>
        <Brand href="/" />
        <Link className={paper.barLink} href="/write">
          Start writing
        </Link>
      </header>
      <main className={styles.column}>
        <h1 className={styles.title}>{title}</h1>
        <p className={styles.lead}>{summary}</p>
        <p className={styles.meta}>Effective {POLICY_DATE}</p>
        <div className={styles.prose}>{children}</div>
      </main>
      <footer className={styles.footer}>
        <span>
          Passage is operated by <MerchantLink />.
        </span>
        <nav aria-label="Policy links">
          <Link href="/terms">Terms</Link>
          <Link href="/privacy">Privacy</Link>
          <Link href="/refunds">Refunds</Link>
          <Link href="/cancellation">Cancellation</Link>
          <SupportLink />
        </nav>
      </footer>
    </div>
  );
}
