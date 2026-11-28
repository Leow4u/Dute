// @vitest-environment jsdom
import { ROTULO_DO_STATUS } from "@workspace/dominio";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";

import { cartoesDaLista, contagemDosFiltros } from "@/lib/eventos/lista";
import { ETAPAS_DA_EDICAO } from "@/lib/eventos/rotulos";
import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { CANCELADA, EDICOES, EVENTOS, FEIRA_2025, HOJE, NECTON_ENVIADA, PRECOS, RASCUNHO } from "@/test/eventos-lista";
import { textosForaDaLista } from "@/test/textos";

import { ListaDeEventosView, type ListaDeEventosViewProps } from "./eventos";

/**
 * Portal › Eventos, a lista (docs/mockups/EventosPortalLista.dc.html): só os
 * textos da prancha, o axe, a espera e as ações de cada cartão. Dados
 * sintéticos (src/test/eventos-lista.ts).
 */

const CARTOES = cartoesDaLista(EVENTOS, EDICOES, PRECOS, HOJE);

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

function props(extra: Partial<ListaDeEventosViewProps> = {}): ListaDeEventosViewProps {
  return {
    estado: "pronto",
    leitura: { tentando: false, tentar: () => undefined, falta: null, lidaEm: null },
    cartoes: CARTOES,
    contagens: contagemDosFiltros(CARTOES),
    filtro: "todos",
    busca: "",
    acoes: { filtrar: () => undefined, buscar: () => undefined, excluir: () => undefined },
    ...extra,
  };
}

const tela = (extra: Partial<ListaDeEventosViewProps> = {}) =>
  renderToStaticMarkup(
    <Router ssrPath="/portal/eventos">
      <ListaDeEventosView {...props(extra)} />
    </Router>,
  );

/** O cartão do evento pelo nome, como HTML. */
function cartao(html: string, nome: string): string {
  const inicio = html.indexOf(`>${nome}</h2>`);
  expect(inicio).toBeGreaterThan(-1);
  const abre = html.lastIndexOf("<article", inicio);
  return html.slice(abre, html.indexOf("</article>", inicio));
}

const TEXTOS = [
  "Eventos",
  "O que vai para cada evento, como a Dutelog leva, monta e traz de volta, e o registro de cada edição.",
  "Novo evento",
  "Próximos",
  "Em andamento",
  "Fechados",
  "Todos",
  /^· \d+$/,
  "B2B Conference Necton",
  "Enviado à Dutelog",
  "Próxima edição",
  "28 e 29/01/2027",
  "Hotel Unique · Av. Brigadeiro Luís Antônio, 4700",
  "Montagem 28/01 10:00 · Evento 29/01 08:00 às 20:00 · Desmontagem 29/01 20:00",
  "100 itens do estoque · 2.000 peças · coleta no cliente: 2.190 produtos",
  ...ETAPAS_DA_EDICAO.map((status) => ROTULO_DO_STATUS[status]),
  "Edições:",
  "2027",
  "(esta)",
  "Abrir",
  "Encontro de Parceiros",
  "Rascunho",
  "10/03/2027",
  "Casa Tua",
  "Evento 10/03 19:00",
  "Continuar",
  "Excluir rascunho",
  "Workshop de líderes",
  "No evento",
  "24 e 25/11/2026",
  "Grand Hyatt · Av. das Nações Unidas, 13301",
  "Montagem feita 24/11 09:40 · Evento começou 25/11 08:00 · Desmontagem 25/11 18:00",
  "9 itens do estoque · 22 peças",
  "2026",
  "Lançamento do Fundo",
  "Cancelado",
  "12/12/2026",
  "Hotel Fasano",
  "Nova edição a partir de 2026",
  "Convenção de vendas",
  "Fechado",
  "Última edição",
  "03/09/2026",
  "Espaço Unimed · Rua Tagipuru, 795",
  "12 itens do estoque · 31 peças · voltaram 31",
  "2024",
  "·",
  "2025",
  "Feira de Investimentos",
  "14 a 16/05/2026",
  "Expo Center Norte · Rua José Bernardo Pinto, 333",
  "18 itens do estoque · 64 peças · voltaram 63",
  // O textosDaTela junta o espaço duro do R$ ao espaço comum.
  "Preço fechado R$ 12.400,00 · 31 fotos",
  "Criar outro evento",
];

