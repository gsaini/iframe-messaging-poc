// The host page: embeds frame A and frame B, and depending on the pattern either relays their
// messages (1), hands them a private channel and steps out of the way (2), or does nothing at all (3).

import { ORIGINS } from "/lib/config.js";
import { envelope, invalid } from "/lib/protocol.js";

const EXPLAIN = {
  relay:
    "Each frame posts to the parent, which checks the sender's origin and window, then forwards the message to the other frame with an exact targetOrigin. The parent sees, and can filter, everything.",
  channel:
    "The parent waits for both frames to say hello, creates a MessageChannel, and transfers one port to each. From then on A and B talk port-to-port; the parent is no longer in the path and sees nothing.",
  broadcast:
    "Both frames are loaded from the same origin and join the same BroadcastChannel. The browser delivers to every same-origin context that joined that channel; the parent isn't involved.",
  "broadcast-cross":
    "Same code as 3, but A and B are on different origins. BroadcastChannel is scoped to one origin (and storage partition), so nothing is delivered. Use pattern 1 or 2 across origins.",
};

const $ = (id) => document.getElementById(id);
const stats = { accepted: 0, rejected: 0 };
let frames = {}; // name → { el, origin }
let hellos = new Set();

$("host-origin").textContent = location.origin;

function log(text, cls = "") {
  const li = document.createElement("li");
  li.textContent = `${new Date().toISOString().slice(11, 23)}  ${text}`;
  if (cls) li.className = cls;
  $("log").prepend(li);
}

function count(kind) {
  stats[kind] += 1;
  document.querySelector(`[data-testid="${kind}"]`).textContent = stats[kind];
}

function frameOrigins(mode) {
  return mode === "broadcast" ? { A: ORIGINS.a, B: ORIGINS.a } : { A: ORIGINS.a, B: ORIGINS.b };
}

function render() {
  const mode = $("mode").value;
  $("explain").textContent = EXPLAIN[mode];
  $("frames").replaceChildren();
  frames = {};
  hellos = new Set();
  for (const [name, origin] of Object.entries(frameOrigins(mode))) {
    const el = document.createElement("iframe");
    el.title = `Frame ${name}`;
    el.dataset.testid = `frame-${name}`;
    // allow-same-origin keeps the frame's *own* origin (so it can use BroadcastChannel and storage).
    // It's only dangerous when the framed page is same-origin with the host, which these aren't (except in 3).
    el.sandbox = "allow-scripts allow-same-origin";
    el.src = `${origin}/?name=${name}&mode=${mode}`;
    $("frames").append(el);
    frames[name] = { el, origin };
  }
  if ($("evil").checked) {
    const el = document.createElement("iframe");
    el.title = "Attacker frame";
    el.className = "evil";
    el.dataset.testid = "frame-evil";
    // Keeps its real origin (:5173) so the logs show who it is. With an opaque origin it couldn't even load
    // its own module scripts without CORS.
    el.sandbox = "allow-scripts allow-same-origin";
    el.src = `${ORIGINS.evil}/`;
    $("frames").append(el);
  }
  log(`mode=${mode}: loading A from ${frames.A.origin}, B from ${frames.B.origin}`, "muted");
}

/** Which of our frames sent this event? Origin AND window must both match, or it's nobody we know. */
function senderOf(event) {
  for (const [name, { el, origin }] of Object.entries(frames)) {
    if (event.source === el.contentWindow && event.origin === origin) return name;
  }
  return null;
}

window.addEventListener("message", (event) => {
  const name = senderOf(event);
  if (!name) {
    count("rejected");
    return log(`rejected: message from ${event.origin || "(opaque origin)"} — not one of our frames`, "bad");
  }
  const problem = invalid(event.data);
  if (problem) {
    count("rejected");
    return log(`rejected from ${name}: ${problem}`, "bad");
  }
  const msg = event.data;
  if (msg.from !== name) {
    count("rejected");
    return log(`rejected: ${name} claimed to be ${msg.from}`, "bad");
  }
  count("accepted");
  const mode = $("mode").value;

  if (msg.type === "hello") {
    hellos.add(name);
    log(`hello from ${name}`);
    if (mode === "channel" && hellos.size === 2) handOutPorts();
    return;
  }
  if (mode === "relay") {
    const to = name === "A" ? "B" : "A";
    const target = frames[to];
    // Exact targetOrigin, never "*": if B navigated somewhere else, the browser drops the message.
    target.el.contentWindow.postMessage(msg, target.origin);
    log(`relay ${name} → ${to}: ${msg.type}${msg.type === "chat" ? ` "${msg.payload.text}"` : ""}`, "ok");
  } else {
    log(`unexpected ${msg.type} from ${name} in mode ${mode}`, "bad");
  }
});

function handOutPorts() {
  const { port1, port2 } = new MessageChannel();
  frames.A.el.contentWindow.postMessage(envelope("port", "host", { peer: "B" }), frames.A.origin, [port1]);
  frames.B.el.contentWindow.postMessage(envelope("port", "host", { peer: "A" }), frames.B.origin, [port2]);
  log("MessageChannel created: port1 → A, port2 → B. The parent is now out of the path.", "ok");
}

$("mode").addEventListener("change", render);
$("evil").addEventListener("change", render);
render();
