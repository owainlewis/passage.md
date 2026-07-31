import type { Metadata } from "next";
import { MerchantLink, PolicyPage, SupportLink } from "../legal";

export const metadata: Metadata = {
  title: "Terms of Service | passage.md",
  description: "Terms for using passage.md."
};

export default function Terms() {
  return (
    <PolicyPage title="Terms of Service" summary="The terms for using Passage and its paid subscription.">
      <section>
        <h2>Using Passage</h2>
        <p>
          Passage is a hosted Markdown writing service operated by <MerchantLink />.
          You must provide accurate account information, keep your login and API tokens secure, and be legally able to
          agree to these terms.
        </p>
        <p>
          Do not use Passage to break the law, harm others, interfere with the service, probe its security, or store or
          share content you do not have the right to use.
        </p>
      </section>
      <section>
        <h2>Your content</h2>
        <p>
          You keep ownership of your Markdown and other content.
          You give Passage the limited permission needed to store, process, back up, and display that content so the
          service can work.
        </p>
        <p>
          Saved documents are private by default.
          If you create a public share link, anyone with that link may read the document until you unshare it.
        </p>
      </section>
      <section>
        <h2>Accounts and availability</h2>
        <p>
          You are responsible for activity under your account.
          Passage may suspend access needed to protect the service, users, or the public, or may close an account that
          materially breaches these terms.
        </p>
        <p>
          Passage is provided on an as-available basis.
          We work to keep it reliable and secure, but cannot promise uninterrupted or error-free operation.
        </p>
      </section>
      <section>
        <h2>Paid subscriptions</h2>
        <p>
          Passage Pro costs $5 USD per month.
          Stripe charges the saved payment method automatically each month until cancellation.
          Taxes may be added where required.
        </p>
        <p>
          You can manage billing and cancel through the Stripe customer portal from your account.
          The <a href="/cancellation">Cancellation Policy</a> and <a href="/refunds">Refund Policy</a> explain what
          happens next.
        </p>
      </section>
      <section>
        <h2>Service changes and liability</h2>
        <p>
          Passage may change or discontinue features and will give reasonable notice when a material change affects
          paid use.
          Nothing in these terms limits rights or liability that cannot legally be limited.
          To the extent the law allows, Passage is not responsible for indirect or consequential losses.
        </p>
      </section>
      <section>
        <h2>Changes and contact</h2>
        <p>
          Material changes to these terms will be posted here with a new effective date.
          Questions can be sent to <SupportLink />.
        </p>
      </section>
    </PolicyPage>
  );
}
