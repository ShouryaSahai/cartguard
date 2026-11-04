// In-process event bus for live run streaming (SSE). Subscribers are
// per-request; a dead listener never breaks the publisher.

export interface RunEvent {
  type: "step" | "status" | "done";
  data: unknown;
}

const subscribers = new Map<string, Set<(event: RunEvent) => void>>();
const buffers = new Map<string, RunEvent[]>();
const BUFFER_CAP = 100;
const BUFFERED_REQUEST_CAP = 500;

export function subscribe(requestId: string, listener: (event: RunEvent) => void): () => void {
  // Replay the buffered history first (synchronous — no race with live events).
  for (const event of buffers.get(requestId) ?? []) {
    try {
      listener(event);
    } catch {
      // Same isolation as live delivery.
    }
  }
  const set = subscribers.get(requestId) ?? new Set();
  set.add(listener);
  subscribers.set(requestId, set);
  return () => {
    set.delete(listener);
    if (set.size === 0) subscribers.delete(requestId);
  };
}

export function publish(requestId: string, event: RunEvent): void {
  const buffer = buffers.get(requestId) ?? [];
  buffer.push(event);
  if (buffer.length > BUFFER_CAP) buffer.shift();
  buffers.set(requestId, buffer);
  if (buffers.size > BUFFERED_REQUEST_CAP) {
    for (const [key, buffered] of buffers) {
      if (!subscribers.has(key) && buffered.length === 0) buffers.delete(key);
    }
  }
  for (const listener of subscribers.get(requestId) ?? []) {
    try {
      listener(event);
    } catch {
      // A broken stream must never break the pipeline.
    }
  }
}

export function subscriberCount(requestId: string): number {
  return subscribers.get(requestId)?.size ?? 0;
}
