"use client";

import Link from "next/link";
import { AuthBoundary, useAuth } from "./auth";
import { Brand } from "./brand";
import { PLAN_FEATURES } from "./features";
import { MerchantLink, SupportLink } from "./legal";

function PenIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true">
      <path
        d="M4 20l1.2-4.2L16.4 4.6a2 2 0 0 1 2.8 0l.2.2a2 2 0 0 1 0 2.8L8.2 18.8 4 20Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path d="M14.5 6.5 17.5 9.5" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

function LinkIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true">
      <path
        d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1.4 1.5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <path
        d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1.4-1.5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

function TerminalIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true">
      <rect x="3" y="4.5" width="18" height="15" rx="2.5" stroke="currentColor" strokeWidth="1.6" />
      <path d="m7 9.5 3 2.75L7 15" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M12.5 15H17" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

const features = [
  {
    icon: <PenIcon />,
    title: "Write in the browser",
    body: "A calm Markdown surface that works anywhere you can open a tab. No vaults, folders, sync setup, or repo ceremony."
  },
  {
    icon: <LinkIcon />,
    title: "Share online by URL",
    body: "Saved documents are private by default. Share one when you mean to, revoke it when you are done, and keep the Markdown clean."
  },
  {
    icon: <TerminalIcon />,
    title: "Built for agents too",
    body: "Raw Markdown URLs, CLI access, and API workflows make the same document useful to you, your collaborators, and your agents."
  }
];

export default function Landing() {
  return (
    <AuthBoundary>
      <LandingContent />
    </AuthBoundary>
  );
}

function LandingContent() {
  const auth = useAuth();
  const publicSignup = auth.publicSignupEnabled && !auth.user;
  const primaryHref = publicSignup ? "/signup" : "/write";
  const primaryLabel = publicSignup ? "Create free account" : "Start writing";

  return (
    <div className="landing">
      <header className="landingNav">
        <Brand />
        <nav className="landingNavLinks">
          <Link href="/cli">CLI</Link>
          <a href="#pricing">Go Pro</a>
          <Link className="landingNavCta" href={primaryHref}>
            {primaryLabel}
          </Link>
        </nav>
      </header>

      <section className="heroSection">
        <div className="heroArt" aria-hidden="true" />
        <div className="heroInner">
          <h1 className="heroTitle">Markdown writing for humans and agents</h1>
          <p className="heroSub">
            Write in a calm browser workspace, share documents online, and give your agents clean Markdown they can read
            without copying files around.
          </p>
          <div className="heroActions">
            <Link className="btnPrimary" href={primaryHref}>
              {primaryLabel}
            </Link>
            <a className="btnGhost" href="#story">
              Read the story
            </a>
          </div>
          <p className="heroNote">
            {publicSignup ? "Free signup is open. No card required." : "Public signup is not open yet."}
          </p>
        </div>
        <div className="heroDocWrap" aria-hidden="true">
          <div className="heroDoc">
            <div className="heroDocChrome">
              <span className="heroDocDots">
                <i />
                <i />
                <i />
              </span>
              <span className="heroDocUrl">passage.md/d/trail-notes</span>
              <span className="heroDocShared">Shared</span>
            </div>
            <div className="markdown heroDocBody">
              <h1>Trail notes</h1>
              <p>
                A slow loop from Llyn Idwal, written up on the train home and shared with the group before Saturday.
              </p>
              <ul>
                <li>Start from the Ogwen car park before eight</li>
                <li>Take the east shore path while the light is low</li>
                <li>Turn back at the scramble if the rock is wet</li>
              </ul>
              <blockquote>
                <p>The mountain keeps its own time.</p>
              </blockquote>
            </div>
            <div className="heroTermChip">
              <code>$ passage pull trail-notes.md</code>
            </div>
          </div>
        </div>
      </section>

      <main className="landingMain">
        <section className="story" id="story">
          <p className="landingKicker">Why passage exists</p>
          <div className="storyBody">
            <p>I tried every online document tool, and none of them fit.</p>
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
              So I stripped it back. Beautiful Markdown in the browser. One private URL per document. Share it when you
              mean to. Let your agents read the raw Markdown when they need context.
            </p>
            <p className="storyClose">Passage is not a local writing app. It is a small online home for Markdown.</p>
          </div>
        </section>

        <section className="features">
          {features.map((feature) => (
            <div className="featureCard" key={feature.title}>
              <span className="featureIcon">{feature.icon}</span>
              <h3 className="featureTitle">{feature.title}</h3>
              <p className="featureBody">{feature.body}</p>
            </div>
          ))}
        </section>

        <section className="pricing" id="pricing">
          <p className="landingKicker">Pricing</p>
          <h2 className="sectionTitle">Simple pricing</h2>
          <div className="pricingGrid">
            <div className="planCard">
              <p className="planName">Free</p>
              <p className="planPrice">
                $0<span className="planPer"> forever</span>
              </p>
              <ul className="planList">
                {PLAN_FEATURES.free.map((feature) => (
                  <li key={feature}>{feature}</li>
                ))}
              </ul>
              <Link className="btnGhost planCta" href={primaryHref}>
                {primaryLabel}
              </Link>
            </div>
            <div className="planCard planCardPro">
              <p className="planName">
                Pro<span className="planTag">Monthly</span>
              </p>
              <p className="planPrice">
                $5<span className="planPer"> USD / month</span>
              </p>
              <ul className="planList">
                <li>Everything in Free</li>
                {PLAN_FEATURES.pro.map((feature) => (
                  <li key={feature}>{feature}</li>
                ))}
              </ul>
              <Link className="btnPrimary planCta" href={publicSignup ? "/signup" : "/account"}>
                {publicSignup ? "Get started" : "Upgrade"}
              </Link>
              <p className="planRenewal">
                Renews monthly until cancelled.
                Cancel through the Stripe portal.
              </p>
            </div>
          </div>
          <p className="pricingPolicies">
            See the <Link href="/cancellation">Cancellation Policy</Link> and <Link href="/refunds">Refund Policy</Link>.
          </p>
        </section>
      </main>

      <footer className="landingFooter">
        <div className="footerBrand">
          <Brand />
          <span className="footerTag">Markdown writing for humans and agents.</span>
          <span className="footerTag">
            Operated by <MerchantLink />.
          </span>
          <span className="footerTag">
            Support: <SupportLink />
          </span>
        </div>
        <nav className="footerLinks" aria-label="Footer links">
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
