"use client";

import Link from "next/link";
import { AuthBoundary, useAuth } from "./auth";
import { Brand } from "./brand";
import { PLAN_FEATURES } from "./features";
import { MoonIcon, MoreIcon, PanelIcon, PlusIcon, SearchIcon, SunIcon, UserIcon } from "./icons";
import { MerchantLink, SupportLink } from "./legal";
import { claudeCodeCommandLines } from "./mcp";
import { useTheme } from "./theme";
import styles from "./landing.module.css";
import paper from "./paper.module.css";

const principles = [
  {
    title: "Nothing in the way",
    body: "One page and a blinking cursor. The few controls fade out when you start typing and come back when you reach for them."
  },
  {
    title: "Find anything",
    body: "Every document in one list, newest first. Press ⌘K and search every word you have written. No folders to file things in."
  },
  {
    title: "Plain Markdown",
    body: "Headings, lists and quotes take shape as you type. Press ⌘/ to see the raw text, and copy it out whenever you like."
  }
];

const shortcuts = [
  { keys: "⌘K", label: "Search" },
  { keys: "⌘/", label: "Markdown" },
  { keys: "⌘.", label: "Documents" }
];

// The document in the picture of the writer under the hero.
const sample = {
  title: "Morning pages",
  opening:
    "The best writing tool is the one you forget is there. No sidebar asking where this belongs, no toolbar asking how it should look. Just the next sentence.",
  heading: "Three things for today",
  items: ["Finish the draft before lunch", "Cut the second section in half", "Send it, even if it is not perfect"]
};

// Counted the way the writer counts a document.
const sampleWords = [sample.title, sample.opening, sample.heading, ...sample.items].join(" ").match(/\S+/g)?.length ?? 0;

const sampleDocuments = [
  { title: sample.title, meta: "Just now" },
  { title: "Chapter four", meta: "Yesterday" },
  { title: "Research notes", meta: "Monday" },
  { title: "Letter to the editor", meta: "28 Oct" },
  { title: "Ideas", meta: "12 Oct" }
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
  const { darkActive, toggleDarkMode } = useTheme();
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
    <div className={`${paper.paper} ${styles.landing}`}>
      <header className={styles.nav}>
        <Brand />
        <nav className={styles.navLinks} aria-label="Main navigation">
          <Link className={`${paper.barLink} ${styles.navLink}`} href="/agents">Agents</Link>
          {isPro
            ? <Link className={`${paper.barLink} ${styles.navLink}`} href="/account">Account</Link>
            : <a className={`${paper.barLink} ${styles.navLink}`} href="#pricing">Go Pro</a>}
          {showSignIn && <Link className={`${paper.barLink} ${styles.navLink}`} href="/login">Sign in</Link>}
          <button
            type="button"
            className={styles.iconButton}
            aria-label="Dark mode"
            aria-pressed={darkActive}
            title="Dark mode"
            onClick={toggleDarkMode}
          >
            {/* Both icons render and CSS picks one from the document theme,
                as in the writer, so a dark reader never sees the moon flash. */}
            <span className={styles.themeIcon} data-icon="moon"><MoonIcon /></span>
            <span className={styles.themeIcon} data-icon="sun"><SunIcon /></span>
          </button>
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
            <Link className={paper.primaryButton} href={primaryHref}>
              {primaryLabel}
            </Link>
            {!isPro && (
              <a className={paper.secondaryButton} href="#pricing">
                See pricing
              </a>
            )}
          </div>
          <p className={styles.heroNote} aria-live="polite">
            {statusMessage}
          </p>
        </section>

        <WriterPicture />

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
              With Pro, Passage&apos;s MCP server lets Claude Code, Cursor and other agents search, read and edit the same
              private Markdown you write in. They edit on top of your latest text, and they can&apos;t share or delete.
            </p>
            <Link className={styles.textLink} href="/agents">
              Connect an agent
            </Link>
          </div>
          <pre className={styles.terminal}>
            <code>
              <span className={styles.prompt}>$</span> {claudeCodeCommandLines()}
            </code>
          </pre>
        </section>

        <section className={styles.pricing} id="pricing">
          <h2 className={styles.sectionTitle}>Simple pricing</h2>
          <p className={styles.pricingSub}>Start for free. Upgrade when you want more room, sharing, or your agents.</p>
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
                <Link className={paper.secondaryButton} href={primaryHref}>
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
                <Link className={paper.primaryButton} href={proHref}>
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

        <section className={styles.closing}>
          <h2 className={styles.closingTitle}>Start with a blank page.</h2>
          <Link className={paper.primaryButton} href={primaryHref}>
            {primaryLabel}
          </Link>
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
          <Link href="/agents">Agents</Link>
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

// The writer as it looks with the document list open. A picture of the app,
// so it is hidden from assistive technology; the sections below it say the
// same things in words.
function WriterPicture() {
  return (
    <div className={styles.stage} aria-hidden="true">
      <div className={styles.window}>
        <div className={styles.drawer}>
          <div className={styles.drawerHead}>
            <span className={styles.search}>
              <SearchIcon />
              <span>Search</span>
              <kbd>⌘K</kbd>
            </span>
          </div>
          <div className={styles.docList}>
            {sampleDocuments.map((doc, index) => (
              <span className={styles.docRow} data-current={index === 0 || undefined} key={doc.title}>
                <span className={styles.docTitle}>{doc.title}</span>
                <span className={styles.docMeta}>{doc.meta}</span>
              </span>
            ))}
          </div>
        </div>
        <div className={styles.windowMain}>
          <div className={styles.windowBar}>
            <span className={styles.windowIcon} data-active><PanelIcon /></span>
            <span className={styles.windowDetails}>{sampleWords} words</span>
            <span className={styles.windowSpacer} />
            <span className={styles.windowIcon}><SearchIcon /></span>
            <span className={styles.windowIcon}><PlusIcon /></span>
            <span className={styles.windowIcon}><MoreIcon /></span>
            <span className={styles.windowIcon}><MoonIcon /></span>
            <span className={styles.windowIcon}><UserIcon /></span>
          </div>
          <div className={styles.windowPage}>
            <p className={styles.docH1}>{sample.title}</p>
            <p>{sample.opening}</p>
            <p className={styles.docH2}>{sample.heading}</p>
            <ul>
              {sample.items.map((item, index) => (
                <li key={item}>
                  {item}
                  {index === sample.items.length - 1 && <span className={styles.caret} />}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
