import serviceData from "./content/services.json" with { type: "json" };
import articleData from "./content/articles.json" with { type: "json" };

export type ImageName = "corporate" | "detail" | "transport" | "storage";
export type Service = {
  slug: string;
  title: string;
  group: "corporativa" | "transporte";
  short: string;
  headline: string;
  intro: string;
  image: ImageName;
  situations: string[];
  scope: { title: string; text: string }[];
  steps: { title: string; text: string }[];
  faq: { q: string; a: string }[];
  related: string[];
};
export type Article = {
  slug: string;
  title: string;
  category: string;
  excerpt: string;
  image: ImageName;
  readTime: string;
  service: string;
  sections: {
    id: string;
    title: string;
    paragraphs: string[];
    bullets: string[];
  }[];
};
export const services = serviceData as Service[];
export const articles = articleData as Article[];
export const categories = [
  "Todos",
  "Logística Corporativa",
  "Transporte de Cargas",
  "Armazenagem",
];
export const company = {
  name: "Dutelog",
  origin: "https://www.dutelog.com.br",
  email: "comercial@dutelog.com.br",
  phone: "(11) 5039-0681",
  phoneHref: "tel:+551150390681",
  portal: "https://app.dutelog.com.br",
};
export function serviceHref(slug: string): string {
  if (slug === "armazenagem") return "/armazenagem/";
  const service = services.find((s) => s.slug === slug);
  if (!service) throw new Error(`Serviço desconhecido: ${slug}`);
  return `/${service.group === "corporativa" ? "logistica-corporativa" : "transporte-de-cargas"}/${slug}/`;
}
export const articleHref = (slug: string) => `/blog/${slug}/`;
export const contactHref = (service?: string) =>
  `/contato/${service ? `?servico=${encodeURIComponent(service)}` : ""}`;
export function filterArticles(
  items: Article[],
  query: string,
  category: string,
): Article[] {
  const normalize = (value: string) =>
    value
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLocaleLowerCase("pt-BR")
      .trim();
  const normalized = normalize(query);
  const selected = categories.includes(category) ? category : "Todos";
  return items.filter(
    (article) =>
      (selected === "Todos" || article.category === selected) &&
      normalize(`${article.title} ${article.excerpt}`).includes(normalized),
  );
}
