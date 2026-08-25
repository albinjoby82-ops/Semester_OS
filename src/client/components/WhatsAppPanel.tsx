import type { WhatsAppStatusView } from "../lib/api";

export function WhatsAppPanel({ status }: { status: WhatsAppStatusView | null }) {
  if (!status) return null;

  const webhook = `${window.location.origin}/api/whatsapp/webhook`;

  return (
    <section className="whatsapp-panel">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="panel-kicker">Capture by message</p>
          <h2>WhatsApp quick add</h2>
        </div>
        <span className={status.configured ? "status-dot is-ready" : "status-dot"}>
          {status.configured ? "Ready" : "Setup needed"}
        </span>
      </div>

      {status.configured ? (
        <>
          <p>
            Send a message to your connected WhatsApp number and it will become a
            task automatically. Only {status.allowedNumbers} approved number{status.allowedNumbers === 1 ? " is" : "s are"} allowed to add tasks.
          </p>
          <div className="message-example">digital lab friday 90m</div>
          <p className="panel-muted">
            {status.signatureValidation
              ? "Webhook requests are verified with your Meta app secret."
              : "Add WHATSAPP_APP_SECRET to enable Meta webhook verification."}
          </p>
        </>
      ) : (
        <>
          <p>
            Connect a Meta WhatsApp Cloud API app to turn messages into tasks.
            The app replies with a short confirmation after saving each one.
          </p>
          <ol className="setup-list">
            <li>Create a Meta Developer app and add WhatsApp.</li>
            <li>Set this as the webhook callback URL: <code>{webhook}</code></li>
            <li>Subscribe to <strong>messages</strong>, then set the five Worker secrets below.</li>
          </ol>
          <div className="secret-list">
            <code>WHATSAPP_VERIFY_TOKEN</code>
            <code>WHATSAPP_APP_SECRET</code>
            <code>WHATSAPP_TOKEN</code>
            <code>WHATSAPP_PHONE_ID</code>
            <code>WHATSAPP_ALLOWED_FROM</code>
          </div>
        </>
      )}
    </section>
  );
}
