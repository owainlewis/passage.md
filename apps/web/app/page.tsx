"use client";

import Link from "next/link";
import Image from "next/image";
import { AuthBoundary, useAuth } from "./auth";
import { Brand } from "./brand";
import { PLAN_FEATURES } from "./features";
import { MerchantLink, SupportLink } from "./legal";
import styles from "./landing.module.css";

const workflow = [
  {
    title: "Store your knowledge",
    body: "Goals, product notes, preferences, research, drafts. One private place for the writing you keep coming back to, instead of folders on one machine.",
    example: "Every note in one app"
  },
  {
    title: "Group it into collections",
    body: "A collection is the unit you hand to an agent. Put your operating context in one, a project in another, and keep the boundary clear.",
    example: "Collections / Operating Context"
  },
  {
    title: "Give your agents access",
    body: "Agents read and update the same private Markdown through the authenticated API or CLI, and search the full text of every document.",
    example: "passage list --collection operating-context"
  },
  {
    title: "Share deliberately",
    body: "Publish a read-only page or raw Markdown URL only when another person or agent needs it. Revoke access at any time.",
    example: "passage share <doc-id>"
  }
];

const proRenewal = "Renews monthly until cancelled. Cancel through the Stripe portal.";

export default function Landing() {
  return (
    <AuthBoundary>
      <LandingContent />
    </AuthBoundary>
  );
}

