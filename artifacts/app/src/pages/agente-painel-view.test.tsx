import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Router } from "wouter";

import type { NotaDoAgente } from "@/lib/agente/cliente";
import type { HomeInboxItem } from "@/lib/home-inbox";
import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { textosDaTela } from "@/test/textos";

import { linhasDoPainel } from "./agente-painel";
import { PainelDoAgenteView, type PainelDoAgenteViewProps } from "./agente-painel-view";

/**
 * O painel do Agent Dute na v3 (proposta aprovada em 04/11/2026,
 * docs/mockups/AgentePainel.dc.html): só o que o agente propõe e uma pessoa
 * decide. A anotação se decide aqui; o resto leva à tela que resolve. Sem
 * legenda, uma ação principal e acessível.
 */

const ITENS: HomeInboxItem[] = [
  { id: "stock-alerts", tone: "attention", title: "Alerta de 12 itens parados para aprovar", detail: "BTG", href: "/estoque/alertas", actionLabel: "Revisar" },
  { id: "receipts", tone: "info", title: "1 recebimento para conferir", detail: "NF 48.301", href: "/wms/receber", actionLabel: "Conferir" },
  { id: "agent-notes", tone: "agent", title: "2 anotações do Agent Dute para aprovar", detail: "A BTG pede a entrega na portaria até as 10h e mais 1", href: "/agente/painel", actionLabel: "Revisar" },
  { id: "agent-playbooks", tone: "agent", title: "7 playbooks do Agent Dute para aprovar", detail: "Aprovar solicitação · Receber e mais 5", href: "/agente/conhecimento", actionLabel: "Revisar" },
];

const NOTAS: NotaDoAgente[] = [
  {
    id: "note_0123456789abcdef01234567",
    text: "A BTG pede a entrega na portaria até as 10h; depois disso, fica para o dia seguinte.",
    reason: null,
    visibility: "todos",
    status: "pending",
    suggested_by_name: "Guilherme Dantas",
    suggested_by_role: "interno",
    created_at: "2026-11-03T19:42:00.000Z",
  },
  {
    id: "note_fedcba9876543210fedcba98",
    text: "Nas NFs de uniformes, contar por tamanho: a nota vem agrupada por modelo.",
    reason: null,
    visibility: "equipe",
    status: "pending",
    suggested_by_name: "Renata Lima",
    suggested_by_role: "cliente",
    created_at: "2026-10-31T14:05:00.000Z",
  },
];

const PRONTO: PainelDoAgenteViewProps = {
  abas: [
    { href: "/agente", rotulo: "Conversa", atual: false },
    { href: "/agente/painel", rotulo: "Painel", atual: true },
    { href: "/agente/conhecimento", rotulo: "Conhecimento", atual: false },
  ],
  carregando: false,
  falhas: [],
  linhas: linhasDoPainel(ITENS),
  notas: NOTAS,
  numeros: { anotacoes: 14, playbooks: 0, documentos: 23, rotinas: 2 },
  decidindo: false,
  decidir: () => undefined,
};

function tela(props: Partial<PainelDoAgenteViewProps> = {}) {
  return renderToStaticMarkup(
    <Router ssrPath="/agente/painel">
      <div className="v3">
        <PainelDoAgenteView {...PRONTO} {...props} />
      </div>
    </Router>,
  );
}

describe("o painel do Agent Dute", () => {
  it("as linhas do agente no Início, a anotação aberta para decidir e o que vale no agente", () => {
    expect(textosDaTela(tela())).toEqual([
      "Agent Dute",
      "Conversa",
      "Painel",
      "Conhecimento",
      "Para decidir",
      "Alerta de 12 itens parados para aprovar",
      "BTG",
      "Revisar",
      "2 anotações para aprovar",
      "Texto da anotação",
      "A BTG pede a entrega na portaria até as 10h; depois disso, fica para o dia seguinte.",
      "Na conversa da equipe com Guilherme · 03/11",
      "Cliente e equipe",
      "Só equipe",
      "Recusar",
      "Aprovar",
      "Nas NFs de uniformes, contar por tamanho: a nota vem agrupada por modelo.",
      "Na conversa de Renata · 31/10",
      "7 playbooks para aprovar",
      "Aprovar solicitação · Receber e mais 5",
      "No agente",
      "Anotações valendo",
      "14",
      "Playbooks valendo",
      "0",
      "Documentos",
      "23",
      "Suas rotinas",
      "2",
    ]);
  });

  it("uma ação principal, a da primeira linha; a anotação se aprova em tinta, sem o vermelho", () => {
    const html = tela();
    expect(html.match(/bg-primary text-primary-foreground/g)).toHaveLength(1);
    expect(html).toMatch(/href="\/estoque\/alertas"[^>]*>Revisar<\/a>/);
    expect(html).toMatch(/class="[^"]*bg-primary text-primary-foreground[^"]*"[^>]*href="\/estoque\/alertas"|href="\/estoque\/alertas"[^>]*class="[^"]*bg-primary/);
    expect(html.match(/bg-foreground text-background hover:bg-foreground\/85/g)).toHaveLength(2);
    // O que cada uma decide: o cliente vê, só a equipe.
    expect(html.match(/aria-pressed="true"[^>]*>Cliente e equipe/g)).toHaveLength(1);
    expect(html.match(/aria-pressed="true"[^>]*>Só equipe/g)).toHaveLength(1);
  });

  it("os números levam ao Conhecimento e às rotinas; o painel é a aba aberta", () => {
    const html = tela();
    expect(html).toMatch(/aria-current="page"[^>]*>Painel</);
    expect(html.match(/href="\/agente\/conhecimento"/g)?.length).toBe(5);
    expect(html).toContain('href="/agente?v=rotinas"');
  });

  it("decidindo, as anotações esperam", () => {
    const html = tela({ decidindo: true });
    expect(html.match(/disabled=""[^>]*>(?:<svg[^>]*>.*?<\/svg>)?(?:Recusar|Aprovar)/g)).toHaveLength(4);
  });

  it("carregando, sem linha nem número", () => {
    const textos = textosDaTela(tela({ carregando: true, numeros: { anotacoes: null, playbooks: null, documentos: null, rotinas: null } }));
    expect(textos).toEqual(["Agent Dute", "Conversa", "Painel", "Conhecimento", "Para decidir", "No agente", "Anotações valendo", "—", "Playbooks valendo", "Documentos", "Suas rotinas"]);
  });

  it("nada para decidir", () => {
    expect(textosDaTela(tela({ linhas: [], notas: [] }))).toEqual([
      "Agent Dute",
      "Conversa",
      "Painel",
      "Conhecimento",
      "Para decidir",
      "Nada para decidir",
      "No agente",
      "Anotações valendo",
      "14",
      "Playbooks valendo",
      "0",
      "Documentos",
      "23",
      "Suas rotinas",
      "2",
    ]);
  });

  it("a falha diz o que não carregou", () => {
    expect(textosDaTela(tela({ falhas: ["Agent Dute"] }))).toContain("Não foi possível carregar: Agent Dute.");
  });

  it("acessível com as linhas, vazio e carregando", async () => {
    expect(await violacoesDeAcessibilidade(tela())).toEqual([]);
    expect(await violacoesDeAcessibilidade(tela({ linhas: [], notas: [] }))).toEqual([]);
    expect(await violacoesDeAcessibilidade(tela({ carregando: true }))).toEqual([]);
  });
});
