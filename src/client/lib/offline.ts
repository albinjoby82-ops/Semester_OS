/**
 * Offline capture queue.
 *
 * Capture must never fail. UCD basements have no signal, and a capture that
 * silently vanishes is worse than an app that is slow -- it destroys trust in
 * the one interaction the whole product depends on.
 *
 * Queued items carry a client-generated id, and the API insert is idempotent
 * on that id, so a retry can never duplicate a task.
 */

export interface QueuedCapture {
  id: string;
  title: string;
  areaId: string;
  moduleId: string | null;
  dueAt: string | null;
  estimatedMinutes: number | null;
  source: string;
  queuedAt: string;
  attempts: number;
}

const DB_NAME = "semester-os";
const DB_VERSION = 1;
const STORE = "captures";

/** localStorage fallback key, used when IndexedDB is unavailable. */
const FALLBACK_KEY = "semester-os.captureQueue";

function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      resolve(null);
      return;
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    // Private browsing and some locked-down profiles reject IndexedDB. Falling
    // back to localStorage keeps capture working rather than throwing.
    request.onerror = () => resolve(null);
  });
}

function readFallback(): QueuedCapture[] {
  try {
    const raw = localStorage.getItem(FALLBACK_KEY);
    return raw ? (JSON.parse(raw) as QueuedCapture[]) : [];
  } catch {
    return [];
  }
}

function writeFallback(items: QueuedCapture[]): void {
  try {
    localStorage.setItem(FALLBACK_KEY, JSON.stringify(items));
  } catch {
    // Storage full or blocked: nothing further we can do here.
  }
}

export async function enqueue(item: QueuedCapture): Promise<void> {
  const db = await openDb();
  if (!db) {
    const items = readFallback().filter((i) => i.id !== item.id);
    writeFallback([...items, item]);
    return;
  }

  await new Promise<void>((resolve) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(item);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}

export async function readQueue(): Promise<QueuedCapture[]> {
  const db = await openDb();
  if (!db) return readFallback();

  return new Promise((resolve) => {
    const tx = db.transaction(STORE, "readonly");
    const request = tx.objectStore(STORE).getAll();
    request.onsuccess = () => resolve((request.result as QueuedCapture[]) ?? []);
    request.onerror = () => resolve([]);
  });
}

export async function dequeue(id: string): Promise<void> {
  const db = await openDb();
  if (!db) {
    writeFallback(readFallback().filter((i) => i.id !== id));
    return;
  }

  await new Promise<void>((resolve) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}

export interface FlushResult {
  sent: number;
  remaining: number;
}

/**
 * Storage the flush operates on. Passed in explicitly rather than reached for
 * inside the function, so the retry policy is testable without a browser.
 */
export interface CaptureStore {
  read(): Promise<QueuedCapture[]>;
  remove(id: string): Promise<void>;
}

export const indexedDbStore: CaptureStore = {
  read: readQueue,
  remove: dequeue,
};

/**
 * Try to send everything queued.
 *
 * A 4xx means the server rejected the item on its merits, so it is dropped
 * rather than retried forever -- a malformed capture that can never succeed
 * would otherwise block the queue behind it. A 5xx is the server's problem,
 * not the capture's, so it stays queued. Network failures stay queued too.
 */
export async function flushQueue(
  send: (item: QueuedCapture) => Promise<Response>,
  store: CaptureStore = indexedDbStore,
): Promise<FlushResult> {
  const items = await store.read();
  let sent = 0;

  for (const item of items) {
    try {
      const response = await send(item);
      if (response.ok || (response.status >= 400 && response.status < 500)) {
        await store.remove(item.id);
        if (response.ok) sent += 1;
      }
    } catch {
      // Still offline. Leave it queued and stop: later items will fail too.
      break;
    }
  }

  return { sent, remaining: (await store.read()).length };
}

/** Ask the service worker to retry when connectivity returns. */
export async function requestBackgroundFlush(): Promise<void> {
  if (!("serviceWorker" in navigator)) return;
  try {
    const registration = await navigator.serviceWorker.ready;
    const sync = (registration as ServiceWorkerRegistration & {
      sync?: { register: (tag: string) => Promise<void> };
    }).sync;
    await sync?.register("flush-captures");
  } catch {
    // Background Sync is unsupported (notably on iOS). The online listener
    // and the next app launch both flush anyway.
  }
}
