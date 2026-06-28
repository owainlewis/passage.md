import Link from "next/link";
import { Brand } from "../brand";

const releaseURL = "https://github.com/owainlewis/passage-cli/releases";
const repoURL = "https://github.com/owainlewis/passage-cli";

const commands = [
  ["passage login", "Save your Passage origin and API token."],
  ["passage auth status --check", "Confirm the saved token works."],
  ["passage new \"Draft\"", "Create a hosted Markdown document."],
  ["passage list", "List your active documents."],
  ["passage cat <doc-id>", "Print Markdown to stdout."],
  ["passage pull <doc-id>", "Alias for reading a document body."],
  ["passage push <doc-id> ./draft.md", "Replace a document from a file."],
  ["passage append <doc-id> ./notes.md", "Append file content."],
  ["passage replace <doc-id> ./draft.md", "Replace a document from a file."]
];

export default function CLIPage() {
  return (
    <div className="cliPage">
      <header className="cliNav">
        <Brand href="/" />
        <nav className="cliNavLinks" aria-label="CLI navigation">
          <Link href="/write">Write</Link>
          <a href={releaseURL}>Releases</a>
        </nav>
      </header>

      <main className="cliMain">
        <section className="cliHero">
          <p className="cliKicker">Passage CLI</p>
          <h1>Hosted Markdown from your terminal.</h1>
          <p>
            Use `passage` to let humans and agents create, read, and update the same private Markdown
            documents that live in the browser.
          </p>
          <div className="cliActions">
            <a className="btnPrimary" href={releaseURL}>
              Download releases
            </a>
            <a className="btnGhost" href={repoURL}>
              View source
            </a>
          </div>
        </section>

        <section className="cliBand" aria-labelledby="install-heading">
          <div className="cliSectionHead">
            <p className="cliKicker">Install</p>
            <h2 id="install-heading">Start with a release or local build</h2>
          </div>
          <div className="cliGrid">
            <div className="cliPanel">
              <h3>Release build</h3>
              <p>Download the archive for your OS from GitHub releases, then put `passage` on your PATH.</p>
              <pre>
                <code>{`# macOS or Linux
tar -xzf passage_<version>_<os>_<arch>.tar.gz
chmod +x passage
./passage version`}</code>
              </pre>
            </div>
            <div className="cliPanel">
              <h3>Local build</h3>
              <p>Until a tagged release exists, build the public Go CLI repo locally.</p>
              <pre>
                <code>{`git clone https://github.com/owainlewis/passage-cli
cd passage-cli
go test ./...
go build ./cmd/passage
./passage version`}</code>
              </pre>
            </div>
          </div>
        </section>

        <section className="cliBand" aria-labelledby="token-heading">
          <div className="cliSectionHead">
            <p className="cliKicker">Auth</p>
            <h2 id="token-heading">Create an API token in the browser</h2>
          </div>
          <ol className="cliSteps">
            <li>Open the account menu in the Passage editor while signed in.</li>
            <li>Create an API token with a name like `Laptop` or `Agent runner`.</li>
            <li>Copy the token when it appears. Passage only shows the plaintext once.</li>
            <li>Run `passage login` and paste the token.</li>
            <li>Revoke old tokens from the same account menu when you are done with them.</li>
          </ol>
          <pre>
            <code>{`passage login
passage auth status --check`}</code>
          </pre>
        </section>

        <section className="cliBand" aria-labelledby="commands-heading">
          <div className="cliSectionHead">
            <p className="cliKicker">Commands</p>
            <h2 id="commands-heading">First commands for humans and agents</h2>
          </div>
          <div className="cliCommandList">
            {commands.map(([command, detail]) => (
              <div className="cliCommand" key={command}>
                <code>{command}</code>
                <span>{detail}</span>
              </div>
            ))}
          </div>
          <pre>
            <code>{`passage new "Research notes"
passage list
passage cat <doc-id>
passage replace <doc-id> ./notes.md
passage list --json`}</code>
          </pre>
        </section>

        <section className="cliBand" aria-labelledby="agent-heading">
          <div className="cliSectionHead">
            <p className="cliKicker">Agent loop</p>
            <h2 id="agent-heading">Use clean Markdown as context</h2>
          </div>
          <p className="cliBody">
            Share a document when another person needs the page URL. Use raw `.md` URLs or CLI output when an
            agent needs the Markdown body. API tokens authenticate private document commands, while public raw
            links stay read-only and explicit.
          </p>
          <pre>
            <code>{`# Share returns htmlPath and markdownPath
/d/<share-token>.md

# Unshare revokes both URLs`}</code>
          </pre>
        </section>
      </main>
    </div>
  );
}
