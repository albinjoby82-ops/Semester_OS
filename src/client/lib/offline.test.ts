import { describe, expect, it, vi } from "vitest";
import { flushQueue, type CaptureStore, type QueuedCapture } from "./offline";

/**
 * flushQueue holds the retry policy, which is the part with real decisions in
 * it. It takes its storage as an argument, so this needs no browser and no
 * module mocking. The IndexedDB wrappers around it are thin and are exercised
 * in the browser instead.
 */

const item = (id: string): QueuedCapture => ({
  id,
  title: `Task ${id}`,
  areaId: "university",
  moduleId: null,
  dueAt: null,
  estimatedMinutes: null,
  source: "manual",
  queuedAt: "2026-09-09T10:00:00.000Z",
  attempts: 0,
});

function memoryStore(initial: QueuedCapture[]): CaptureStore & {
  items: () => QueuedCapture[];
} {
  let queue = [...initial];
  return {
    read: async () => [...queue],
    remove: async (id) => {
      queue = queue.filter((i) => i.id !== id);
    },
    items: () => queue,
  };
}

const ok = async () => new Response(null, { status: 201 });
const offline = async () => {
  throw new TypeError("Failed to fetch");
};

describe("flushQueue", () => {
  it("sends everything and empties the queue when online", async () => {
    const store = memoryStore([item("a"), item("b")]);
    const result = await flushQueue(ok, store);

    expect(result).toEqual({ sent: 2, remaining: 0 });
    expect(store.items()).toHaveLength(0);
  });

  it("keeps items queued when the network fails", async () => {
    const store = memoryStore([item("a"), item("b")]);
    const result = await flushQueue(offline, store);

    expect(result).toEqual({ sent: 0, remaining: 2 });
    expect(store.items()).toHaveLength(2);
  });

  it("stops at the first network failure instead of hammering", async () => {
    const store = memoryStore([item("a"), item("b"), item("c")]);
    const send = vi.fn(offline);

    await flushQueue(send, store);
    // Later items would fail identically; one attempt is enough to know.
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("drops an item the server rejects on its merits", async () => {
    // A malformed capture that can never succeed must not block the queue
    // behind it forever.
    const store = memoryStore([item("bad"), item("good")]);

    const result = await flushQueue(
      async (queued) =>
        queued.id === "bad"
          ? new Response(null, { status: 400 })
          : new Response(null, { status: 201 }),
      store,
    );

    expect(result).toEqual({ sent: 1, remaining: 0 });
    expect(store.items()).toHaveLength(0);
  });

  it("retries a server error rather than discarding the capture", async () => {
    // A 500 is the server's problem, not the capture's.
    const store = memoryStore([item("a")]);
    const result = await flushQueue(
      async () => new Response(null, { status: 500 }),
      store,
    );

    expect(result).toEqual({ sent: 0, remaining: 1 });
    expect(store.items()).toHaveLength(1);
  });

  it("continues past a rejected item to send the rest", async () => {
    const store = memoryStore([item("bad"), item("a"), item("b")]);
    const result = await flushQueue(
      async (queued) =>
        queued.id === "bad"
          ? new Response(null, { status: 422 })
          : new Response(null, { status: 201 }),
      store,
    );
    expect(result.sent).toBe(2);
    expect(result.remaining).toBe(0);
  });

  it("handles an empty queue without calling the sender", async () => {
    const send = vi.fn(ok);
    expect(await flushQueue(send, memoryStore([]))).toEqual({
      sent: 0,
      remaining: 0,
    });
    expect(send).not.toHaveBeenCalled();
  });
});
