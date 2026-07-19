"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AuthBoundary, RoutePending, useAuth } from "../auth";
import { Brand } from "../brand";

type APIToken = {
  id: string;
  name: string;
  createdAt: string;
  lastUsedAt?: string | null;
};

type TokenStatus = "idle" | "loading" | "creating" | "revoking" | "copied" | "error";

async function apiTokens(): Promise<APIToken[]> {
  const res = await fetch("/api/v1/api-tokens", { credentials: "include" });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof body.error === "string" ? body.error : "API tokens could not be loaded");
  return Array.isArray(body.tokens) ? body.tokens : [];
}

async function apiCreateToken(name: string): Promise<{ token: string; apiToken: APIToken }> {
  const res = await fetch("/api/v1/api-tokens", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name })
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof body.error === "string" ? body.error : "API token could not be created");
  return body as { token: string; apiToken: APIToken };
}

async function apiRevokeToken(id: string): Promise<void> {
  const res = await fetch(`/api/v1/api-tokens/${encodeURIComponent(id)}`, { method: "DELETE", credentials: "include" });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(typeof body.error === "string" ? body.error : "API token could not be revoked");
  }
}

async function redirectFrom(path: string): Promise<void> {
  const res = await fetch(path, { method: "POST", credentials: "include" });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof body.error === "string" ? body.error : "Billing action failed");
  if (typeof body.url === "string") window.location.assign(body.url);
}

function formatDate(value?: string | null) {
  if (!value) return "Not available";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not available";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export default function Account() {
  return (
    <AuthBoundary>
      <AccountGate />
    </AuthBoundary>
  );
}

function AccountGate() {
  const { loading, refreshAccount, routeRevalidating, sessionStatus, user } = useAuth();

  useEffect(() => {
    if (routeRevalidating) return;
    if (!loading && !user && sessionStatus === "unknown") {
      void refreshAccount().catch(() => undefined);
    } else if (!loading && !user && sessionStatus === "anonymous") {
      window.location.replace(`/login?next=${encodeURIComponent("/account")}`);
    }
  }, [loading, refreshAccount, routeRevalidating, sessionStatus, user]);

  if (loading || routeRevalidating || sessionStatus === "unknown") return <RoutePending />;
  if (!user) return <RoutePending label="Redirecting to sign in" />;
  return <AccountPage />;
}

