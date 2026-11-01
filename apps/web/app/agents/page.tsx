import Link from "next/link";
import { Brand } from "../brand";
import { claudeCodeCommand, MCP_URL } from "../mcp";

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
    <div className="agentsPage">
      <header className="agentsNav">
        <Brand href="/" />
        <nav className="agentsNavLinks" aria-label="Agents navigation">
          <Link href="/write">Write</Link>
          <Link href="/account">Account</Link>
        </nav>
      </header>

      <main className="agentsMain">
        <section className="agentsHero">
          <p className="agentsKicker">Agents</p>
          <h1>Connect your agents to Passage.</h1>
          <p>
            Passage runs an MCP server, so Claude Code, Cursor, Codex and other agents can search, read and edit the
            same private Markdown you write in the browser. Included with Pro.
          </p>
          <div className="agentsActions">
            <Link className="btnPrimary" href="/account">
              Create an API token
            </Link>
          </div>
        </section>

        <section className="agentsBand" aria-labelledby="token-heading">
          <div className="agentsSectionHead">
            <p className="agentsKicker">Step 1</p>
            <h2 id="token-heading">Create an API token</h2>
          </div>
          <ol className="agentsSteps">
            <li>Open your account page while signed in.</li>
            <li>Create a token named after the agent, like `Claude Code`. Every edit it makes shows that name.</li>
            <li>Copy the token when it appears. Passage only shows it once.</li>
          </ol>
        </section>

        <section className="agentsBand" aria-labelledby="connect-heading">
          <div className="agentsSectionHead">
            <p className="agentsKicker">Step 2</p>
            <h2 id="connect-heading">Add Passage to your agent</h2>
          </div>
          <div className="agentsGrid">
            <div className="agentsPanel">
              <h3>Claude Code</h3>
              <p>Run this once with your token. Passage is then available in every session.</p>
              <pre>
                <code>{claudeCodeCommand()}</code>
              </pre>
            </div>
            <div className="agentsPanel">
              <h3>Other MCP clients</h3>
              <p>Clients that support remote MCP servers take the URL and the header.</p>
              <pre>
                <code>{clientConfig}</code>
              </pre>
            </div>
          </div>
        </section>

        <section className="agentsBand" aria-labelledby="tools-heading">
          <div className="agentsSectionHead">
            <p className="agentsKicker">Tools</p>
            <h2 id="tools-heading">What your agent can do</h2>
          </div>
          <div className="agentsCommandList">
            {tools.map(([tool, detail]) => (
              <div className="agentsCommand" key={tool}>
                <code>{tool}</code>
                <span>{detail}</span>
              </div>
            ))}
          </div>
          <p className="agentsBody">Then just ask. For example:</p>
          <ul className="agentsSteps">
            {prompts.map((prompt) => (
              <li key={prompt}>{prompt}</li>
            ))}
          </ul>
        </section>

        <section className="agentsBand" aria-labelledby="safety-heading">
          <div className="agentsSectionHead">
            <p className="agentsKicker">Safety</p>
            <h2 id="safety-heading">You stay in charge</h2>
          </div>
          <p className="agentsBody">
            Agents edit on top of your latest text, so they never overwrite a sentence you just typed. They cannot
            share or delete documents. Revoke a token from your account page and that agent loses access at once.
          </p>
        </section>
      </main>
    </div>
  );
}
