import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Router } from "wouter";

import { secoesDoRadar } from "@/lib/agente/radar";
import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { textosDaTela } from "@/test/textos";

import { RadarView } from "./radar-do-agente";

/**
 * O radar do Agent Dute (parte 5.5k): o "Precisa de você" de cada módulo da
 * pessoa, na ordem do Início, sem regra própria. A linha crítica é a única
 * em vermelho.
 */

const SECOES = secoesDoRadar([
  {
    modulo: "wms",
    itens: [
      { id: "a1", tone: "critical", title: "2 pedidos atrasados", href: "/pedidos?grupo=atrasados" },
      { id: "a2", tone: "warning", title: "3 recebimentos para conferir", href: "/receber" },
    ],
    carregando: false,
    falhas: [],
  },
  { modulo: "comercial", itens: [], carregando: false, falhas: [] },
  { modulo: "operacao", itens: [], carregando: true, falhas: [] },
  { modulo: "financeiro", itens: [{ id: "f1", tone: "info", title: "Nada" , href: "/financeiro" }], carregando: false, falhas: ["faturas"] },
]);

function radar() {
  return renderToStaticMarkup(
    <Router ssrPath="/agente/painel">
      <RadarView secoes={SECOES} />
    </Router>,
  );
}

describe("o radar do Agent Dute", () => {
  it("uma seção por módulo, com as linhas do Início e o estado de cada leitura", () => {
    expect(SECOES.map((secao) => [secao.rotulo, secao.estado, secao.linhas.length])).toEqual([
      ["Armazenagem", "pronto", 2],
      ["Comercial", "pronto", 0],
      ["Operação", "carregando", 0],
      ["Financeiro", "falhou", 1],
    ]);
    expect(SECOES[0]!.linhas).toEqual([
      { id: "wms:a1", titulo: "2 pedidos atrasados", href: "/pedidos?grupo=atrasados", alerta: true },
      { id: "wms:a2", titulo: "3 recebimentos para conferir", href: "/receber", alerta: false },
    ]);
  });

  it("só rótulos, dados e ações, e acessível", async () => {
    const html = radar();
    expect(textosDaTela(html)).toEqual([
      "Armazenagem",
      "2 pedidos atrasados",
      "Urgente",
      "3 recebimentos para conferir",
      "Comercial",
      "Nada pendente",
      "Operação",
      "Carregando…",
      "Financeiro",
      "Não carregou",
    ]);
    expect(html).toContain('href="/pedidos?grupo=atrasados"');
    expect(await violacoesDeAcessibilidade(html)).toEqual([]);
  });
});
