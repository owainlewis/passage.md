import Link from "next/link";
import { Brand } from "../brand";
import { claudeCodeCommandLines, MCP_URL } from "../mcp";
import paper from "../paper.module.css";
import styles from "../reading.module.css";

const clientConfig = `{
  "mcpServers": {
    "passage": {
      "type": "http",
      "url": "${MCP_URL}",
      "headers": { "Authorization": "Bearer psg_..." }
    }
  }
}`;

const tools = [
  ["search_documents", "Search every word you have written. Title matches come first."],
  ["list_documents", "List your documents, newest first."],
  ["read_document", "Read one document's Markdown."],
  ["create_document", "Start a new private document."],
  ["edit_document", "Replace one exact passage and leave the rest alone."],
  ["append_to_document", "Add Markdown to the end of a document."]
];

const prompts = [
  "Find my notes on pricing and summarise them.",
  "Tighten the intro of my launch post.",
  "Append today's meeting notes to my weekly log."
];

export default function AgentsPage() {
  return (
    <div className={paper.paper}>
      <header className={paper.bar}>
        <Brand href="/" />
        <nav className={paper.barGroup} aria-label="Agents navigation">
          <Link className={paper.barLink} href="/write">Write</Link>
          <Link className={paper.barLink} href="/account">Account</Link>
        </nav>
      </header>

      <main className={styles.column}>
        <h1 className={styles.title}>Connect your agents to Passage.</h1>
        <p className={styles.lead}>
          Passage runs an MCP server, so Claude Code, Cursor, Codex and other agents can search, read and edit the
          same private Markdown you write in the browser. Included with Pro.
        </p>
        <div className={styles.actions}>
          <Link className={paper.primaryButton} href="/account">
            Create an API token
          </Link>
        </div>

        <div className={styles.prose}>
          <section aria-labelledby="token-heading">
            <p className={styles.step}>Step 1</p>
            <h2 id="token-heading">Create an API token</h2>
            <ol>
              <li>Open your account page while signed in.</li>
              <li>
                Create a token named after the agent, like <code>Claude Code</code>. Every edit it makes shows that
                name.
              </li>
              <li>Copy the token when it appears. Passage only shows it once.</li>
            </ol>
          </section>

          <section aria-labelledby="connect-heading">
            <p className={styles.step}>Step 2</p>
            <h2 id="connect-heading">Add Passage to your agent</h2>
            <h3>Claude Code</h3>
            <p>Run this once with your token. Passage is then available in every session.</p>
            <pre>
              <code>{claudeCodeCommandLines()}</code>
            </pre>
            <h3>Other MCP clients</h3>
            <p>Clients that support remote MCP servers take the URL and the header.</p>
            <pre>
              <code>{clientConfig}</code>
            </pre>
          </section>

          <section aria-labelledby="tools-heading">
            <h2 id="tools-heading">What your agent can do</h2>
            <div className={styles.tools}>
              {tools.map(([tool, detail]) => (
                <div className={styles.tool} key={tool}>
                  <code>{tool}</code>
                  <span>{detail}</span>
                </div>
              ))}
            </div>
            <p>Then just ask. For example:</p>
            <ul>
              {prompts.map((prompt) => (
                <li key={prompt}>{prompt}</li>
              ))}
            </ul>
          </section>

          <section aria-labelledby="safety-heading">
            <h2 id="safety-heading">You stay in charge</h2>
            <p>
              Agents edit on top of your latest text, so they never overwrite a sentence you just typed. They cannot
              share or delete documents. Revoke a token from your account page and that agent loses access at once.
            </p>
          </section>
        </div>
      </main>
    </div>
  );
}
