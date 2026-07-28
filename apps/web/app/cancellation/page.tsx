import type { Metadata } from "next";
import { PolicyPage, SupportLink } from "../legal";

export const metadata: Metadata = {
  title: "Cancellation Policy | passage.md",
  description: "How to cancel passage.md Pro."
};

export default function Cancellation() {
  return (
    <PolicyPage title="Cancellation Policy" summary="How to stop renewal of the monthly Passage Pro subscription.">
      <section>
        <h2>How to cancel</h2>
        <p>
          Sign in, open Account, choose Manage billing, and cancel in the Stripe customer portal.
          You can also ask <SupportLink /> for help from your account email.
        </p>
      </section>
      <section>
        <h2>What happens next</h2>
        <p>
          Portal cancellation is scheduled for the end of the current paid billing period.
          Pro access continues until that date, then the subscription stops and Stripe does not renew it.
          You can see the current period end in your Passage account and the Stripe portal.
        </p>
        <p>
          Cancelling does not delete your Passage account or documents.
          It also does not automatically refund the current period.
          See the <a href="/refunds">Refund Policy</a> or contact support if a charge is incorrect.
        </p>
      </section>
      <section>
        <h2>Keeping your data</h2>
        <p>
          After Pro ends, your account moves to the free limits.
          Request an export before cancellation if you want an offline copy.
          You may request export or permanent account deletion at any time through <SupportLink />.
        </p>
      </section>
    </PolicyPage>
  );
}
