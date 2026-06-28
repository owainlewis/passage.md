import Link from "next/link";
import { Brand } from "./brand";

const features = [
  {
    title: "Write in the browser",
    body: "A calm Markdown surface that works anywhere you can open a tab. No vaults, folders, sync setup, or repo ceremony."
  },
  {
    title: "Share online by URL",
    body: "Saved documents are private by default. Share one when you mean to, revoke it when you are done, and keep the Markdown clean."
  },
  {
    title: "Built for agents too",
    body: "Raw Markdown URLs, CLI access, and API workflows make the same document useful to you, your collaborators, and your agents."
  }
];

export default function Landing() {
  return (
    <div className="landing">
      <section className="heroSection">
        <video className="heroVideo" autoPlay muted loop playsInline poster="/bg-poster.jpg">
          <source src="/bg.mp4" type="video/mp4" />
        </video>
        <div className="heroScrim" aria-hidden="true" />
        <header className="landingNav onDark">
          <Brand />
          <nav className="landingNavLinks">
            <a href="#pricing">Go Pro</a>
            <Link className="landingNavCta" href="/write">
              Start writing
            </Link>
          </nav>
        </header>
        <div className="heroInner">
          <h1 className="heroTitle">Hosted Markdown for humans and agents</h1>
          <p className="heroSub">
            Write in a calm browser workspace, share documents online, and give your agents clean Markdown they can read
            and work with. No local files to manage. Free to start.
          </p>
          <div className="heroActions">
            <Link className="btnPrimary" href="/write">
              Start writing
            </Link>
            <a className="btnGhost" href="#story">
              Read the story
            </a>
          </div>
        </div>
      </section>

      <main className="landingMain">
        <section className="story" id="story">
          <h2 className="sectionTitle">Why passage exists</h2>
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
              <h3 className="featureTitle">{feature.title}</h3>
              <p className="featureBody">{feature.body}</p>
            </div>
          ))}
        </section>

        <section className="pricing" id="pricing">
          <h2 className="sectionTitle">Simple pricing</h2>
          <div className="pricingGrid">
            <div className="planCard">
              <p className="planName">Free</p>
              <p className="planPrice">
                $0<span className="planPer"> forever</span>
              </p>
              <ul className="planList">
                <li>5 saved documents</li>
                <li>CLI and API for your agents</li>
                <li>Preview, Mermaid, and copy</li>
                <li>Share read-only links</li>
              </ul>
              <Link className="btnPrimary planCta" href="/write">
                Start writing
              </Link>
            </div>
            <div className="planCard planCardPro">
              <p className="planName">
                Pro<span className="planTag">Coming soon</span>
              </p>
              <p className="planPrice">
                $6.99<span className="planPer"> / month</span>
              </p>
              <ul className="planList">
                <li>Everything in Free</li>
                <li>Unlimited documents</li>
                <li>Export and raw .md URLs</li>
                <li>Dark mode and themes</li>
              </ul>
              <span className="btnGhost planCta planCtaDisabled">Coming soon</span>
            </div>
          </div>
        </section>
      </main>

      <footer className="landingFooter">
        <Brand />
        <span className="footerTag">Hosted Markdown for humans and agents.</span>
      </footer>
    </div>
  );
}
