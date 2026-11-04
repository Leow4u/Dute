import { useEffect, type ReactNode } from "react";
import { articles as legacyArticles, services, type Article } from "./content";
import { ArticlesProvider } from "./blog/catalog";
import { Layout } from "./components/Layout";
import { Breadcrumbs, Button, Arrow } from "./components/ui";
import { HomePage } from "./pages/Home";
import {
  SolutionsPage,
  CorporatePage,
  TransportPage,
  StoragePage,
  ServicePage,
} from "./pages/Services";
import { AboutPage } from "./pages/About";
import { BlogPage, ArticlePage } from "./pages/Blog";
import { ContactPage } from "./pages/Contact";
import { resolveRoute, createRoutes, notFoundRoute } from "./routes";

export default function App({
  pathname = "/",
  catalog = legacyArticles,
}: {
  pathname?: string;
  catalog?: Article[];
}) {
  const route = resolveRoute(pathname, catalog) || notFoundRoute;
  const routes = createRoutes(catalog);
  useEffect(() => {
    document.title = route.title;
  }, [route.title]);
  let page: ReactNode;
  switch (route.kind) {
    case "home":
      page = <HomePage />;
      break;
    case "solutions":
      page = <SolutionsPage />;
      break;
    case "corporate":
      page = <CorporatePage />;
      break;
    case "transport":
      page = <TransportPage />;
      break;
    case "storage":
      page = <StoragePage />;
      break;
    case "about":
      page = <AboutPage />;
      break;
    case "blog":
      page = <BlogPage />;
      break;
    case "article":
      page = (
        <ArticlePage article={catalog.find((a) => a.slug === route.slug)!} />
      );
      break;
    case "service":
      page = (
        <ServicePage service={services.find((s) => s.slug === route.slug)!} />
      );
      break;
    case "contact":
      page = <ContactPage />;
      break;
    case "sitemap":
      page = (
        <>
          <Breadcrumbs items={[{ label: "Mapa do site" }]} />
          <section className="page-intro container">
            <h1>
              Um site.
              <br />
              <em>Muitos caminhos.</em>
            </h1>
            <p>Escolha o ponto de partida para o próximo movimento.</p>
          </section>
          <section className="container sitemap-list">
            {routes
              .filter((r) => r.kind !== "sitemap")
              .map((item, index) => (
                <a key={item.path} href={item.path}>
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <strong>
                    {item.title.replace(/ \| (Blog )?Dutelog.*$/, "")}
                  </strong>
                  <Arrow diagonal />
                </a>
              ))}
          </section>
        </>
      );
      break;
    default:
      page = (
        <section className="container not-found">
          <span className="section-label">404 · Caminho não encontrado</span>
          <h1>Página não encontrada.</h1>
          <p>
            O endereço pode ter mudado. Explore nossas soluções para encontrar o
            próximo passo.
          </p>
          <Button href="/">Voltar ao início</Button>
        </section>
      );
  }
  return (
    <ArticlesProvider articles={catalog}>
      <Layout pathname={route.path} home={route.kind === "home"}>
        {page}
      </Layout>
    </ArticlesProvider>
  );
}
