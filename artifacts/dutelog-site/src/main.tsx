import { StrictMode, Suspense, lazy } from "react";
import { createRoot, hydrateRoot } from "react-dom/client";

import App from "./App";
import type { Article } from "./content";
import "./styles.css";
import "./blog/preview.css";

const root = document.getElementById("root")!;
const pathname = window.location.pathname;

function readCatalog(): Article[] | undefined {
  const payload = document.getElementById("blog-catalog");
  if (!payload) return undefined;
  try {
    const catalog: unknown = JSON.parse(payload.textContent || "[]");
    return Array.isArray(catalog) ? (catalog as Article[]) : [];
  } catch {
    return [];
  }
}

if (pathname === "/admin/blog" || pathname.startsWith("/admin/blog/")) {
  const AdminApp = lazy(() => import("./admin/AdminApp"));
  document.title = "Painel do Blog | Dutelog";
  createRoot(root).render(
    <StrictMode>
      <Suspense
        fallback={<main role="status">Carregando painel do Blog…</main>}
      >
        <AdminApp />
      </Suspense>
    </StrictMode>,
  );
} else {
  const app = (
    <StrictMode>
      <App pathname={pathname} catalog={readCatalog()} />
    </StrictMode>
  );
  if (root.hasChildNodes()) hydrateRoot(root, app);
  else createRoot(root).render(app);
}
