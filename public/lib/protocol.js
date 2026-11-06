// A tiny message protocol shared by the host and the frames.
//
// Every message is an envelope: { v, type, id, from, ts, payload }. Validating the shape is the second
// line of defence after checking *who* sent it: even a trusted sender can send garbage after a bug.

export const VERSION = 1;
export const TYPES = new Set(["hello", "port", "chat", "rpc:req", "rpc:res"]);
const MAX_TEXT = 500;

let counter = 0;

export function envelope(type, from, payload = {}, id = `${from}-${Date.now()}-${++counter}`) {
  return { v: VERSION, type, id, from, ts: Date.now(), payload };
}

/** Returns an error string, or null if `data` is a well-formed envelope. */
export function invalid(data) {
  if (typeof data !== "object" || data === null) return "not an object";
  if (data.v !== VERSION) return "wrong version";
  if (!TYPES.has(data.type)) return `unknown type ${JSON.stringify(data.type)}`;
  if (typeof data.id !== "string" || typeof data.from !== "string") return "missing id or from";
  if (typeof data.payload !== "object" || data.payload === null) return "missing payload";
  if (data.type === "chat" && (typeof data.payload.text !== "string" || data.payload.text.length > MAX_TEXT))
    return "chat text must be a string of at most 500 characters";
  return null;
}

/**
 * Request/response over any one-way transport. `send(msg)` posts a message; feed every incoming message
 * to `handle(msg)`. `request(payload)` resolves with the matching rpc:res, or rejects after `timeoutMs`.
 */
export function rpc(name, send, { timeoutMs = 2000, onRequest = () => ({}) } = {}) {
  const pending = new Map();
  return {
    request(payload = {}) {
      const msg = envelope("rpc:req", name, payload);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(msg.id);
          reject(new Error(`no response to ${msg.id} within ${timeoutMs} ms`));
        }, timeoutMs);
        pending.set(msg.id, { resolve, timer, sent: performance.now() });
        send(msg);
      });
    },
    /** Returns true if the message was an RPC message (handled here). */
    handle(msg) {
      if (msg.type === "rpc:req") {
        send(envelope("rpc:res", name, { ...onRequest(msg.payload), replyTo: msg.id }));
        return true;
      }
      if (msg.type === "rpc:res") {
        const entry = pending.get(msg.payload.replyTo);
        if (entry) {
          clearTimeout(entry.timer);
          pending.delete(msg.payload.replyTo);
          entry.resolve({ ...msg, roundTripMs: performance.now() - entry.sent });
        }
        return true;
      }
      return false;
    },
  };
}
