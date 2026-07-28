import type { Metadata } from "next";
import { PolicyPage, SupportLink } from "../legal";

export const metadata: Metadata = {
  title: "Refund Policy | passage.md",
  description: "The refund policy for passage.md Pro."
};

export default function Refunds() {
  return (
    <PolicyPage title="Refund Policy" summary="How refunds work for the monthly Passage Pro subscription.">
      <section>
        <h2>Monthly subscription payments</h2>
        <p>
          Passage Pro payments are generally non-refundable once a monthly billing period begins.
          Cancelling stops the next renewal but does not automatically refund the current period.
        </p>
      </section>
      <section>
        <h2>Incorrect charges and legal rights</h2>
        <p>
          Passage will correct duplicate or incorrect charges and provide refunds where required by law.
          This policy does not limit any mandatory consumer rights that apply to you.
        </p>
      </section>
      <section>
        <h2>Requesting help</h2>
        <p>
          If you believe a charge is wrong or the paid service did not work as described, contact <SupportLink /> within
          14 days of the charge.
          Include your Passage account email and the charge date, but never send card details.
          Requests are reviewed individually.
        </p>
      </section>
    </PolicyPage>
  );
}
