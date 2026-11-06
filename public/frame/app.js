// One frame app, served on two origins as frame A and frame B. The UI and the protocol are the same in
// every pattern; only the transport underneath changes.

import { BROADCAST_CHANNEL, ORIGINS } from "/lib/config.js";
import { envelope, invalid, rpc } from "/lib/protocol.js";

const params = new URLSearchParams(location.search);
const NAME = params.get("name") === "B" ? "B" : "A";
const MODE = params.get("mode") ?? "relay";
const $ = (id) => document.getElementById(id);
let rejected = 0;

$("name").textContent = NAME;
$("origin").textContent = location.origin;

function show(text, cls = "") {
  const li = document.createElement("li");
  li.textContent = text;
  if (cls) li.className = cls;
  $("inbox").prepend(li);
}

function reject(reason) {
  rejected += 1;
  $("rejected").textContent = rejected;
  show(`rejected: ${reason}`, "bad");
}

// --- transports: each returns send(msg), and calls receive(msg) for every trusted, valid message ---------

function viaParent(receive) {
  // Pattern 1. Talk only to the parent, and accept only what the parent window sends from the host origin.
  window.addEventListener("message", (event) => {
    if (event.source !== window.parent || event.origin !== ORIGINS.host) {
      return reject(`message from ${event.origin || "(opaque origin)"}, not the host`);
    }
    receive(event.data, event);
  });
  return (msg) => window.parent.postMessage(msg, ORIGINS.host);
}

function viaPort(receive) {
  // Pattern 2. The parent is trusted once, to hand over a port. After that, messages arrive on the port,
  // which only the peer holds; a MessagePort has no origin to check, so trust comes from the handshake.
  let port = null;
  const queue = [];
  window.addEventListener("message", (event) => {
    if (event.source !== window.parent || event.origin !== ORIGINS.host) {
      return reject(`message from ${event.origin || "(opaque origin)"}, not the host`);
    }
    if (event.data?.type !== "port" || event.ports.length !== 1 || port) return;
    port = event.ports[0];
    port.onmessage = (e) => receive(e.data, e);
    $("transport").textContent = `MessageChannel port to ${event.data.payload.peer}`;
    for (const msg of queue.splice(0)) port.postMessage(msg);
  });
  return (msg) => (port ? port.postMessage(msg) : queue.push(msg));
}

function viaBroadcast(receive) {
  // Pattern 3. Every same-origin context that opens this channel name receives the message. The sender
  // doesn't receive its own messages. Different origins open *different* channels with the same name.
  const channel = new BroadcastChannel(BROADCAST_CHANNEL);
  channel.onmessage = (e) => receive(e.data, e);
  return (msg) => channel.postMessage(msg);
}

// --- wiring ---------------------------------------------------------------------------------------------

const peer = rpc(NAME, (msg) => send(msg), {
  onRequest: () => ({ name: NAME, origin: location.origin, time: new Date().toISOString() }),
});

function receive(msg) {
  const problem = invalid(msg);
  if (problem) return reject(problem);
  if (msg.from === NAME) return; // ignore our own echoes
  if (peer.handle(msg)) return;
  if (msg.type === "chat") show(`${msg.from}: ${msg.payload.text}`, "ok");
}

const send = { relay: viaParent, channel: viaPort, broadcast: viaBroadcast, "broadcast-cross": viaBroadcast }[
  MODE
](receive);

if (MODE === "relay") $("transport").textContent = "postMessage via the parent";
if (MODE.startsWith("broadcast")) $("transport").textContent = `BroadcastChannel "${BROADCAST_CHANNEL}"`;

// Tell the parent we're ready (it needs this before it can hand out ports in pattern 2).
window.parent.postMessage(envelope("hello", NAME), ORIGINS.host);

function sendChat() {
  const text = $("text").value.trim();
  if (!text) return;
  send(envelope("chat", NAME, { text }));
  show(`me: ${text}`, "muted");
  $("text").value = "";
}
$("send").addEventListener("click", sendChat);
$("text").addEventListener("keydown", (event) => event.key === "Enter" && sendChat());

$("ping").addEventListener("click", async () => {
  try {
    const res = await peer.request();
    show(`pong from ${res.payload.name} (${res.payload.origin}) in ${res.roundTripMs.toFixed(1)} ms`, "ok");
  } catch (err) {
    show(`ping failed: ${err.message}`, "bad");
  }
});
