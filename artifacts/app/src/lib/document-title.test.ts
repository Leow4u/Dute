import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { APP_DOCUMENT_TITLE, documentTitleForPath } from "./document-title";

const PROTECTED_PATHS = Array.from(
  readFileSync(new URL("../App.tsx", import.meta.url), "utf8").matchAll(
    /protectedRoute\(\s*"([^"]+)"/g,
  ),
  ([, path]) => path,
);

describe("título da aba do navegador", () => {
  it("o shell publicado se chama Dutelog", () => {
    const html = readFileSync(new URL("../../index.html", import.meta.url), "utf8");
    expect(html.match(/<title>([^<]*)<\/title>/)?.[1]).toBe(APP_DOCUMENT_TITLE);
    expect(html).not.toContain("BTG");

    const vite = readFileSync(new URL("../../vite.config.ts", import.meta.url), "utf8");
    const manifest = vite.slice(vite.indexOf("manifest:"), vite.indexOf("workbox:"));
    expect(manifest).toContain(`name: "${APP_DOCUMENT_TITLE}"`);
    expect(manifest).toContain(`short_name: "${APP_DOCUMENT_TITLE}"`);
    expect(manifest).not.toContain("BTG");
  });

  it("no Início, a aba não fica em Estoque", () => {
    expect(documentTitleForPath("/dashboard")).toBe("Dutelog | Início");
    expect(documentTitleForPath("/portal")).toBe("Dutelog | Início");
    expect(documentTitleForPath("/")).toBe(APP_DOCUMENT_TITLE);
  });

  it.each([
    ["/estoque", "Dutelog | Estoque"],
    ["/estoque/mapa", "Dutelog | Mapa"],
    ["/estoque/posicoes", "Dutelog | Posições"],
    ["/estoque/etiquetas", "Dutelog | Etiquetas"],
    ["/wms/receber", "Dutelog | Receber"],
    ["/wms/contagem", "Dutelog | Contagem"],
    ["/wms/qualidade", "Dutelog | Qualidade"],
    ["/wms/devolucoes", "Dutelog | Devoluções"],
    ["/pedidos", "Dutelog | Pedidos"],
    ["/faturamento", "Dutelog | Faturamento"],
    ["/faturamento/tabela", "Dutelog | Faturamento"],
    ["/faturamento/fatura", "Dutelog | Fatura"],
    ["/reports", "Dutelog | Relatórios"],
    ["/agente", "Dutelog | Agent Dute"],
    ["/agente/conhecimento", "Dutelog | Conhecimento"],
    ["/documentos", "Dutelog | Documentos"],
    ["/portal/estoque", "Dutelog | Estoque"],
    ["/portal/pedidos", "Dutelog | Pedidos"],
    ["/portal/faturas", "Dutelog | Faturas"],
    ["/portal/faturas/relatorio", "Dutelog | Relatório"],
    ["/portal/recebimentos", "Dutelog | Envios para a Dutelog"],
    ["/portal/eventos", "Dutelog | Eventos"],
    ["/portal/documentos", "Dutelog | Documentos"],
    ["/portal/agente", "Dutelog | Agent Dute"],
    ["/configuracoes", "Dutelog | Minha conta"],
    ["/configuracoes/clientes", "Dutelog | Clientes"],
    ["/sign-in", "Dutelog | Entrar"],
    ["/convite/abc", "Dutelog | Aceitar convite"],
  ])("%s abre com %s", (path, title) => {
    expect(documentTitleForPath(path)).toBe(title);
    expect(documentTitleForPath(`${path}?cliente=BTG`)).toBe(title);
  });

  it("o cliente ativo não entra no título de nenhuma rota", () => {
    expect(PROTECTED_PATHS.length).toBeGreaterThan(20);
    for (const path of PROTECTED_PATHS) {
      const title = documentTitleForPath(path);
      expect(title.startsWith(`${APP_DOCUMENT_TITLE}`)).toBe(true);
      expect(title).not.toMatch(/BTG/);
    }
  });
});
