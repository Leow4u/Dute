import { renderToString } from "react-dom/server";
import App from "./App";
import { routes, resolveRoute, notFoundRoute } from "./routes";
export { routes };
export function render(pathname: string) {
  return {
    html: renderToString(<App pathname={pathname} />),
    route: resolveRoute(pathname) || notFoundRoute,
  };
}
