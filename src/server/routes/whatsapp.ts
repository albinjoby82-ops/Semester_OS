import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { captureInbox, modules, tasks } from "../../../db/schema";
import type { AppContext } from "../index";
import { parseCapture } from "../../shared/parse-capture";
import { CURRENT_TERM } from "../../shared/term-config";
import { teachingWeekForDate } from "../../shared/term-week";

/**
 * WhatsApp capture via the Meta Cloud API.
 *
 * Capture belongs where the habit already is. This is an UPGRADE on the PWA
 * share target, never a dependency: if Meta's setup is painful or the number
 * lapses, the share sheet still works with no third party involved.
 *
 * Requires four Worker secrets:
 *   WHATSAPP_VERIFY_TOKEN  — any string; must match the webhook config
 *   WHATSAPP_APP_SECRET    — verifies signed inbound requests from Meta
 *   WHATSAPP_TOKEN         — Cloud API access token, for sending replies
 *   WHATSAPP_PHONE_ID      — the sending phone number id
 *   WHATSAPP_ALLOWED_FROM  — comma-separated msisdns permitted to capture
 */
export const whatsappRoute = new Hono<AppContext>();

const newId = () => crypto.randomUUID();

/**
 * Webhook verification handshake. Meta calls this once when the webhook is
 * configured and expects the challenge echoed back verbatim.
 */
whatsappRoute.get("/webhook", (c) => {
  const verifyToken = c.env.WHATSAPP_VERIFY_TOKEN;
  if (!verifyToken) return c.text("WhatsApp is not configured.", 400);

  const mode = c.req.query("hub.mode");
  const token = c.req.query("hub.verify_token");
  const challenge = c.req.query("hub.challenge");

  if (mode === "subscribe" && token === verifyToken && challenge) {
    return c.text(challenge, 200);
  }
  return c.text("Verification failed", 403);
});

interface WhatsAppPayload {
  entry?: {
    changes?: {
      value?: {
        messages?: {
          id?: string;
          from?: string;
          type?: string;
          text?: { body?: string };
        }[];
      };
    }[];
  }[];
}

/**
 * Inbound messages.
 *
 * Always returns 200, even on internal failure: Meta retries non-200
 * responses aggressively, and a retry storm caused by our own bug would be
 * worse than a dropped message we have already logged.
 */
whatsappRoute.post("/webhook", async (c) => {
  const db = c.get("db");

  if (!c.env.WHATSAPP_VERIFY_TOKEN) {
    return c.json({ ok: true, ignored: "not configured" });
  }

  const rawBody = await c.req.text();
  const appSecret = c.env.WHATSAPP_APP_SECRET;
  if (
    appSecret &&
    !(await validMetaSignature(
      rawBody,
      c.req.header("x-hub-signature-256"),
      appSecret,
    ))
  ) {
    return c.json({ ok: false, error: "Invalid webhook signature" }, 401);
  }

  let payload: WhatsAppPayload;
  try {
    payload = JSON.parse(rawBody) as WhatsAppPayload;
  } catch {
    return c.json({ ok: true, ignored: "unparseable body" });
  }

  // Only numbers on the allow-list may create tasks. Without this, anyone who
  // learns the number could write into the database.
  const allowed = (c.env.WHATSAPP_ALLOWED_FROM ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

  const moduleRows = await db.select().from(modules);
  const moduleByCode = new Map(moduleRows.map((m) => [m.code, m.id]));

  let captured = 0;
  const replies: { to: string; text: string }[] = [];

  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      for (const message of change.value?.messages ?? []) {
        if (message.type !== "text") continue;
        const body = message.text?.body?.trim();
        const from = message.from;
        if (!body || !from) continue;

        if (allowed.length > 0 && !allowed.includes(from)) continue;

        const taskId = message.id ?? newId();

        // Meta redelivers on any non-200, so a message already processed is a
        // no-op. Checking up front keeps the inbox an honest audit log rather
        // than accumulating a row per redelivery, and stops the reply and the
        // captured count from claiming work that already happened.
        const [existing] = await db
          .select({ id: tasks.id })
          .from(tasks)
          .where(eq(tasks.id, taskId))
          .limit(1);
        if (existing) continue;

        // Raw text lands first and unlinked, so a parsing failure can never
        // lose the capture. Same guarantee as the web path.
        const inboxId = newId();
        const receivedAt = new Date().toISOString();
        await db.insert(captureInbox).values({
          id: inboxId,
          rawText: body,
          source: "whatsapp",
          receivedAt,
        });

        const parsed = parseCapture(body);
        const moduleId = parsed.moduleCode
          ? (moduleByCode.get(parsed.moduleCode) ?? null)
          : null;

        await db
          .insert(tasks)
          .values({
            id: taskId,
            title: parsed.title,
            areaId: parsed.areaId ?? "university",
            moduleId,
            dueAt: parsed.dueAt,
            weekNumber: teachingWeekForDate(
              parsed.dueAt ? new Date(parsed.dueAt) : new Date(),
              CURRENT_TERM,
            ),
            estimatedMinutes: parsed.estimatedMinutes,
            source: "whatsapp",
            createdAt: receivedAt,
          })
          // Meta redelivers on any non-200, so keying on the message id makes
          // a redelivery a no-op rather than a duplicate task.
          .onConflictDoNothing();

        await db
          .update(captureInbox)
          .set({ resolvedTaskId: taskId, resolvedAt: new Date().toISOString() })
          .where(eq(captureInbox.id, inboxId));

        captured += 1;
        replies.push({
          to: from,
          text: confirmation(parsed.title, parsed.moduleCode, parsed.dueAt, parsed.estimatedMinutes),
        });
      }
    }
  }

  // Confirmations are best-effort: a failed reply must not fail the capture.
  for (const reply of replies) {
    await sendReply(c.env, reply.to, reply.text).catch(() => undefined);
  }

  return c.json({ ok: true, captured });
});

