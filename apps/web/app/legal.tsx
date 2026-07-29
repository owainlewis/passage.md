import Link from "next/link";
import { Brand } from "./brand";

export const MERCHANT_NAME = "Gradientwork Limited";
export const MERCHANT_URL = "https://gradientwork.com";
export const SUPPORT_EMAIL = "owain@gradientwork.com";
export const POLICY_DATE = "29 July 2026";

export function MerchantLink() {
  return <a href={MERCHANT_URL}>{MERCHANT_NAME}</a>;
}

export function SupportLink() {
  return <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>;
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
    <div className="policyPage">
      <header className="policyNav">
        <Brand href="/" />
        <Link href="/write">Start writing</Link>
      </header>
      <main className="policyMain">
        <p className="policyKicker">Passage policies</p>
        <h1>{title}</h1>
        <p className="policySummary">{summary}</p>
        <p className="policyDate">Effective {POLICY_DATE}</p>
        <div className="policyBody">{children}</div>
      </main>
      <footer className="policyFooter">
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
