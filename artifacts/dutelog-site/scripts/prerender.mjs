import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { render, routes } from "../dist/server/entry-server.js";

const destination = resolve("dist/public");
const template = await readFile(resolve(destination, "index.html"), "utf8");
await writeFile(resolve("dist/server/template.html"), template);
await mkdir(resolve(destination, "admin/blog"), { recursive: true });
await writeFile(resolve(destination, "admin/blog/index.html"), template.replace("<!--site-head-->", '<title>Painel do Blog | Dutelog</title><meta name="robots" content="noindex,nofollow" />'));
const origin = "https://www.dutelog.com.br";
const escape = (text) =>
  text
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
for (const pathname of [...routes.map((route) => route.path), "/404.html"]) {
  const { html, route } = render(pathname);
  const canonical = origin + route.path;
  const image = `${origin}/images/${route.image || "corporate"}.webp`;
  const structured = {
    "@context": "https://schema.org",
    "@type": route.kind === "article" ? "BlogPosting" : "WebPage",
    name: route.title,
    headline: route.title,
    description: route.description,
    url: canonical,
    image,
    publisher: {
      "@type": "Organization",
      name: "Dutelog",
      url: origin,
      logo: `${origin}/dutelog-logo.png`,
    },
    ...(route.kind === "article"
      ? { author: { "@type": "Organization", name: "Dutelog", url: origin } }
      : {}),
  };
  const head = `<title>${escape(route.title)}</title>
    <meta name="description" content="${escape(route.description)}" />
    <meta name="robots" content="${route.kind === "notfound" ? "noindex,follow" : "index,follow"}" />
    ${route.kind !== "notfound" ? `<link rel="canonical" href="${canonical}" />` : ""}
    <meta property="og:type" content="${route.kind === "article" ? "article" : "website"}" />
    <meta property="og:locale" content="pt_BR" /><meta property="og:site_name" content="Dutelog" />
    <meta property="og:title" content="${escape(route.title)}" /><meta property="og:description" content="${escape(route.description)}" />
    <meta property="og:url" content="${canonical}" /><meta property="og:image" content="${image}" />
    <meta name="twitter:card" content="summary_large_image" />
    <script type="application/ld+json">${JSON.stringify(structured).replaceAll("<", "\\u003c")}</script>`;
  const file = resolve(
    destination,
    pathname === "/404.html" ? "404.html" : pathname.slice(1) + "index.html",
  );
  await mkdir(dirname(file), { recursive: true });
  await writeFile(
    file,
    template
      .replace("<!--site-head-->", () => head)
      .replace('<div id="root"></div>', () => `<div id="root">${html}</div>`),
  );
}
await writeFile(
  resolve(destination, "sitemap.xml"),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${routes.map((route) => `  <url><loc>${origin}${route.path}</loc></url>`).join("\n")}\n</urlset>\n`,
);
console.log(`Pré-renderizadas ${routes.length} páginas e uma página 404.`);