function LandingContent() {
  const auth = useAuth();
  const sessionReady = auth.sessionStatus === "authenticated" || auth.sessionStatus === "anonymous";
  const signedIn = Boolean(auth.user);
  const isPro = auth.account?.plan === "pro";
  const publicSignup = sessionReady && auth.publicSignupEnabled && !signedIn;
  const primaryHref = !sessionReady
    ? "/write"
    : signedIn
      ? "/write"
      : publicSignup
        ? "/signup"
        : "/login?next=%2Fwrite";
  const primaryLabel = !sessionReady
    ? "Start writing"
    : signedIn
      ? "Open workspace"
      : publicSignup
        ? "Create free account"
        : "Sign in";
  const proHref = !sessionReady
    ? "/account"
    : isPro || signedIn
      ? "/account"
      : publicSignup
        ? "/signup"
        : "/login?next=%2Faccount";
  const proLabel = !sessionReady
    ? "View account"
    : isPro
      ? "Account settings"
      : signedIn
        ? "Upgrade"
        : publicSignup
          ? "Get started"
          : "Sign in";

  // When public signup is open the call to action is "Create free account", so
  // a returning reader has nowhere to sign in. When signup is closed the call
  // to action is already "Sign in", and a second link would just repeat it.
  const showSignIn = sessionReady && !signedIn && publicSignup;

  const statusMessage = !sessionReady
    ? ""
    : isPro
      ? "Passage Pro is active."
      : signedIn
        ? "Free includes five saved documents."
        : publicSignup
          ? "Free signup is open. No card required."
          : "Public signup is not open yet. Existing customers can sign in.";

  return (
    <div className={styles.landing}>
      <header className={styles.nav}>
        <Brand />
        <nav className={styles.navLinks} aria-label="Main navigation">
          <Link href="/cli">CLI</Link>
          {isPro ? <Link href="/account">Account</Link> : <a href="#pricing">Go Pro</a>}
          {showSignIn && <Link href="/login">Sign in</Link>}
          <Link className={styles.navCta} href={primaryHref}>
            {primaryLabel}
          </Link>
        </nav>
      </header>

      <main className={styles.main}>
        <section className={styles.hero}>
          <div className={styles.heroCopy}>
            <h1 className={styles.heroTitle}>A writing app built for you and your agents.</h1>
            <p className={styles.heroSub}>
              Your writing and agent context, together in one Markdown workspace. Private by default, with nothing to sync.
            </p>
            <div className={styles.heroActions}>
              <Link className={styles.primaryButton} href={primaryHref}>
                {primaryLabel}
              </Link>
              <a className={styles.secondaryButton} href="#workflow">
                See how it works
              </a>
            </div>
            {statusMessage && <p className={styles.heroNote}>{statusMessage}</p>}
          </div>

          <figure className={styles.heroPreview}>
            <Image
              className={styles.workspacePreview}
              src="/workspace-preview.png"
              alt="Passage workspace with a collection of project notes and a Markdown document open for reading."
              width={1280}
              height={800}
              priority
              unoptimized
            />
          </figure>
        </section>

        <section className={styles.features} id="workflow">
          <div className={styles.featuresHeader}>
            <div>
              <h2 className={styles.sectionHeading}>Keep context and writing together.</h2>
            </div>
            <p>Deliberately minimal. Collections to organise your context, search that reads every word, and one CLI your agents use to read and update the same Markdown.</p>
          </div>
          <div className={styles.featureList}>
            {workflow.map((feature, index) => (
              <article className={styles.featureRow} key={feature.title}>
                <span className={styles.featureNumber}>{String(index + 1).padStart(2, "0")}</span>
                <div>
                  <h3 className={styles.featureTitle}>{feature.title}</h3>
                  <code className={styles.featureExample}>{feature.example}</code>
                </div>
                <p className={styles.featureBody}>{feature.body}</p>
              </article>
            ))}
          </div>
        </section>

        <section className={styles.story} id="story">
          <div className={styles.storyBody}>
            <p className={styles.storyLead}>Your agents are only as useful as the context they can reach.</p>
            <p>
              Goals sit in one folder. Product notes sit in another. Preferences live in a prompt you cannot find. Each new
              agent starts cold, so you explain the same project again and paste the same files into another chat.
            </p>
            <p>
              Passage gives that context one home. Collections are the parts of your world, and a collection is what you
              hand to an agent. Star what you rely on, and find any phrase again with indexed full-text search.
            </p>
            <p>
              It replaces the sprawl. Markdown files on one laptop, half of them in a folder you sync through Dropbox,
              the rest pasted into a chat you cannot find again. One app instead, deliberately minimal, holding only
              what you and your agents need to write each day.
            </p>
            <p>
              Your agents read and update the same private Markdown through one CLI. Share a clean page or a raw
              Markdown link only when you choose.
            </p>
            <p className={styles.storyClose}>Markdown is a good format. A folder on one machine is a poor shared memory.</p>
          </div>
        </section>

        <section className={styles.pricing} id="pricing">
          <div className={styles.pricingHeader}>
            <div>
              <h2 className={styles.sectionHeading}>Simple pricing</h2>
            </div>
            <p>Start for free. Upgrade when you need a larger context library, sharing, or private access from agents.</p>
          </div>
          <div className={styles.pricingGrid}>
            <div className={styles.plan}>
              <p className={styles.planName}>Free</p>
              <p className={styles.planPrice}>
                $0<span className={styles.planPer}> forever</span>
              </p>
              <ul className={styles.planList}>
                {PLAN_FEATURES.free.map((feature) => (
                  <li key={feature}>{feature}</li>
                ))}
              </ul>
              <div className={styles.planFooter}>
                <Link className={`${styles.secondaryButton} ${styles.planButton}`} href={primaryHref}>
                  {primaryLabel}
                </Link>
                <p className={`${styles.planRenewal} ${styles.planRenewalPlaceholder}`} aria-hidden="true">
                  {proRenewal}
                </p>
              </div>
            </div>
            <div className={`${styles.plan} ${styles.planPro}`}>
              <p className={styles.planName}>
                Pro<span className={styles.planTag}>Monthly</span>
              </p>
              <p className={styles.planPrice}>
                $5<span className={styles.planPer}> USD / month</span>
              </p>
              <ul className={styles.planList}>
                <li>Everything in Free</li>
                {PLAN_FEATURES.pro.map((feature) => (
                  <li key={feature}>{feature}</li>
                ))}
              </ul>
              <div className={styles.planFooter}>
                <Link className={`${styles.primaryButton} ${styles.planButton}`} href={proHref}>
                  {proLabel}
                </Link>
                <p className={styles.planRenewal}>{proRenewal}</p>
              </div>
            </div>
          </div>
          <p className={styles.pricingPolicies}>
            See the <Link href="/cancellation">Cancellation Policy</Link> and <Link href="/refunds">Refund Policy</Link>.
          </p>
        </section>
      </main>

      <footer className={styles.footer}>
        <div className={styles.footerBrand}>
          <Brand />
          <span className={styles.footerTag}>A writing app built for you and your agents.</span>
          <span className={styles.footerTag}>
            Operated by <MerchantLink />.
          </span>
          <span className={styles.footerTag}>
            Support: <SupportLink />
          </span>
        </div>
        <nav className={styles.footerLinks} aria-label="Footer links">
          <Link href={primaryHref}>{primaryLabel}</Link>
          {showSignIn && <Link href="/login">Sign in</Link>}
          <Link href="/cli">CLI</Link>
          <a href="#pricing">Pricing</a>
          <Link href="/terms">Terms</Link>
          <Link href="/privacy">Privacy</Link>
          <Link href="/refunds">Refunds</Link>
          <Link href="/cancellation">Cancellation</Link>
        </nav>
      </footer>
    </div>
  );
}
