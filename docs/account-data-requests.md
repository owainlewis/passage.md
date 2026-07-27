# Account data requests

This runbook covers support requests for a Passage account export or permanent deletion.

The customer-facing policy is at `/privacy`.

The process is manual for launch.

## Support identity

Passage is operated by Owain Lewis.

The monitored support address published by Passage is `owain@owainlewis.com`.

Only act on a request sent from the email address on the Passage account.

If the requester cannot use that mailbox, ask for separate evidence of account control before accessing or changing data.

Never ask for a password, API token, session cookie, card number, or document body to verify identity.

Record the request date, verified account email, action taken, and completion date without copying document content into support notes.

## Export an account

Use a trusted operator machine connected to the intended database.

Set `DATABASE_URL` through the normal secret or Cloud SQL Auth Proxy process.

Create a private output directory outside the repository, then run:

```sh
go run ./server/cmd/passage account export customer@example.com /private/path/customer-export.zip
```

The command creates a mode `0600` ZIP and refuses to overwrite an existing file.

It contains:

- `account.json` with account, access, and Stripe subscription metadata.
- `documents.json` with active and archived document metadata.
- `documents/<document-id>.md` with every saved Markdown document.
- `api-tokens.json` with token names and dates, but no token values or hashes.

Inspect only the ZIP entry names and record counts needed to confirm the export.

Do not read document bodies unless the customer specifically asks for content troubleshooting.

Send the ZIP through a private, access-controlled channel.

Delete the operator copy after confirmed delivery.

## Permanently delete an account

Offer an export first.

If the account has a Stripe customer, open the matching Stripe record and stop renewal before deletion.

For a deletion request, do not leave an active or scheduled subscription attached to an account that will no longer exist.

The command refuses deletion while a Stripe customer has a non-terminal or unknown subscription status.

Checkout can create a Stripe customer before a subscription exists.

If the local account has a Stripe customer but no subscription ID or status, inspect that exact customer in the Stripe dashboard.

Only when Stripe shows no active, trialling, scheduled, past-due, or otherwise live subscription may you record that verification and use:

```sh
go run ./server/cmd/passage account delete customer@example.com --confirm customer@example.com --stripe-verified-no-active-subscription
```

The flag works only when the local subscription ID and status are both empty.

It cannot override an active or unknown local subscription state.

Stripe may keep invoices, payments, disputes, and required accounting or fraud-prevention records after cancellation.

Remove or minimise other Stripe customer details when the Stripe dashboard and applicable record-keeping rules allow it.

For an account with no Stripe customer, or a Stripe subscription already in a terminal state, run the command with the account email twice:

```sh
go run ./server/cmd/passage account delete customer@example.com --confirm customer@example.com
```

The transaction immediately removes the Passage user row and database records linked by cascading foreign keys:

- sessions and password-reset tokens;
- API tokens;
- active and archived documents, share state, and public document access;
- local billing state;
- community access grants.

It also removes queued password-reset requests, reset-token rate limits, and the email-specific password-reset rate-limit record.

Security rate-limit records that cannot be linked back to an account age out of use after their rate-limit window and are removed during later cleanup.

Provider logs and Stripe billing records follow their own retention or legal-record rules.

Confirm that sign-in fails and any formerly shared document URL returns `404`.

Tell the customer when active-database deletion is complete.

## Backups and retention

Production Cloud SQL was checked on 27 July 2026.

It had daily automated backups with seven retained backups and seven days of point-in-time recovery.

Deletion protection and storage auto-resize were enabled.

An individual account cannot be selectively removed from an existing backup.

Deleted data remains inaccessible in normal production use and cycles out as those backups and recovery logs expire.

If a backup is restored for disaster recovery before expiry, reapply completed deletion requests before returning the restored database to service.

## Provider and launch checks

Customer data used by Passage is handled by:

- Google Cloud for application hosting, Postgres, operational logs, and backups.
- Stripe for checkout, subscriptions, invoices, payments, and the customer portal.
- Resend for password-reset email.

The Stripe test account was checked on 27 July 2026.

Its customer portal scheduled cancellation at the end of the paid period, which matches the published cancellation policy.

Its website was `https://passage.md` and its statement descriptor was `PASSAGE.MD`.

The sandbox profile name was `Passage sandbox`, its support fields were empty, and its invoice/legal identity was not complete.

Live Stripe billing was not configured in production.

Before public paid signup:

1. Set the live Stripe public business name and legal or invoice identity to the founder-confirmed merchant details.
2. Set `owain@owainlewis.com` as the live support email and set the public support URL.
3. Confirm the statement descriptor is recognisable and consistent with `PASSAGE.MD`.
4. Confirm the live product has one recurring price of $6.99 USD per month.
5. Confirm the portal schedules cancellation for the end of the current period and lets customers view invoices and payment methods.
6. Confirm Checkout, receipts, invoices, and the portal identify the same merchant and support contact as the site.
7. Have the founder review all public copy and workflow behavior.
8. Obtain appropriate legal and privacy review of Terms and Privacy.
9. Obtain accounting review of refund handling, invoice identity, taxes, and billing-record retention.

This runbook and the public pages describe the implemented product process.

They are not legal, tax, or accounting advice.
