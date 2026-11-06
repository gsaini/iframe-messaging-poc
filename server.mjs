// One static server per origin. Different ports are different origins, so the browser enforces the
// same cross-origin rules here that it would between app.example.com and widget.example.net.
//
//   host   http://localhost:5170   the page that embeds both iframes   → public/host
//   A      http://localhost:5171   frame A                             → public/frame
//   B      http://localhost:5172   frame B (same code, other origin)   → public/frame
//   evil   http://localhost:5173   an attacker frame                   → public/evil
//
// Every origin also serves public/lib (the shared protocol and config).

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

import { ORIGINS } from "./public/lib/config.js";

const ROOT = fileURLToPath(new URL("./public/", import.meta.url));
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css" };

const SITES = [
  { origin: ORIGINS.host, dir: "host", frameAncestors: "'none'" },
  { origin: ORIGINS.a, dir: "frame", frameAncestors: ORIGINS.host },
  { origin: ORIGINS.b, dir: "frame", frameAncestors: ORIGINS.host },
  // The attacker frame is embedded on purpose for the demo; real attackers embed wherever they like.
  { origin: ORIGINS.evil, dir: "evil", frameAncestors: ORIGINS.host },
];

function serve({ dir, frameAncestors }) {
  return async (req, res) => {
    const path = new URL(req.url, "http://x").pathname;
    const rel = path.startsWith("/lib/") ? path.slice(1) : join(dir, path === "/" ? "index.html" : path);
    const file = normalize(join(ROOT, rel));
    if (!file.startsWith(ROOT)) return void res.writeHead(403).end();
    try {
      const body = await readFile(file);
      res.writeHead(200, {
        "Content-Type": TYPES[extname(file)] ?? "application/octet-stream",
        // frame-ancestors: only the host page may embed the frames. This is what lets a frame trust that
        // its parent is the host, and stops anyone else from embedding it to talk to it.
        "Content-Security-Policy": `frame-ancestors ${frameAncestors}`,
        "Cache-Control": "no-store",
      });
      res.end(body);
    } catch {
      res.writeHead(404).end("not found");
    }
  };
}

for (const site of SITES) {
  const { port } = new URL(site.origin);
  createServer(serve(site)).listen(Number(port), "localhost", () =>
    console.log(`${site.dir.padEnd(5)} ${site.origin}`),
  );
}
console.log(`\nOpen ${ORIGINS.host}/`);