/** Safe status for Settings — no token material ever leaves the Worker. */
whatsappRoute.get("/status", (c) => {
  const allowed = (c.env.WHATSAPP_ALLOWED_FROM ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return c.json({
    configured: Boolean(
      c.env.WHATSAPP_VERIFY_TOKEN &&
      c.env.WHATSAPP_TOKEN &&
      c.env.WHATSAPP_PHONE_ID &&
      allowed.length > 0,
    ),
    signatureValidation: Boolean(c.env.WHATSAPP_APP_SECRET),
    allowedNumbers: allowed.length,
  });
});

async function validMetaSignature(
  body: string,
  header: string | undefined,
  appSecret: string,
): Promise<boolean> {
  if (!header?.startsWith("sha256=")) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(appSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(body),
  );
  const expected = `sha256=${[...new Uint8Array(signature)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")}`;
  if (expected.length !== header.length) return false;
  let different = 0;
  for (let index = 0; index < expected.length; index += 1) {
    different |= expected.charCodeAt(index) ^ header.charCodeAt(index);
  }
  return different === 0;
}

function confirmation(
  title: string,
  moduleCode: string | null,
  dueAt: string | null,
  minutes: number | null,
): string {
  const parts = [`Saved: ${title}`];
  if (moduleCode) parts.push(moduleCode);
  if (minutes) parts.push(`${minutes}m`);
  if (dueAt) {
    parts.push(
      `due ${new Date(dueAt).toLocaleDateString("en-IE", {
        day: "numeric",
        month: "short",
      })}`,
    );
  }
  return parts.join(" · ");
}

async function sendReply(
  env: { WHATSAPP_TOKEN?: string; WHATSAPP_PHONE_ID?: string },
  to: string,
  text: string,
): Promise<void> {
  if (!env.WHATSAPP_TOKEN || !env.WHATSAPP_PHONE_ID) return;

  await fetch(
    `https://graph.facebook.com/v21.0/${env.WHATSAPP_PHONE_ID}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.WHATSAPP_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: { body: text },
      }),
    },
  );
}

/** Recent inbound captures, for checking the channel is actually working. */
whatsappRoute.get("/inbox", async (c) => {
  const rows = await c.get("db").select().from(captureInbox);
  return c.json(
    rows
      .filter((row) => row.source === "whatsapp")
      .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))
      .slice(0, 20),
  );
});
