"use client";

import Link from "next/link";
import { AuthBoundary, useAuth } from "./auth";
import { Brand } from "./brand";
import { PLAN_FEATURES } from "./features";
import { MoreIcon, PanelIcon, PlusIcon, SearchIcon } from "./icons";
import { MerchantLink, SupportLink } from "./legal";
import styles from "./landing.module.css";

const principles = [
  {
    title: "Nothing in the way",
    body: "One page and a blinking cursor. The few controls there are fade out as soon as you start typing, and come back when you reach for them."
  },
  {
    title: "Find anything",
    body: "Every document in one list, newest first. Press ⌘K and search every word you have ever written. No folders to file things in."
  },
  {
    title: "Plain Markdown",
    body: "Write with headings, lists and quotes as you type, or flip to the raw text with ⌘/. Copy it, download it, or read it from the CLI."
  }
];

const shortcuts = [
  { keys: "⌘K", label: "Search" },
  { keys: "⌘/", label: "Markdown" },
  { keys: "⌘.", label: "Documents" }
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

      <main>
        <section className={styles.hero}>
          <h1 className={styles.heroTitle}>A quiet place to write.</h1>
          <p className={styles.heroSub}>
            Passage is a Markdown editor with nothing in the way. Open it, write, and find anything again with search.
          </p>
          <div className={styles.heroActions}>
            <Link className={styles.primaryButton} href={primaryHref}>
              {primaryLabel}
            </Link>
          </div>
          <p className={styles.heroNote} aria-live="polite">
            {statusMessage}
          </p>
        </section>

        <div className={styles.stage} aria-hidden="true">
          <div className={styles.window}>
            <div className={styles.windowBar}>
              <span className={styles.windowIcon}><PanelIcon /></span>
              <span className={styles.windowSpacer} />
              <span className={styles.windowStatus}>Saved</span>
              <span className={styles.windowIcon}><SearchIcon /></span>
              <span className={styles.windowIcon}><PlusIcon /></span>
              <span className={styles.windowIcon}><MoreIcon /></span>
            </div>
            <div className={styles.windowPage}>
              <h2>Morning pages</h2>
              <p>
                The best writing tool is the one you forget is there. No sidebar asking where this belongs, no toolbar
                asking how it should look. Just the next sentence.
              </p>
              <p>Three things for today:</p>
              <ul>
                <li>Finish the draft before lunch</li>
                <li>Cut the second section in half</li>
                <li>
                  Send it, even if it is not perfect
                  <span className={styles.caret} />
                </li>
              </ul>
            </div>
            <div className={styles.windowFoot}>64 words</div>
          </div>
        </div>

        <section className={styles.principles} aria-label="Why Passage">
          {principles.map((item) => (
            <article className={styles.principle} key={item.title}>
              <h2 className={styles.principleTitle}>{item.title}</h2>
              <p>{item.body}</p>
            </article>
          ))}
        </section>

        <ul className={styles.shortcuts} aria-label="Keyboard shortcuts">
          {shortcuts.map((shortcut) => (
            <li key={shortcut.keys}>
              <kbd>{shortcut.keys}</kbd>
              <span>{shortcut.label}</span>
            </li>
          ))}
        </ul>

        <section className={styles.agents}>
          <div>
            <h2 className={styles.sectionTitle}>Your agents can read it too.</h2>
            <p>
              With Pro, the CLI and API give your agents the same private Markdown you write in. They can list it, read
              it and add to it. Share a read-only page only when you choose.
            </p>
            <Link className={styles.textLink} href="/cli">
              Read the CLI guide
            </Link>
          </div>
          <pre className={styles.terminal}>
            <code>
              <span className={styles.prompt}>$</span> passage list{"\n"}
              <span className={styles.prompt}>$</span> passage cat &lt;doc-id&gt;{"\n"}
              <span className={styles.prompt}>$</span> passage append &lt;doc-id&gt; ./notes.md
            </code>
          </pre>
        </section>

        <section className={styles.pricing} id="pricing">
          <h2 className={styles.sectionTitle}>Simple pricing</h2>
          <p className={styles.pricingSub}>Start for free. Upgrade when you want more room, sharing, or the CLI.</p>
          <div className={styles.plans}>
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
                <Link className={styles.secondaryButton} href={primaryHref}>
                  {primaryLabel}
                </Link>
                <p className={styles.planRenewal}>No card required.</p>
              </div>
            </div>
            <div className={`${styles.plan} ${styles.planPro}`}>
              <p className={styles.planName}>Pro</p>
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
                <Link className={styles.primaryButton} href={proHref}>
                  {proLabel}
                </Link>
                <p className={styles.planRenewal}>{proRenewal}</p>
              </div>
            </div>
          </div>
          <p className={styles.policies}>
            See the <Link href="/cancellation">Cancellation Policy</Link> and <Link href="/refunds">Refund Policy</Link>.
          </p>
        </section>
      </main>

      <footer className={styles.footer}>
        <div className={styles.footerMeta}>
          <Brand />
          <span>
            Operated by <MerchantLink />. Support: <SupportLink />
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
