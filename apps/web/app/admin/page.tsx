"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AuthBoundary, PendingStatus, RoutePending, SessionError, useAuth } from "../auth";
import { Brand } from "../brand";

type AdminUser = {
  id: string;
  email: string;
  createdAt: string;
  plan: "free" | "pro";
  source: string;
  subscriptionStatus?: string;
  savedDocs: number;
  storedMarkdownBytes: number;
};

type AdminDashboard = {
  totals: {
    users: number;
    free: number;
    pro: number;
  };
  users: AdminUser[];
};

type DashboardStatus = "loading" | "ready" | "forbidden" | "error";

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function formatStoredMarkdown(value: number) {
  return `${new Intl.NumberFormat("en-GB").format(value)} B`;
}

function label(value: string) {
  if (!value) return "None";
  return value.charAt(0).toUpperCase() + value.slice(1).replaceAll("_", " ");
}

export default function Admin() {
  return (
    <AuthBoundary>
      <AdminGate />
    </AuthBoundary>
  );
}

function AdminGate() {
  const { loading, refreshAccount, routeRevalidating, sessionStatus, user } = useAuth();

  useEffect(() => {
    if (routeRevalidating) return;
    if (!loading && !user && sessionStatus === "unknown") {
      void refreshAccount().catch(() => undefined);
    } else if (!loading && !user && sessionStatus === "anonymous") {
      window.location.replace(`/login?next=${encodeURIComponent("/admin")}`);
    }
  }, [loading, refreshAccount, routeRevalidating, sessionStatus, user]);

  if (loading || routeRevalidating || sessionStatus === "unknown") return <RoutePending />;
  if (sessionStatus === "error") {
    return <SessionError onRetry={() => void refreshAccount().catch(() => undefined)} />;
  }
  if (!user) return <RoutePending label="Redirecting to sign in" />;
  return <AdminPage key={user.id} />;
}

function AdminPage() {
  const [dashboard, setDashboard] = useState<AdminDashboard | null>(null);
  const [status, setStatus] = useState<DashboardStatus>("loading");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/v1/admin/dashboard", { credentials: "include" });
        if (res.status === 403) {
          if (!cancelled) setStatus("forbidden");
          return;
        }
        if (!res.ok) throw new Error("Admin dashboard could not be loaded");
        const body = (await res.json()) as AdminDashboard;
        if (!cancelled) {
          setDashboard(body);
          setStatus("ready");
        }
      } catch {
        if (!cancelled) setStatus("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (status === "forbidden") return <main className="routeStatus">Admin access required</main>;
  if (status === "error") return <main className="routeStatus">Admin dashboard could not be loaded</main>;

  return (
    <main className="adminShell">
      <header className="adminTop">
        <Brand href="/write" />
        <nav className="adminNav" aria-label="Admin navigation">
          <Link className="textButton" href="/account">
            Account
          </Link>
          <Link className="textButton" href="/write">
            Write
          </Link>
        </nav>
      </header>

      <div className="adminMain">
        <section className="adminHeader">
          <p className="adminKicker">Admin</p>
          <h1>Accounts</h1>
          <p>A simple view of Passage users, active documents, and stored Markdown.</p>
        </section>

        {!dashboard ? (
          <PendingStatus label="Loading accounts" />
        ) : (
          <>
            <dl className="adminTotals" aria-label="Account totals">
              <div>
                <dt>Users</dt>
                <dd>{dashboard.totals.users}</dd>
              </div>
              <div>
                <dt>Free</dt>
                <dd>{dashboard.totals.free}</dd>
              </div>
              <div>
                <dt>Pro</dt>
                <dd>{dashboard.totals.pro}</dd>
              </div>
            </dl>

            <section className="adminAccounts" aria-labelledby="admin-users-heading">
              <div className="adminSectionHeading">
                <h2 id="admin-users-heading">Users</h2>
                <span>{dashboard.users.length}</span>
              </div>
              {dashboard.users.length === 0 ? (
                <p className="adminEmpty">No users yet.</p>
              ) : (
                <div className="adminTableWrap">
                  <table className="adminTable">
                    <thead>
                      <tr>
                        <th scope="col">Account</th>
                        <th scope="col">Plan</th>
                        <th scope="col">Source</th>
                        <th scope="col">Subscription</th>
                        <th scope="col" className="adminNumber">Documents</th>
                        <th scope="col" className="adminNumber">Stored Markdown</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dashboard.users.map((user) => (
                        <tr key={user.id}>
                          <td>
                            <strong>{user.email}</strong>
                            <span>Joined {formatDate(user.createdAt)}</span>
                          </td>
                          <td>
                            <span className={`adminPlan adminPlan${label(user.plan)}`}>{label(user.plan)}</span>
                          </td>
                          <td>{label(user.source)}</td>
                          <td>{label(user.subscriptionStatus ?? "")}</td>
                          <td className="adminNumber">{user.savedDocs}</td>
                          <td className="adminNumber">{formatStoredMarkdown(user.storedMarkdownBytes)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </main>
  );
}
