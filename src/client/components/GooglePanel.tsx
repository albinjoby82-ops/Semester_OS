import { useState } from "react";
import type { GoogleStatusView } from "../lib/api";

/**
 * Google connection.
 *
 * Read-only access to Calendar and Drive. The panel is explicit about what is
 * missing when unconfigured, because "connect" failing silently with no
 * explanation is the worst possible version of this.
 */
export function GooglePanel({
  status,
  onSync,
  onDisconnect,
  busy,
  message,
}: {
  status: GoogleStatusView | null;
  onSync: () => void;
  onDisconnect: () => void;
  busy: boolean;
  message: string | null;
}) {
  const [showSetup, setShowSetup] = useState(false);

  if (!status) return null;

  return (
    <section className="my-7 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-widest text-[var(--color-muted)]">
        Google
      </h2>

      {!status.configured ? (
        <>
          <p className="text-sm">
            Not configured. Calendar and Drive need an OAuth client before this
            can connect.
          </p>
          <button
            onClick={() => setShowSetup((value) => !value)}
            className="mt-2 text-xs text-[var(--color-accent)] underline underline-offset-2"
          >
            {showSetup ? "Hide setup steps" : "Show setup steps"}
          </button>
          {showSetup && <SetupSteps />}
        </>
      ) : status.connected ? (
        <>
          <p className="text-sm">
            Connected.{" "}
            <span className="text-[var(--color-muted)]">
              {status.lastSync
                ? `Last synced ${new Date(status.lastSync).toLocaleString("en-IE")}.`
                : "Not synced yet."}
            </span>
          </p>
          <p className="mt-1 text-[11px] text-[var(--color-muted)]">
            Read-only access to Calendar and Drive. Nothing is written back,
            and no files are copied into this app.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              onClick={onSync}
              disabled={busy}
              className="rounded-md border border-[var(--color-accent)] px-3 py-1.5 text-xs disabled:opacity-50"
            >
              {busy ? "Syncing…" : "Sync calendar"}
            </button>
            <button
              onClick={onDisconnect}
              disabled={busy}
              className="rounded-md border border-[var(--color-border)] px-3 py-1.5 text-xs text-[var(--color-muted)] disabled:opacity-50"
            >
              Disconnect
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="text-sm">
            Configured but not connected. Calendar becomes the source of truth
            for your timetable, replacing hand-entered commitments.
          </p>
          <a
            href="/api/google/auth"
            className="mt-3 inline-block rounded-md border border-[var(--color-accent)] px-3 py-1.5 text-xs"
          >
            Connect Google
          </a>
        </>
      )}

      {message && (
        <p className="mt-3 rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-2.5 py-2 text-xs">
          {message}
        </p>
      )}
    </section>
  );
}

function SetupSteps() {
  return (
    <ol className="mt-3 space-y-1.5 text-[11px] leading-relaxed text-[var(--color-muted)]">
      <li>
        1. At <Code>console.cloud.google.com</Code>, create a project and enable
        the <Code>Google Calendar API</Code> and <Code>Google Drive API</Code>.
      </li>
      <li>
        2. Configure the OAuth consent screen as <strong>External</strong>, and
        add yourself as a test user.
      </li>
      <li>
        3. Create an <strong>OAuth client ID</strong> of type{" "}
        <em>Web application</em>, with the redirect URI{" "}
        <Code>{`${window.location.origin}/api/google/callback`}</Code>.
      </li>
      <li>
        4. Store the credentials as Worker secrets:{" "}
        <Code>wrangler secret put GOOGLE_CLIENT_ID</Code> and{" "}
        <Code>wrangler secret put GOOGLE_CLIENT_SECRET</Code>. For local dev put
        them in <Code>.dev.vars</Code> instead, which is gitignored.
      </li>
      <li className="text-amber-300/90">
        5. Note: while the consent screen is in <strong>Testing</strong>, Google
        expires refresh tokens after 7 days, so you will need to reconnect
        weekly. Publishing the app removes that limit.
      </li>
    </ol>
  );
}

function Code({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded bg-[var(--color-bg)] px-1 py-0.5 text-[10px] text-[var(--color-fg)]">
      {children}
    </code>
  );
}
