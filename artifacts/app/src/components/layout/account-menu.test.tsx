import { readFileSync } from "node:fs";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { roleLabel } from "@/lib/access";

import { ContaCabecalho, iniciais, posicaoDoMenu } from "./account-menu";

const MENU = readFileSync(new URL("./account-menu.tsx", import.meta.url), "utf8");
const APP = readFileSync(new URL("./app-layout.tsx", import.meta.url), "utf8");
const WMS = readFileSync(new URL("./wms-layout.tsx", import.meta.url), "utf8");
const COMERCIAL = readFileSync(new URL("./comercial-layout.tsx", import.meta.url), "utf8");
const OPERACAO_LAYOUT = readFileSync(new URL("./operacao-layout.tsx", import.meta.url), "utf8");
const SHELL = readFileSync(new URL("./shell-do-modulo.tsx", import.meta.url), "utf8");

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

  it("no cabeçalho do celular o painel abre para baixo; na barra recolhida, para o lado", () => {
    expect(posicaoDoMenu(true, true)).toEqual({ side: "bottom", align: "end" });
    expect(posicaoDoMenu(false, true)).toEqual({ side: "right", align: "start" });
    expect(posicaoDoMenu(false, false)).toEqual({ side: "top", align: "end" });
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
  it("no seletor do topo de cada shell, a Armazenagem inclusive (parte 4.7a); o menu da conta não lista módulos", () => {
    expect(MENU).not.toContain("DropdownMenuSub");
    expect(MENU).not.toContain("opcoesDoSeletor(");
    expect(MENU).toContain("collisionPadding={16}");
    expect(MENU).not.toContain("roleDescription");
    // O layout de antes ficou só para o portal: o cliente não troca de módulo.
    expect(APP).not.toContain("<SeletorDeModulo");
    expect(APP).toContain("<WmsLayout>");
    expect(SHELL).toContain('variante="v3"');
    expect(SHELL).toContain('variante="v3-cabecalho"');
    for (const layout of [COMERCIAL, OPERACAO_LAYOUT, WMS]) {
      expect(layout).toContain("<ShellDoModulo");
      expect(layout).toContain('variante="v3"');
      expect(layout).not.toContain("modulos");
    }
  });
});
