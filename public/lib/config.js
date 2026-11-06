// The four origins in the demo. Hard-coded on purpose: a frame must never learn whom to trust from its
// own URL (a query string like ?parent=... is attacker-controlled).
export const ORIGINS = {
  host: "http://localhost:5170",
  a: "http://localhost:5171",
  b: "http://localhost:5172",
  evil: "http://localhost:5173",
};

export const BROADCAST_CHANNEL = "iframe-poc";
