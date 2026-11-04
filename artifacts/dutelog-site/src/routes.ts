import {
  articles,
  articleHref,
  services,
  serviceHref,
  type ImageName,
  type Article,
} from "./content";
export type SiteRoute = {
  path: string;
  title: string;
  description: string;
  kind: string;
  slug?: string;
  image?: ImageName;
};
export function createRoutes(catalog: Article[] = articles): SiteRoute[] {
  return [
    {
      path: "/",
      title: "Dutelog | Logística Corporativa, Transporte e Armazenagem",
      description:
        "Logística Corporativa para cada novo capítulo da sua empresa. Conheça as soluções de mudanças, inventário, transporte de cargas e armazenagem da Dutelog.",
      kind: "home",
      image: "corporate",
    },
    {
      path: "/solucoes/",
      title: "Soluções logísticas para empresas | Dutelog",
      description:
        "Conecte Logística Corporativa, Transporte de Cargas e Armazenagem ao próximo movimento da sua empresa.",
      kind: "solutions",
    },
    {
      path: "/logistica-corporativa/",
      title: "Logística Corporativa | Dutelog",
      description:
        "Mudanças corporativas e industriais, inventário, transporte de tecnologias, montagem, remanejamento interno e gestão de mobiliário.",
      kind: "corporate",
    },
    {
      path: "/transporte-de-cargas/",
      title: "Transporte de Cargas: Dedicado e Fracionado | Dutelog",
      description:
        "Conheça as modalidades de transporte dedicado e fracionado para planejar o percurso da sua carga.",
      kind: "transport",
      image: "transport",
    },
    {
      path: "/armazenagem/",
      title: "Armazenagem para empresas | Dutelog",
      description:
        "Armazenagem conectada à identificação, organização e movimentação dos bens da sua empresa.",
      kind: "storage",
      image: "storage",
    },
    {
      path: "/a-dutelog/",
      title: "A Dutelog | Soluções Logísticas",
      description:
        "Conheça a Dutelog e sua proposta de conectar espaços, bens e pessoas com soluções de logística para empresas.",
      kind: "about",
    },
    {
      path: "/blog/",
      title: "Blog Dutelog | Ideias para o próximo movimento",
      description:
        "Conteúdos sobre mudanças corporativas, inventário, organização de ambientes, transporte e armazenagem.",
      kind: "blog",
    },
    {
      path: "/contato/",
      title: "Contato e projetos | Dutelog",
      description:
        "Converse com a Dutelog sobre o seu projeto de Logística Corporativa, Transporte de Cargas ou Armazenagem.",
      kind: "contact",
    },
    ...services.map((s) => ({
      path: serviceHref(s.slug),
      title: `${s.title} | Dutelog`,
      description: s.short + " " + s.intro.split(". ")[0] + ".",
      kind: "service",
      slug: s.slug,
      image: s.image,
    })),
    ...catalog.map((a) => ({
      path: articleHref(a.slug),
      title: `${a.title} | Blog Dutelog`,
      description: a.excerpt,
      kind: "article",
      slug: a.slug,
      image: a.image,
    })),
    {
      path: "/mapa-do-site/",
      title: "Mapa do site | Dutelog",
      description:
        "Explore as soluções, serviços, artigos e canais de contato da Dutelog.",
      kind: "sitemap",
    },
  ];
}
export const routes = createRoutes();
export function resolveRoute(
  pathname: string,
  catalog: Article[] = articles,
): SiteRoute | undefined {
  const path = pathname.replace(/\/index\.html$/, "/").replace(/\/?$/, "/");
  return createRoutes(catalog).find((route) => route.path === path);
}
export const notFoundRoute: SiteRoute = {
  path: "/404.html",
  title: "Página não encontrada | Dutelog",
  description:
    "O endereço solicitado não foi encontrado. Explore as soluções da Dutelog.",
  kind: "notfound",
};
