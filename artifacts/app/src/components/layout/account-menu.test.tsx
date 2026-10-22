import { readFileSync } from "node:fs";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Router } from "wouter";

import { roleLabel } from "@/lib/access";

import { atalhosDaConta, ContaCabecalho, ListaDeModulos, ModuloLink, posicaoDoMenu } from "./account-menu";

const MENU = readFileSync(new URL("./account-menu.tsx", import.meta.url), "utf8");
const APP = readFileSync(new URL("./app-layout.tsx", import.meta.url), "utf8");
const COMERCIAL = readFileSync(new URL("./comercial-layout.tsx", import.meta.url), "utf8");
const OPERACAO_LAYOUT = readFileSync(new URL("./operacao-layout.tsx", import.meta.url), "utf8");
const SHELL = readFileSync(new URL("./comercial-shell.tsx", import.meta.url), "utf8");
const OPERACAO = readFileSync(new URL("./operacao-shell.tsx", import.meta.url), "utf8");

// Comercial e plataforma entram explícitos: o CI roda o vitest sem VITE_FIREBASE_PROJECT_ID.
describe("atalhos do menu da conta", () => {
  it("o owner vê Armazenagem, Comercial e Financeiro, e o aberto fica marcado", () => {
    const noComercial = atalhosDaConta("owner", null, "/comercial", true, true);
    expect(noComercial.map((item) => [item.label, item.href, item.atual])).toEqual([
      ["Armazenagem", "/dashboard", false],
      ["Comercial", "/comercial", true],
      ["Financeiro", "/faturamento", false],
    ]);

    const noFinanceiro = atalhosDaConta("owner", null, "/faturamento/fatura", true, true);
    expect(noFinanceiro.find((item) => item.atual)?.key).toBe("financeiro");

    const naArmazenagem = atalhosDaConta("admin", null, "/estoque/mapa", true, true);
    expect(naArmazenagem.find((item) => item.atual)?.key).toBe("wms");

    const naConfiguracao = atalhosDaConta("owner", null, "/configuracoes", true, true);
    expect(naConfiguracao.every((item) => !item.atual)).toBe(true);
  });

  it("sem o Comercial o owner ainda troca entre Armazenagem e Financeiro", () => {
    expect(atalhosDaConta("owner", null, "/dashboard", false, true).map((item) => item.label)).toEqual([
      "Armazenagem",
      "Financeiro",
    ]);
  });

  it("quem tem um módulo só, ou a plataforma desligada, não vê a lista", () => {
    for (const role of ["comercial", "financeiro", "wms", "interno", "suporte"] as const) {
      expect(atalhosDaConta(role, null, "/dashboard", true, true), role).toEqual([]);
    }
    expect(atalhosDaConta("cliente", { modules: ["wms", "operacao", "financeiro"] }, "/portal", true, true)).toEqual([]);
    expect(atalhosDaConta("owner", null, "/comercial", true, false)).toEqual([]);
    expect(atalhosDaConta(null, null, "/dashboard", true, true)).toEqual([]);
  });
});

describe("cabeçalho da conta", () => {
  it("mostra o papel num selo e não repete a legenda", () => {
    const html = renderToStaticMarkup(
      <ContaCabecalho user={null} name="Leonardo" email="leonardo@dutelog.com.br" papel={roleLabel("owner")} />,
    );
    expect(html).toContain(">Leonardo<");
    expect(html).toContain(">leonardo@dutelog.com.br<");
    expect(html).toContain(">Administração (owner)<");
    expect(html).not.toContain(">Perfil<");
    expect(html).not.toContain("Perfis são definidos");
    expect(html).not.toContain("Para mudar seu perfil");
    expect(html).not.toContain("Tudo, inclusive pessoas");
  });

  it("no cabeçalho do celular o painel abre para baixo e os módulos ficam na mesma lista", () => {
    expect(posicaoDoMenu(true, true)).toEqual({ side: "bottom", align: "end" });
    expect(posicaoDoMenu(false, true)).toEqual({ side: "right", align: "start" });
    expect(posicaoDoMenu(false, false)).toEqual({ side: "top", align: "end" });

    const atalhos = atalhosDaConta("owner", null, "/dashboard", true, true);
    const html = renderToStaticMarkup(
      <Router ssrPath="/dashboard">
        <ListaDeModulos atalhos={atalhos} />
      </Router>,
    );
    expect(html).toContain(">Módulos<");
    expect(html).toContain('href="/dashboard"');
    expect(html).toContain('href="/comercial"');
    expect(html).toContain('href="/faturamento"');
    expect(html).toContain("min-h-11");
    expect(html).toContain('aria-current="page"');
    expect(html).not.toContain("DropdownMenuSub");
  });

  it("o link do módulo leva direto à casa e marca o aberto", () => {
    const [armazenagem, comercial] = atalhosDaConta("owner", null, "/comercial", true, true);
    const html = renderToStaticMarkup(
      <Router ssrPath="/comercial">
        <ModuloLink atalho={armazenagem} />
        <ModuloLink atalho={comercial} />
      </Router>,
    );
    expect(html).toContain('href="/dashboard"');
    expect(html).toContain(">Armazenagem<");
    expect(html).toContain('href="/comercial"');
    expect(html).toContain('aria-current="page"');
    expect(html).not.toContain('href="/"');
  });
});

describe("onde o atalho mora", () => {
  it("Módulos é item do menu da conta, e saiu das sidebars", () => {
    expect(MENU).toContain("Módulos");
    expect(MENU).toContain("DropdownMenuSub");
    expect(MENU).toContain("cabecalho && atalhos.length > 0 ? (");
    expect(MENU).toContain("<ListaDeModulos");
    expect(MENU).toContain("collisionPadding={16}");
    expect(MENU).not.toContain("roleDescription");
    expect(MENU).not.toContain("Perfis são definidos");
    expect(APP).toContain("compact cabecalho");
    expect(COMERCIAL).toContain("compact cabecalho");
    expect(OPERACAO_LAYOUT).toContain("compact cabecalho");
    expect(APP).not.toContain("ModulosLink");
    expect(APP).not.toContain("showModulos");
    expect(SHELL).not.toContain("ModulosLink");
    expect(SHELL).not.toContain("showModulos");
    expect(OPERACAO).not.toContain("ModulosLink");
    expect(OPERACAO).not.toContain("showModulos");
  });
});