describe("Portal › Eventos, a lista", () => {
  it("a lista pronta: só os textos da prancha, e sem violação do axe", async () => {
    const html = tela();
    expect(textosForaDaLista(html, TEXTOS)).toEqual([]);
    expect(await violacoesDeAcessibilidade(html)).toEqual([]);
    expect(html).toContain('aria-label="Buscar evento ou local"');
    expect(html).toContain('aria-label="Etapas da edição"');
    expect(html).not.toContain("Nenhum evento ainda");
  });

  it("lendo: o título e, na região, 'Carregando eventos…'; nunca 'Nenhum evento ainda' antes de ler", async () => {
    const html = tela({ estado: "carregando", cartoes: [], contagens: contagemDosFiltros([]) });
    expect(html).toContain(">Eventos</h1>");
    expect(html).toContain("data-carregando-na-regiao");
    expect(html).not.toContain("Nenhum evento ainda");
    expect(html).not.toContain("Criar outro evento");
    expect(await violacoesDeAcessibilidade(html)).toEqual([]);
    // O rótulo da espera entra aos 300 ms (o relógio do carregamento), no relógio falso.
    vi.useFakeTimers();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const container = document.createElement("div");
    document.body.appendChild(container);
    const raiz = createRoot(container);
    await act(async () =>
      raiz.render(
        <Router>
          <ListaDeEventosView {...props({ estado: "carregando", cartoes: [], contagens: contagemDosFiltros([]) })} />
        </Router>,
      ),
    );
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    expect(container.textContent).toContain("Carregando eventos…");
    expect(container.textContent).not.toContain("Nenhum evento ainda");
    act(() => raiz.unmount());
    const falhou = tela({ estado: "erro", cartoes: [], contagens: contagemDosFiltros([]) });
    expect(falhou).toContain("Não foi possível carregar os eventos.");
    expect(falhou).not.toContain("Nenhum evento ainda");
    const vazia = tela({ cartoes: [], contagens: contagemDosFiltros([]) });
    expect(vazia).toContain("Nenhum evento ainda");
    expect(vazia).not.toContain("Criar outro evento");
  });

  it("o rascunho tem Continuar e Excluir rascunho e não tem Abrir; a enviada tem Abrir, com o href /portal/eventos/edicao?id=<id>, e não tem Continuar; a fechada tem Abrir e Nova edição a partir de 2026; o label 2025 da Feira leva à edição de 2025", () => {
    const html = tela();
    const rascunho = cartao(html, "Encontro de Parceiros");
    expect(rascunho).toContain(`href="/portal/eventos/edicao?id=${RASCUNHO.id}"`);
    expect(rascunho).toContain(">Continuar<");
    expect(rascunho).toContain("Excluir rascunho");
    expect(rascunho).not.toContain(">Abrir<");
    const necton = cartao(html, "B2B Conference Necton");
    expect(necton).toContain(`href="/portal/eventos/edicao?id=${NECTON_ENVIADA.id}"`);
    expect(necton).toContain(">Abrir<");
    expect(necton).not.toContain("Continuar");
    expect(necton).toContain("(esta)");
    const feira = cartao(html, "Feira de Investimentos");
    expect(feira).toContain(">Abrir<");
    expect(feira).toContain('href="/portal/eventos/novo?evento=cve_00000000000000c1"');
    expect(feira).toContain("Nova edição a partir de 2026");
    expect(feira).toContain(`href="/portal/eventos/edicao?id=${FEIRA_2025.id}"`);
    expect(feira).not.toContain("(esta)");
    expect(feira).not.toContain("Etapas da edição");
    const cancelada = cartao(html, "Lançamento do Fundo");
    expect(cancelada).toContain(`href="/portal/eventos/edicao?id=${CANCELADA.id}"`);
    expect(cancelada).not.toContain("Etapas da edição");
    expect(cancelada).toContain("Nova edição a partir de 2026");
  });

  it("o filtro Em andamento deixa só o Workshop de líderes; a busca 'Unique' deixa só a Necton", () => {
    const andamento = tela({ filtro: "em_andamento" });
    expect(andamento).toContain("Workshop de líderes");
    expect(andamento).not.toContain("B2B Conference Necton");
    expect(andamento).not.toContain("Feira de Investimentos");
    expect(andamento).toMatch(/aria-pressed="true"[^>]*>Em andamento/);
    const busca = tela({ busca: "Unique" });
    expect(busca).toContain("B2B Conference Necton");
    expect(busca).not.toContain("Workshop de líderes");
    expect(busca).not.toContain("Encontro de Parceiros");
  });
});