function AccountPage() {
  const auth = useAuth();
  const account = auth.account;
  const isPro = account?.plan === "pro";
  const isCommunity = account?.source === "community";
  const hasStripeCustomer = Boolean(account?.subscription.stripeCustomerId);
  const [billingError, setBillingError] = useState("");

  async function startBilling(path: string) {
    setBillingError("");
    try {
      await redirectFrom(path);
    } catch (err) {
      setBillingError(err instanceof Error ? err.message : "Billing action failed");
    }
  }

  return (
    <main className="accountShell">
      <header className="accountTop">
        <Brand href="/write" />
        <nav className="accountNav" aria-label="Account navigation">
          <Link className="textButton" href="/write">
            Write
          </Link>
        </nav>
      </header>

      <div className="accountMain">
        <section className="accountHeader">
          <div>
            <p className="accountKicker">Settings</p>
            <h1>Account</h1>
            <p className="accountEmail">{auth.user?.email}</p>
          </div>
          <span className="accountBadge">{isPro ? "Pro" : "Free"}</span>
        </section>

        <section className="accountSections">
          <div className="accountPanel">
            <div className="accountPanelIntro">
              <h2>Plan</h2>
              <p>Billing and saved document access.</p>
            </div>
            <div className="accountPanelBody">
              <dl className="accountMetaList">
                <div>
                  <dt>Plan</dt>
                  <dd>{isPro ? "Pro" : "Free"}</dd>
                </div>
                <div>
                  <dt>Saved documents</dt>
                  <dd>
                    {account?.usage.savedDocs ?? 0} of {account?.limits.maxSavedDocs ?? 5}
                  </dd>
                </div>
                <div>
                  <dt>{isCommunity ? "Access" : "Subscription"}</dt>
                  <dd>{isCommunity ? "Community access" : account?.subscription.status ?? "None"}</dd>
                </div>
                <div>
                  <dt>{isCommunity ? "Cost" : "Renews"}</dt>
                  <dd>{isCommunity ? "Included at no cost. No renewal." : formatDate(account?.subscription.currentPeriodEnd)}</dd>
                </div>
              </dl>
              {isPro && hasStripeCustomer ? (
                <button
                  type="button"
                  className="btnPrimary accountAction"
                  onClick={() => void startBilling("/api/v1/billing/portal")}
                >
                  Manage billing
                </button>
              ) : !isPro ? (
                <button
                  type="button"
                  className="btnPrimary accountAction"
                  onClick={() => void startBilling("/api/v1/billing/checkout")}
                >
                  Upgrade
                </button>
              ) : isCommunity ? (
                <p className="mutedLine">Community access is included at no cost.</p>
              ) : (
                <p className="mutedLine">Billing is managed manually.</p>
              )}
              {billingError && <p className="authError">{billingError}</p>}
            </div>
          </div>

          <div className="accountPanel">
            <div className="accountPanelIntro">
              <h2>API tokens</h2>
              <p>Create tokens for the CLI and API.</p>
            </div>
            <div className="accountPanelBody">
              <TokenManager locked={!isPro} />
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

function TokenManager({ locked }: { locked: boolean }) {
  const [tokens, setTokens] = useState<APIToken[]>([]);
  const [tokenName, setTokenName] = useState("CLI");
  const [createdToken, setCreatedToken] = useState("");
  const [createdTokenId, setCreatedTokenId] = useState("");
  const [status, setStatus] = useState<TokenStatus>("loading");
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setStatus("loading");
      try {
        const loaded = await apiTokens();
        if (!cancelled) {
          setTokens(loaded);
          setStatus("idle");
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "API tokens could not be loaded");
          setStatus("error");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function copyText(text: string) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      window.prompt("Copy this token", text);
    }
  }

  async function createToken() {
    if (locked || status === "creating" || status === "revoking") return;
    const name = tokenName.trim();
    if (!name) {
      setError("Token name is required");
      setStatus("error");
      return;
    }
    setError("");
    setStatus("creating");
    try {
      const created = await apiCreateToken(name);
      setTokens((prev) => [created.apiToken, ...prev.filter((token) => token.id !== created.apiToken.id)]);
      setCreatedToken(created.token);
      setCreatedTokenId(created.apiToken.id);
      setTokenName("CLI");
      await copyText(created.token);
      setStatus("copied");
    } catch (err) {
      setError(err instanceof Error ? err.message : "API token could not be created");
      setStatus("error");
    }
  }

  async function revokeToken(id: string) {
    if (status === "creating" || status === "revoking") return;
    setError("");
    setStatus("revoking");
    try {
      await apiRevokeToken(id);
      setTokens((prev) => prev.filter((token) => token.id !== id));
      if (id === createdTokenId) {
        setCreatedToken("");
        setCreatedTokenId("");
      }
      setStatus("idle");
    } catch (err) {
      setError(err instanceof Error ? err.message : "API token could not be revoked");
      setStatus("error");
    }
  }

  return (
    <div className="accountTokens">
      {locked && <p className="mutedLine">API tokens are included with Pro.</p>}
      <label className="tokenField">
        <span>Name</span>
        <input
          className="authInput"
          type="text"
          name="api-token-name"
          value={tokenName}
          maxLength={80}
          disabled={locked}
          onChange={(e) => setTokenName(e.target.value)}
        />
      </label>
      <button
        type="button"
        className="btnPrimary accountAction"
        disabled={locked || status === "creating" || status === "revoking"}
        onClick={() => void createToken()}
      >
        {status === "creating" ? "Creating" : "Create token"}
      </button>
      {createdToken && (
        <div className="createdToken">
          <span className="createdTokenLabel">Copy now</span>
          <code>{createdToken}</code>
          <button type="button" className="tokenCopy" onClick={() => void copyText(createdToken)}>
            {status === "copied" ? "Copied" : "Copy"}
          </button>
        </div>
      )}
      {error && <p className="authError">{error}</p>}
      <div className="tokenList">
        {tokens.map((token) => (
          <div className="tokenRow" key={token.id}>
            <span className="tokenInfo">
              <span className="tokenName">{token.name}</span>
              <span className="tokenMeta">Created {formatDate(token.createdAt)}</span>
            </span>
            <button
              type="button"
              className="tokenRevoke"
              onClick={() => void revokeToken(token.id)}
              disabled={status === "creating" || status === "revoking"}
            >
              Revoke
            </button>
          </div>
        ))}
        {status !== "loading" && tokens.length === 0 && <p className="tokenEmpty">No API tokens yet.</p>}
      </div>
    </div>
  );
}
