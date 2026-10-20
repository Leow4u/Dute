/* Responde as chamadas /api do app com os dados da demo, sem rede. */
import { resolve } from "./data";

const EMPTY = { items: [], total: 0, has_more: false, ok: true };

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
}

export function installDemoApi() {
  const realFetch = window.fetch.bind(window);
  // Aberto como arquivo (file://) a origem é "null": as rotas relativas resolvem contra um host fictício.
  const origin = window.location.origin && window.location.origin !== "null" ? window.location.origin : "http://demo.local";
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(raw, origin);
    if (url.origin !== origin || !url.pathname.startsWith("/api/")) return realFetch(input, init);
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    let body: unknown = null;
    try {
      body = typeof init?.body === "string" ? JSON.parse(init.body) : null;
    } catch {
      body = null;
    }
    await new Promise((done) => setTimeout(done, 120));
    const payload = resolve(url.pathname, method, url.searchParams, body);
    return json(payload ?? EMPTY, method === "POST" && url.pathname === "/api/client/requests" ? 201 : 200);
  };
}
