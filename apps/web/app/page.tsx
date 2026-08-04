"use client";

import Link from "next/link";
import { AuthBoundary, useAuth } from "./auth";
import { Brand } from "./brand";
import { PLAN_FEATURES } from "./features";
import { MerchantLink, SupportLink } from "./legal";
import styles from "./landing.module.css";

const workflow = [
  {
    title: "Write privately",
    body: "Start in a calm browser workspace. Saved documents are private by default and stored as plain Markdown.",
    example: "passage.md/write"
  },
  {
    title: "Share deliberately",
    body: "Publish a read-only page or raw Markdown URL when another person or agent needs access. Revoke it at any time.",
    example: "passage.md/d/<public-id>.md"
  },
  {
    title: "Use it from an agent",
    body: "List and read the same documents through the CLI or API without copying files into another tool.",
    example: "passage cat <doc-id>"
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
          <Link className={styles.navCta} href={primaryHref}>
            {primaryLabel}
          </Link>
        </nav>
      </header>

      <main className={styles.main}>
        <section className={styles.hero}>
          <div className={styles.heroCopy}>
            <h1 className={styles.heroTitle}>Markdown writing for agents and humans</h1>
            <p className={styles.heroSub}>
              Write in a calm browser workspace, share documents online, and give your agents clean Markdown they can read
              without copying files around.
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

          <div className={styles.heroPreview} aria-hidden="true">
            <div className={styles.previewCaption}>
              <span>One document, everywhere</span>
              <span>01 / 03</span>
            </div>
            <div className={styles.heroDoc}>
              <div className={styles.docChrome}>
                <span className={styles.docDots}>
                  <i />
                  <i />
                  <i />
                </span>
                <span className={styles.docUrl}>passage.md/d/trail-notes</span>
                <span className={styles.docStatus}>Shared</span>
              </div>
              <div className={styles.docCanvas}>
                <div className={styles.lineNumbers}>
                  {Array.from({ length: 8 }, (_, index) => (
                    <span key={index}>{String(index + 1).padStart(2, "0")}</span>
                  ))}
                </div>
                <div className={`markdown ${styles.heroDocBody}`}>
                  <h1>Trail notes</h1>
                  <p>A slow loop from Llyn Idwal, written up on the train home and shared with the group before Saturday.</p>
                  <ul>
                    <li>Start from the Ogwen car park before eight</li>
                    <li>Take the east shore path while the light is low</li>
                    <li>Turn back at the scramble if the rock is wet</li>
                  </ul>
                  <blockquote>
                    <p>The mountain keeps its own time.</p>
                  </blockquote>
                </div>
              </div>
              <div className={styles.terminalStrip}>$ passage cat &lt;doc-id&gt;</div>
            </div>
          </div>
        </section>

        <section className={styles.features} id="workflow">
          <div className={styles.featuresHeader}>
            <div>
              <p className={styles.kicker}>The product loop</p>
              <h2 className={styles.sectionHeading}>One document. Three useful surfaces.</h2>
            </div>
            <p>Write for yourself, share only when you choose, then use the same Markdown from an agent or terminal.</p>
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
          <div className={styles.sectionAside}>
            <p className={styles.kicker}>Why Passage exists</p>
          </div>
          <div className={styles.storyBody}>
            <p className={styles.storyLead}>I tried every online document tool, and none of them fit.</p>
            <p>
              I wanted one place to write Markdown in the browser, on my laptop or my phone, with nothing to install. And
              I wanted my agents to reach the same documents I was working on, without copying files around, syncing a
              folder, or creating a repo just to share a paragraph.
            </p>
            <p>
              Google Docs is too rich. Notion is too heavy. Gists are useful, but they feel like developer plumbing, not
              a place to think. Local Markdown files are tidy for a day and messy for a year once agents, phones, and
              shared links enter the workflow.
            </p>
            <p>
              So I stripped it back. Beautiful Markdown in the browser. Private by default. Share it when you mean to.
              Let your agents read the raw Markdown when they need context.
            </p>
            <p className={styles.storyClose}>Passage is not a local writing app. It is a small online home for Markdown.</p>
          </div>
        </section>

        <section className={styles.pricing} id="pricing">
          <div className={styles.pricingHeader}>
            <div>
              <p className={styles.kicker}>Pricing</p>
              <h2 className={styles.sectionHeading}>Simple pricing</h2>
            </div>
            <p>Start for free. Upgrade when you need sharing, thousands of saved documents, or access from agents.</p>
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
          <span className={styles.footerTag}>Markdown writing for agents and humans.</span>
          <span className={styles.footerTag}>
            Operated by <MerchantLink />.
          </span>
          <span className={styles.footerTag}>
            Support: <SupportLink />
          </span>
        </div>
        <nav className={styles.footerLinks} aria-label="Footer links">
          <Link href={primaryHref}>{primaryLabel}</Link>
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
