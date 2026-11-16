"use client";

import Link from "next/link";
import { AuthBoundary, useAuth } from "./auth";
import { Brand } from "./brand";
import { MoonIcon, SunIcon } from "./icons";
import { useTheme } from "./theme";
import styles from "./landing.module.css";
import paper from "./paper.module.css";

// The site's main nav, shared by the home page and the agents guide. Its
// styles come from landing.module.css, so the page wraps it in styles.landing.
// Pages other than home pass brandHref="/" so the wordmark leads back.
export function SiteNav({ brandHref }: { brandHref?: string }) {
  return (
    <AuthBoundary>
      <SiteNavContent brandHref={brandHref} />
    </AuthBoundary>
  );
}

function SiteNavContent({ brandHref }: { brandHref?: string }) {
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

  // When public signup is open the call to action is "Create free account", so
  // a returning reader has nowhere to sign in. When signup is closed the call
  // to action is already "Sign in", and a second link would just repeat it.
  const showSignIn = sessionReady && !signedIn && publicSignup;

  return (
    <header className={styles.nav}>
      <Brand href={brandHref} />
      <nav className={styles.navLinks} aria-label="Main navigation">
        <Link className={`${paper.barLink} ${styles.navLink}`} href="/agents">Agents</Link>
        {isPro
          ? <Link className={`${paper.barLink} ${styles.navLink}`} href="/account">Account</Link>
          : <Link className={`${paper.barLink} ${styles.navLink}`} href="/#pricing">Go Pro</Link>}
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
  );
}
