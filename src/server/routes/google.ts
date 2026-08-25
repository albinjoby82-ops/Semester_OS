import { Hono, type Context } from "hono";
import { eq } from "drizzle-orm";
import { calendarEvents, modules, resources } from "../../../db/schema";
import type { AppContext } from "../index";
import {
  buildAuthUrl,
  consumeState,
  disconnect,
  exchangeCode,
  getAccessToken,
  getStatus,
  readConfig,
  recordSync,
} from "../services/google-auth";
import { syncGoogleCalendar } from "../services/google-calendar";
import {
  escapeDriveQuery,
  FOLDER_MIME,
  indexFile,
  type DriveFile,
} from "../../shared/drive";

export const googleRoute = new Hono<AppContext>();

const newId = () => crypto.randomUUID();

/** Redirect URI must match the Google console entry exactly. */
const redirectUriFor = (request: Request): string =>
  new URL("/api/google/callback", new URL(request.url).origin).toString();

googleRoute.get("/status", async (c) => {
  const config = readConfig(c.env);
  return c.json(await getStatus(c.get("db"), Boolean(config)));
});

googleRoute.get("/auth", async (c) => {
  const config = readConfig(c.env);
  if (!config) {
    return c.json(
      {
        error:
          "Google is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET as Worker secrets.",
      },
      400,
    );
  }
  const redirectUri = config.redirectUri || redirectUriFor(c.req.raw);
  return c.redirect(await buildAuthUrl(c.get("db"), config, redirectUri));
});

googleRoute.get("/callback", async (c) => {
  const db = c.get("db");
  const config = readConfig(c.env);
  if (!config) return c.text("Google is not configured.", 400);

  const error = c.req.query("error");
  if (error) return c.redirect(`/?google=${encodeURIComponent(error)}`);

  const code = c.req.query("code");
  const state = c.req.query("state") ?? null;

  // State is single-use and must match, or this is a forged callback.
  if (!(await consumeState(db, state))) {
    return c.redirect("/?google=invalid_state");
  }
  if (!code) return c.redirect("/?google=missing_code");

  const redirectUri = config.redirectUri || redirectUriFor(c.req.raw);
  const result = await exchangeCode(db, config, code, redirectUri);
  if (!result.ok) {
    return c.redirect(`/?google=${encodeURIComponent(result.error)}`);
  }
  return c.redirect("/?google=connected");
});

googleRoute.post("/disconnect", async (c) => {
  await disconnect(c.get("db"));
  return c.json({ ok: true });
});

type GoogleContext = Context<AppContext>;

/**
 * Resolve an access token, or return the response explaining what to do.
 * Callers check for `error` first, which keeps every route's failure path
 * identical and impossible to forget.
 */
async function requireToken(
  c: GoogleContext,
): Promise<{ token: string } | { error: Response }> {
  const config = readConfig(c.env);
  if (!config) {
    return { error: c.json({ error: "Google is not configured." }, 400) };
  }
  const token = await getAccessToken(c.get("db"), config);
  if (!token) {
    return {
      error: c.json(
        { error: "Not connected to Google, or the connection has expired." },
        401,
      ),
    };
  }
  return { token };
}

/**
 * Mirror Calendar into the local table.
 *
 * Read-only, and only the minimum fields needed to answer "how much time is
 * free" and "what is next" (brief section 15). The user keeps one calendar;
 * this never asks them to maintain a duplicate.
 */
googleRoute.post("/calendar/sync", async (c) => {
  const db = c.get("db");
  const auth = await requireToken(c);
  if ("error" in auth) return auth.error;

  const daysBack = Number(c.req.query("daysBack") ?? 14);
  const daysAhead = Number(c.req.query("daysAhead") ?? 120);
  try {
    return c.json(
      await syncGoogleCalendar(db, auth.token, { daysBack, daysAhead }),
    );
  } catch (cause) {
    return c.json(
      { error: cause instanceof Error ? cause.message : "Calendar sync failed" },
      502,
    );
  }
});

/** Mirrored events, for capacity and the next-commitment gap. */
googleRoute.get("/calendar/events", async (c) => {
  const rows = await c.get("db").select().from(calendarEvents);
  return c.json(rows);
});

