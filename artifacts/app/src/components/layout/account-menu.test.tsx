import { readFileSync } from "node:fs";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Router } from "wouter";

import { roleLabel } from "@/lib/access";

import { opcoesDoSeletor, type Liberacoes } from "@/lib/seletor-de-modulo";

import { ContaCabecalho, iniciais, ListaDeModulos, ModuloLink, posicaoDoMenu } from "./account-menu";

const MENU = readFileSync(new URL("./account-menu.tsx", import.meta.url), "utf8");
const APP = readFileSync(new URL("./app-layout.tsx", import.meta.url), "utf8");
const COMERCIAL = readFileSync(new URL("./comercial-layout.tsx", import.meta.url), "utf8");
const OPERACAO_LAYOUT = readFileSync(new URL("./operacao-layout.tsx", import.meta.url), "utf8");
const SHELL = readFileSync(new URL("./shell-do-modulo.tsx", import.meta.url), "utf8");

const SEM_OPERACAO: Liberacoes = { comercial: true, plataforma: true, operacao: false };
const atalhos = (role: Parameters<typeof opcoesDoSeletor>[0], path: string) => opcoesDoSeletor(role, null, path, SEM_OPERACAO);

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

    const lista = atalhos("owner", "/dashboard");
    const html = renderToStaticMarkup(
      <Router ssrPath="/dashboard">
        <ListaDeModulos atalhos={lista} />
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
    const [armazenagem, comercial] = atalhos("owner", "/comercial");
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

describe("iniciais do avatar", () => {
  it("primeira e última letra do nome, ou as duas primeiras", () => {
    expect(iniciais("Leonardo Duarte")).toBe("LD");
    expect(iniciais("Guilherme")).toBe("GU");
    expect(iniciais("  ")).toBe("?");
  });
});

describe("onde a troca de módulo mora", () => {
  it("no seletor do topo de cada shell; o menu da conta só lista os módulos no cabeçalho do WMS no celular", () => {
    expect(MENU).not.toContain("DropdownMenuSub");
    expect(MENU).toContain("cabecalho && modulos ? opcoesDoSeletor(");
    expect(MENU).toContain("<ListaDeModulos");
    expect(MENU).toContain("collisionPadding={16}");
    expect(MENU).not.toContain("roleDescription");
    expect(APP).toContain("<SeletorDeModulo");
    expect(APP).toContain("compact cabecalho modulos");
    expect(SHELL).toContain('variante="v3"');
    expect(SHELL).toContain('variante="v3-cabecalho"');
    for (const layout of [COMERCIAL, OPERACAO_LAYOUT]) {
      expect(layout).toContain("<ShellDoModulo");
      expect(layout).toContain('variante="v3"');
      expect(layout).not.toContain("modulos");
    }
  });
});
