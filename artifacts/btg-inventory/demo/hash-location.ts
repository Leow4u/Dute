/*
 * Rotas no hash (#/portal/estoque) para a demo abrir como arquivo. O hook do
 * wouter só troca a busca (?c=...) quando o destino tem uma; aqui a busca é
 * sempre a do destino, então "Nova conversa" (sem ?c=) limpa a anterior.
 */
import { useHashLocation } from "wouter/use-hash-location";

function navigate(to: string, { state = null, replace = false }: { state?: unknown; replace?: boolean } = {}) {
  const oldURL = window.location.href;
  const [path, search = ""] = to.replace(/^#?\/?/, "").split("?");
  const url = new URL(window.location.href);
  url.hash = `/${path}`;
  url.search = search ? `?${search}` : "";
  if (replace) window.history.replaceState(state, "", url.href);
  else window.history.pushState(state, "", url.href);
  window.dispatchEvent(new HashChangeEvent("hashchange", { oldURL, newURL: url.href }));
}

export function useDemoHashLocation(options: { ssrPath?: string } = {}): [string, typeof navigate] {
  const [location] = useHashLocation(options);
  return [location, navigate];
}

// O wouter lê hrefs do hook para montar os links (#/portal/...).
(useDemoHashLocation as unknown as { hrefs: (href: string) => string }).hrefs = (
  useHashLocation as unknown as { hrefs: (href: string) => string }
).hrefs;
