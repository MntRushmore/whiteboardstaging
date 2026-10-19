// A TCP proxy for the resilience UI tests: 3902 → 3901 (the dev API) and 54329 → 54321 (local
// Supabase). While the flag file exists every connection (new and open) is cut, as if the iPad lost
// the network; the UI test creates and removes the flag itself.
import net from "node:net";
import fs from "node:fs";

const FLAG = process.argv[2];
const routes = [
  [3902, 3901],
  [54329, 54321],
];
const open = new Set();

function cut() {
  return FLAG && fs.existsSync(FLAG);
}

for (const [from, to] of routes) {
  net
    .createServer((client) => {
      if (cut()) {
        client.destroy();
        return;
      }
      const upstream = net.connect(to, "127.0.0.1");
      const pair = { client, upstream };
      open.add(pair);
      const close = () => {
        client.destroy();
        upstream.destroy();
        open.delete(pair);
      };
      client.on("error", close);
      upstream.on("error", close);
      client.on("close", close);
      upstream.on("close", close);
      client.pipe(upstream);
      upstream.pipe(client);
    })
    .listen(from, "127.0.0.1", () => console.log(`netcut ${from} -> ${to}`));
}

setInterval(() => {
  if (!cut()) return;
  for (const p of open) {
    p.client.destroy();
    p.upstream.destroy();
  }
  open.clear();
}, 200);
