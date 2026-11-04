import { renderToString } from "react-dom/server";
import App from "./App";
import { articles as legacyArticles, type Article } from "./content";
import { routes, createRoutes, resolveRoute, notFoundRoute } from "./routes";
export { routes, createRoutes };
export function render(pathname: string, catalog: Article[] = legacyArticles) {
  return {
    html: renderToString(<App pathname={pathname} catalog={catalog} />),
    route: resolveRoute(pathname, catalog) || notFoundRoute,
  };
}
