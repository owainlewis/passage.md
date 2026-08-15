"use client";

import Link from "next/link";
import { AuthBoundary, useAuth } from "./auth";
import { Brand } from "./brand";
import { PLAN_FEATURES } from "./features";
import { MerchantLink, SupportLink } from "./legal";
import styles from "./landing.module.css";

const workflow = [
  {
    title: "Store stable context",
    body: "Keep goals, product notes, preferences, and research in private collections. Star the documents you return to most.",
    example: "Collections / Operating Context"
  },
  {
    title: "Find and write with it",
    body: "Search the full text of your Markdown, then draft notes and plans beside the source material they depend on.",
    example: "Full-text search / every Markdown body"
  },
  {
    title: "Use it from agents",
    body: "Let agents read and update the same private Markdown through the authenticated API or CLI without copying files into another tool.",
    example: "passage cat <doc-id>"
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
            <p className={styles.heroKicker}>Context for agents and humans</p>
            <h1 className={styles.heroTitle}>One Markdown workspace for you and your agents.</h1>
            <p className={styles.heroSub}>
              Give your goals, product notes, preferences, and drafts one stable home instead of scattering them across
              local files and chats. You and your agents can use the same private Markdown.
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
              <span>One source of context</span>
              <span>01 / 03</span>
            </div>
            <div className={styles.heroDoc}>
              <div className={styles.docChrome}>
                <span className={styles.docDots}>
                  <i />
                  <i />
                  <i />
                </span>
                <span className={styles.docUrl}>Operating Context / goals.md</span>
                <span className={styles.docStatus}>Private</span>
              </div>
              <div className={styles.docCanvas}>
                <div className={styles.lineNumbers}>
                  {Array.from({ length: 8 }, (_, index) => (
                    <span key={index}>{String(index + 1).padStart(2, "0")}</span>
                  ))}
                </div>
                <div className={`markdown ${styles.heroDocBody}`}>
                  <h1>Operating context</h1>
                  <p>Stable context for every agent I work with.</p>
                  <ul>
                    <li>Goal: ship the Passage workspace</li>
                    <li>Product: shared Markdown for people and agents</li>
                    <li>Preference: concise, direct writing</li>
                  </ul>
                  <blockquote>
                    <p>Update this document when the plan changes.</p>
                  </blockquote>
                </div>
              </div>
              <div className={styles.terminalStrip}>$ passage list</div>
            </div>
          </div>
        </section>

        <section className={styles.features} id="workflow">
          <div className={styles.featuresHeader}>
            <div>
              <p className={styles.kicker}>How Passage works</p>
              <h2 className={styles.sectionHeading}>Keep context and writing together.</h2>
            </div>
            <p>Collections and indexed search organise the browser workspace. Agents use the authenticated API or CLI for private document bodies.</p>
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
            <p className={styles.kicker}>Why hosted Markdown</p>
          </div>
          <div className={styles.storyBody}>
            <p className={styles.storyLead}>Your agents are only as useful as the context they can reach.</p>
            <p>
              Goals sit in one folder. Product notes sit in another. Preferences live in a prompt you cannot find. Each new
              agent starts cold, so you explain the same project again and paste the same files into another chat.
            </p>
            <p>
              Passage gives that context one stable home. Use collections for the parts of your world, star the documents
              you rely on, and find any phrase again with indexed full-text search.
            </p>
            <p>
              Write ordinary notes and drafts beside that context. Your agents can use the same private Markdown through
              the authenticated API or CLI. Share a clean page or raw Markdown link only when you choose.
            </p>
            <p className={styles.storyClose}>Markdown is a good format. A folder on one machine is a poor shared memory.</p>
          </div>
        </section>

        <section className={styles.pricing} id="pricing">
          <div className={styles.pricingHeader}>
            <div>
              <p className={styles.kicker}>Pricing</p>
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
          <span className={styles.footerTag}>Shared Markdown context for agents and humans.</span>
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
