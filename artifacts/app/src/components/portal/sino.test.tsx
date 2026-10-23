import { JSDOM } from "jsdom";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Router } from "wouter";

import { avisoDoPortal, type AvisoDoPortal } from "@/lib/portal/avisos";

import { violacoesDeAcessibilidade } from "@/test/acessibilidade";

import { BotaoDoSino, ListaDeAvisos } from "./sino";

/**
 * O sino do portal (parte 4.6c): o botão diz quantos são novos e mostra o
 * ponto; a lista traz o título, o texto e quando, com os novos marcados,
 * cada um levando à tela dele. Sem legenda; `axe`. O popover em si é do Radix.
 */

const AGORA = new Date("2026-10-28T17:30:00.000Z"); // 14:30 em São Paulo
const timestamp = (iso: string) => ({ toDate: () => new Date(iso) });

const AVISOS: AvisoDoPortal[] = [
  avisoDoPortal("ntf_1", {
    modelo: "os_concluida",
    titulo: "OS 10050-01 concluída",
    texto: "Transporte · concluída em 28/10/2026 14:10",
    link: "/portal/servicos?os=10050-01",
    created_at: timestamp("2026-10-28T17:18:00.000Z"),
  })!,
  avisoDoPortal("ntf_2", {
    modelo: "nf_emitida",
    titulo: "NF 1234 emitida",
    texto: "R$ 500,00 · vence 27/11/2026",
    link: "/portal/faturas",
    created_at: timestamp("2026-10-27T12:10:00.000Z"),
  })!,
];

function corpo(html: string): HTMLElement {
  return new JSDOM(`<!doctype html><body>${html}</body>`).window.document.body;
}

function lista(props: Partial<Parameters<typeof ListaDeAvisos>[0]> = {}): string {
  return renderToStaticMarkup(
    <Router ssrPath="/portal">
      <ListaDeAvisos avisos={AVISOS} erro={false} vistosAte={new Date("2026-10-28T12:00:00.000Z")} agora={AGORA} {...props} />
    </Router>,
  );
}

function textos(html: string): string[] {
  const body = corpo(html);
  return [...body.querySelectorAll("h2, li a > span > span, p")].map((item) => item.textContent?.trim() ?? "").filter(Boolean);
}

describe("o botão do sino", () => {
  it("diz quantos são novos e mostra o ponto só com novo", () => {
    const com = corpo(renderToStaticMarkup(<BotaoDoSino novos={2} />)).querySelector("button")!;
    expect(com.getAttribute("aria-label")).toBe("Avisos: 2 novos");
    expect(com.querySelectorAll("span[aria-hidden]").length).toBe(1);
    const sem = corpo(renderToStaticMarkup(<BotaoDoSino novos={0} />)).querySelector("button")!;
    expect(sem.getAttribute("aria-label")).toBe("Avisos");
    expect(sem.querySelectorAll("span[aria-hidden]").length).toBe(0);
  });
});

describe("a lista de avisos", () => {
  it("o título, o texto e quando de cada aviso, o novo primeiro marcado", () => {
    expect(textos(lista())).toEqual([
      "Avisos",
      "Novo: OS 10050-01 concluída",
      "Transporte · concluída em 28/10/2026 14:10",
      "há 12 min",
      "NF 1234 emitida",
      "R$ 500,00 · vence 27/11/2026",
      "ontem 09:10",
    ]);
  });

  it("cada aviso leva à tela dele", () => {
    const links = [...corpo(lista()).querySelectorAll("a")].map((item) => item.getAttribute("href"));
    expect(links).toEqual(["/portal/servicos?os=10050-01", "/portal/faturas"]);
  });

  it("sem avisos, carregando e com erro", () => {
    expect(textos(lista({ avisos: [] }))).toEqual(["Avisos", "Nenhum aviso."]);
    expect(textos(lista({ avisos: null }))).toEqual(["Avisos", "Carregando..."]);
    expect(textos(lista({ avisos: null, erro: true }))).toEqual(["Avisos", "Não foi possível carregar."]);
  });

  it("sem violações de acessibilidade", async () => {
    expect(await violacoesDeAcessibilidade(lista())).toEqual([]);
    expect(await violacoesDeAcessibilidade(renderToStaticMarkup(<BotaoDoSino novos={1} />))).toEqual([]);
  });
});