/** Browse Drive folders so a module can be mapped to one. */
googleRoute.get("/drive/folders", async (c) => {
  const auth = await requireToken(c);
  if ("error" in auth) return auth.error;

  const search = c.req.query("q")?.trim();
  const parent = c.req.query("parent")?.trim();

  const clauses = [`mimeType = '${FOLDER_MIME}'`, "trashed = false"];
  if (search) clauses.push(`name contains '${escapeDriveQuery(search)}'`);
  if (parent) clauses.push(`'${escapeDriveQuery(parent)}' in parents`);

  const params = new URLSearchParams({
    q: clauses.join(" and "),
    fields: "files(id,name,parents,modifiedTime)",
    pageSize: "100",
    orderBy: "name",
  });

  const response = await fetch(
    `https://www.googleapis.com/drive/v3/files?${params}`,
    { headers: { Authorization: `Bearer ${auth.token}` } },
  );
  if (!response.ok) {
    return c.json({ error: `Drive request failed (${response.status})` }, 502);
  }

  const payload = (await response.json()) as { files?: DriveFile[] };
  return c.json(payload.files ?? []);
});

/** Map a module to a Drive folder. */
googleRoute.put("/drive/map/:code", async (c) => {
  const db = c.get("db");
  const code = c.req.param("code").toUpperCase();
  const body = await c.req.json<{ folderId?: string | null }>();

  const [module] = await db
    .select()
    .from(modules)
    .where(eq(modules.code, code))
    .limit(1);
  if (!module) return c.json({ error: "Module not found" }, 404);

  await db
    .update(modules)
    .set({ driveFolderId: body.folderId ?? null })
    .where(eq(modules.id, module.id));

  return c.json({ ok: true, moduleId: module.id, folderId: body.folderId ?? null });
});

/**
 * Index a mapped module folder, one level of subfolders deep.
 *
 * Deliberately shallow: the recommended layout is Module/Slides, Module/Labs
 * and so on, and walking arbitrarily deep would turn one click into dozens of
 * API calls for no benefit.
 */
googleRoute.post("/drive/index/:code", async (c) => {
  const db = c.get("db");
  const auth = await requireToken(c);
  if ("error" in auth) return auth.error;

  const code = c.req.param("code").toUpperCase();
  const [module] = await db
    .select()
    .from(modules)
    .where(eq(modules.code, code))
    .limit(1);
  if (!module) return c.json({ error: "Module not found" }, 404);
  if (!module.driveFolderId) {
    return c.json({ error: "This module has no Drive folder mapped yet." }, 400);
  }

  const listFolder = async (
    folderId: string,
  ): Promise<DriveFile[]> => {
    const params = new URLSearchParams({
      q: `'${escapeDriveQuery(folderId)}' in parents and trashed = false`,
      fields: "files(id,name,mimeType,webViewLink,modifiedTime)",
      pageSize: "200",
      orderBy: "name",
    });
    const response = await fetch(
      `https://www.googleapis.com/drive/v3/files?${params}`,
      { headers: { Authorization: `Bearer ${auth.token}` } },
    );
    if (!response.ok) throw new Error(`Drive listing failed (${response.status})`);
    const payload = (await response.json()) as { files?: DriveFile[] };
    return payload.files ?? [];
  };

  let indexed = 0;
  try {
    const top = await listFolder(module.driveFolderId);
    const batches: { path: string; files: DriveFile[] }[] = [
      { path: module.code, files: top.filter((f) => f.mimeType !== FOLDER_MIME) },
    ];

    for (const folder of top.filter((f) => f.mimeType === FOLDER_MIME)) {
      batches.push({
        path: `${module.code}/${folder.name}`,
        files: (await listFolder(folder.id)).filter(
          (f) => f.mimeType !== FOLDER_MIME,
        ),
      });
    }

    // Replace this module's index rather than accumulating stale rows for
    // files that have since been renamed, moved or deleted in Drive.
    await db.delete(resources).where(eq(resources.moduleId, module.id));

    for (const batch of batches) {
      for (const file of batch.files) {
        const record = indexFile(file, batch.path);
        if (!record) continue;
        await db.insert(resources).values({
          id: newId(),
          moduleId: module.id,
          title: record.title,
          type: record.type,
          googleDriveFileId: record.googleDriveFileId,
          weekNumber: record.weekNumber,
          source: "drive",
          url: record.url,
        });
        indexed += 1;
      }
    }
  } catch (cause) {
    return c.json(
      { error: cause instanceof Error ? cause.message : "Drive indexing failed" },
      502,
    );
  }

  await recordSync(db);
  return c.json({ indexed, moduleId: module.id });
});

/** Indexed resources for a module. */
googleRoute.get("/drive/resources/:code", async (c) => {
  const db = c.get("db");
  const code = c.req.param("code").toUpperCase();
  const [module] = await db
    .select()
    .from(modules)
    .where(eq(modules.code, code))
    .limit(1);
  if (!module) return c.json({ error: "Module not found" }, 404);

  const rows = await db
    .select()
    .from(resources)
    .where(eq(resources.moduleId, module.id));
  return c.json(rows);
});
