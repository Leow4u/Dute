import type { Article } from "../src/content.ts";
import type { SiteRoute } from "../src/routes.ts";
export const escapeHtml = (text: string) => text.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
export const jsonText = (value: unknown) => JSON.stringify(value).replaceAll("<", "\\u003c").replaceAll("\u2028", "\\u2028").replaceAll("\u2029", "\\u2029");
export function renderDocument(template: string, origin: string, rendered: { html: string; route: SiteRoute }, catalog?: Article[]) {
  const { html, route } = rendered;
  const canonical = origin + route.path;
  const article = catalog?.find((item) => route.kind === "article" && item.slug === route.slug);
  const image = origin + (article?.cover?.src || `/images/${route.image || "corporate"}.webp`);
  const structured = { "@context": "https://schema.org", "@type": route.kind === "article" ? "BlogPosting" : "WebPage", name: route.title, headline: route.title, description: route.description, url: canonical, image, publisher: { "@type": "Organization", name: "Dutelog", url: origin, logo: origin + "/dutelog-logo.png" }, ...(route.kind === "article" ? { author: { "@type": "Organization", name: "Dutelog", url: origin } } : {}) };
  const head = `<title>${escapeHtml(route.title)}</title>
<meta name="description" content="${escapeHtml(route.description)}" />
<meta name="robots" content="${route.kind === "notfound" ? "noindex,follow" : "index,follow"}" />
${route.kind === "notfound" ? "" : `<link rel="canonical" href="${escapeHtml(canonical)}" />`}
<meta property="og:type" content="${route.kind === "article" ? "article" : "website"}" />
<meta property="og:locale" content="pt_BR" /><meta property="og:site_name" content="Dutelog" />
<meta property="og:title" content="${escapeHtml(route.title)}" /><meta property="og:description" content="${escapeHtml(route.description)}" />
<meta property="og:url" content="${escapeHtml(canonical)}" /><meta property="og:image" content="${escapeHtml(image)}" />
<meta name="twitter:card" content="summary_large_image" />
<script type="application/ld+json">${jsonText(structured)}</script>`;
  return template.replace("<!--site-head-->", () => head).replace('<div id="root"></div>', () => `<div id="root">${html}</div>`).replace("</body>", () => `${catalog ? `<script id="blog-catalog" type="application/json">${jsonText(catalog)}</script>` : ""}</body>`);
}
export function adminDocument(template: string) {
  return template.replace("<!--site-head-->", '<title>Painel do Blog | Dutelog</title><meta name="robots" content="noindex,nofollow" />');
}
