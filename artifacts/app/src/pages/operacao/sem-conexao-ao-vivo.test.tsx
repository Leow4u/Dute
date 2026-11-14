// @vitest-environment jsdom
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";

/**
 * A Operação sem conexão, nas telas ao vivo (carregamento v2, parte 13j). Até
 * a 13i, a falha da leitura ao vivo era sempre a da seção ("Não foi possível
 * carregar as demandas."), também sem rede, e a lista lida que perdia o
 * servidor ficava na tela sem dizer de quando era. Agora: sem nada lido e sem
 * conexão, o aviso da conexão ("Sem conexão." ou "Reconectando…", com "Tentar
 * de novo"); com a lista lida, ela fica, com "Sem conexão · lista de 10:42";
 * o erro do servidor segue com a falha da seção. Dados sintéticos.
 */

type Assinatura = { alvo: { chave?: string }; proximo: (snapshot: unknown) => void; falha: (erro: Error) => void; ativa: boolean };
const sdk = vi.hoisted(() => ({ assinaturas: [] as Assinatura[] }));

vi.mock("@/lib/firebase", () => ({ firestore: {}, firebaseAuth: null }));
vi.mock("firebase/firestore", async (original) => ({
  ...(await original<object>()),
  collection: (_db: unknown, nome: string) => ({ type: "query", chave: nome }),
  onSnapshot: (alvo: Assinatura["alvo"], ...resto: unknown[]) => {
    const [proximo, falha] = (typeof resto[0] === "function" ? resto : resto.slice(1)) as [Assinatura["proximo"], Assinatura["falha"]];
    const assinatura: Assinatura = { alvo, proximo, falha, ativa: true };
    sdk.assinaturas.push(assinatura);
    return () => {
      assinatura.ativa = false;
    };
  },
  queryEqual: (a: { chave?: string }, b: { chave?: string }) => a.chave === b.chave,
}));

import { ProvedorDaConexao, type EstadoDaConexao } from "@/lib/carregando/estado-da-conexao";
import { SEM_FILTRO_DE_DEMANDAS, type DemandaDaOperacao } from "@/lib/operacao/demandas";
import type { NovaTentativa } from "@/lib/operacao/leitura";
import type { InicioDaOperacao } from "@/lib/operacao/use-inicio";
import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { conexaoEm } from "@/test/conexao";
import { estadosDaFalta, rotulosDaFalta } from "@/test/sem-conexao";
import { textosForaDaLista } from "@/test/textos";

import PaginaDemandas from "./demandas";
import { DemandaView } from "./demanda-view";
import { DemandasView } from "./demandas-view";
import { InicioDaOperacaoView } from "./inicio-view";
import { OsView } from "./os-view";

const noop = () => undefined;
/** 10:42 no fuso do armazém. */
const DEZ_E_QUARENTA_E_DOIS = Date.UTC(2026, 10, 14, 13, 42);

const semConexao = (lidaEm: number | null = null): NovaTentativa => ({ tentando: false, tentar: noop, falta: "conexao", lidaEm });
const doServidor: NovaTentativa = { tentando: false, tentar: noop, falta: "servidor", lidaEm: null };

function naConexao(estado: EstadoDaConexao, elemento: ReactElement) {
  return renderToStaticMarkup(
    <ProvedorDaConexao value={conexaoEm(estado)}>
      <Router ssrPath="/operacao">{elemento}</Router>
    </ProvedorDaConexao>,
  );
}

function demandas(estado: "erro" | "pronto", leitura: NovaTentativa) {
  return (
    <DemandasView
      estado={estado}
      leitura={leitura}
      resumo="Sexta, 13 de novembro · 10:42 · 0 demandas"
      linhas={[]}
      filtros={SEM_FILTRO_DE_DEMANDAS}
      clientes={[]}
      busca=""
      onBusca={noop}
      onFiltros={noop}
    />
  );
}

const CABECALHO_DAS_DEMANDAS = ["Demandas", "Nova demanda", "Buscar", /^Buscar demanda/, "Tipo", "Todos os tipos", "Paraquedas", "Planejada", "Vistoria", "Entrada", "Todas as entradas", "Direta", "Comercial", "Portal", "Cliente", "Todos os clientes", "Etapa", "Todas as etapas", "Emergencial", "Armazenagem", "No comercial", "Aguardando cliente", "Execução a orçar", "Paga", "Perdida", /^Para |^Agendada$|^Em execução$|^Em revisão$|^Executada$|^Faturada$|^Cancelada$|^A faturar$|^Concluída$/];

describe("Operação › Demandas sem conexão", () => {
  it("sem nada lido: o aviso da conexão no lugar da lista, nunca a falha da seção", async () => {
    for (const estado of ["sem-conexao", "reconectando"] as const) {
      const html = naConexao(estado, demandas("erro", semConexao()));
      expect(html).toContain(estado === "sem-conexao" ? "Sem conexão." : "Reconectando…");
      expect(html).toContain("Tentar de novo");
      expect(html).not.toContain("Não foi possível carregar as demandas.");
      expect(textosForaDaLista(html, [...CABECALHO_DAS_DEMANDAS, "Sem conexão.", "Reconectando…", "Tentar de novo"])).toEqual([]);
      expect(await violacoesDeAcessibilidade(html)).toEqual([]);
    }
  });

  it("com a lista lida: ela fica, com a hora da última leitura", async () => {
    const html = naConexao("sem-conexao", demandas("pronto", semConexao(DEZ_E_QUARENTA_E_DOIS)));
    expect(html).toContain("Sem conexão · lista de 10:42");
    expect(html).toContain("Nenhuma demanda");
    expect(textosForaDaLista(html, [...CABECALHO_DAS_DEMANDAS, /^Sexta/, "Sem conexão · lista de 10:42", "Tentar de novo", "Nenhuma demanda"])).toEqual([]);
    expect(await violacoesDeAcessibilidade(html)).toEqual([]);
    expect(naConexao("reconectando", demandas("pronto", semConexao(DEZ_E_QUARENTA_E_DOIS)))).toContain("· lista de 10:42");
  });

  it("o erro do servidor segue com a falha da seção", () => {
    const html = naConexao("conectado", demandas("erro", doServidor));
    expect(html).toContain("Não foi possível carregar as demandas.");
    expect(html).not.toMatch(/Sem conexão|Reconectando/);
  });
});

describe("Operação › OS sem conexão", () => {
  const os = (leitura: NovaTentativa) => (
    <OsView estado="erro" numero="10045-01" ficha={null} cabecalho={{ titulo: "" } as never} hoje="2026-11-14" urls={{}} leitura={leitura} />
  );

  it("a ficha nunca lida: o aviso da conexão; o erro do servidor, a falha da seção", () => {
    const sem = naConexao("sem-conexao", os(semConexao()));
    expect(sem).toContain("Sem conexão.");
    expect(sem).not.toContain("Não foi possível carregar a OS.");
    expect(naConexao("conectado", os(doServidor))).toContain("Não foi possível carregar a OS.");
  });
});

describe("Operação › Início sem conexão", () => {
  const INICIO: InicioDaOperacao = { itens: [], numeros: undefined, equipe: undefined, carregando: false, falhas: [], releitura: undefined };

  it("sem nada lido: o aviso da conexão no lugar do Precisa de você; com tudo lido, a faixa com a hora", () => {
    const nada = naConexao(
      "sem-conexao",
      <InicioDaOperacaoView nome="Ana" hoje={new Date("2026-11-14T13:42:00Z")} inicio={{ ...INICIO, falhas: ["ordens de serviço"], releitura: semConexao() }} />,
    );
    expect(nada).toContain("Sem conexão.");
    expect(nada).not.toContain("Não foi possível carregar: ordens de serviço.");

    const lido = naConexao(
      "sem-conexao",
      <InicioDaOperacaoView
        nome="Ana"
        hoje={new Date("2026-11-14T13:42:00Z")}
        inicio={{ ...INICIO, numeros: { agendadasHoje: 1, paraAgendar: 0, proximosDias: 2 }, equipe: [], releitura: semConexao(DEZ_E_QUARENTA_E_DOIS) }}
      />,
    );
    expect(lido).toContain("Sem conexão · lista de 10:42");
    expect(lido).toContain("Agendadas hoje");
  });

  it("o erro do servidor segue com o aviso das fontes", () => {
    const html = naConexao(
      "conectado",
      <InicioDaOperacaoView nome="Ana" hoje={new Date("2026-11-14T13:42:00Z")} inicio={{ ...INICIO, falhas: ["ordens de serviço"], releitura: doServidor }} />,
    );
    expect(html).toContain("Não foi possível carregar: ordens de serviço.");
    expect(html).not.toMatch(/Sem conexão|Reconectando/);
  });
});

describe("Operação › Demandas, da escuta à tela", () => {
  let raiz: Root | null = null;
  let container: HTMLDivElement;
  let semRede = false;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    semRede = false;
    vi.spyOn(navigator, "onLine", "get").mockImplementation(() => !semRede);
    sdk.assinaturas.length = 0;
    container = document.createElement("div");
    document.body.append(container);
    raiz = createRoot(container);
  });

  afterEach(() => {
    act(() => raiz?.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  const lista = (ids: string[], fromCache: boolean) => ({ docs: ids.map((id) => ({ id, data: () => ({ numero: id }) })), metadata: { fromCache } });

  function montar() {
    act(() =>
      raiz!.render(
        <ProvedorDaConexao value={conexaoEm("sem-conexao")}>
          <Router ssrPath="/operacao/demandas">
            <PaginaDemandas />
          </Router>
        </ProvedorDaConexao>,
      ),
    );
  }

  it("a primeira visita sem rede mostra o aviso da conexão; a permissão negada, a falha da seção", () => {
    semRede = true;
    montar();
    for (const assinatura of sdk.assinaturas) act(() => assinatura.proximo(lista([], true)));
    expect(container.textContent).toContain("Sem conexão.");
    expect(container.textContent).not.toContain("Não foi possível carregar as demandas.");

    act(() => raiz!.unmount());
    raiz = createRoot(container);
    sdk.assinaturas.length = 0;
    semRede = false;
    montar();
    act(() => sdk.assinaturas[0]!.falha(Object.assign(new Error("Missing or insufficient permissions."), { code: "permission-denied" })));
    expect(container.textContent).toContain("Não foi possível carregar as demandas.");
  });

  it("a lista lida que perde o servidor fica, com a faixa", () => {
    montar();
    for (const assinatura of sdk.assinaturas) act(() => assinatura.proximo(lista([], false)));
    expect(container.textContent).toContain("Nenhuma demanda");
    semRede = true;
    for (const assinatura of sdk.assinaturas) act(() => assinatura.proximo(lista([], true)));
    expect(container.textContent).toContain("Nenhuma demanda");
    expect(container.textContent).toMatch(/Sem conexão · lista de \d\d:\d\d/);
  });
});

describe("Operação › Demanda sem conexão (revisão da 13j)", () => {
  const DEMANDA: DemandaDaOperacao = {
    numero: "10045",
    customerCode: "ITAU",
    titulo: "Troca de cadeiras",
    tipo: "planejada",
    entrada: "direta",
    etapa: "para_planejar",
    executarAte: null,
    osNumeros: [],
    escopo: [{ id: "ln_1", item: "Cadeira Flexform", quantidade: "40", unidade: "UN" }],
    fora: null,
    visitaTecnica: null,
    escopoRv: null,
    recebidaEm: "2026-11-13T12:00:00.000Z",
    canal: null,
    pedidoPor: null,
    origem: null,
    destino: null,
  };

  it("a ficha da demanda: o aviso, a faixa com a hora da demanda e a falha do servidor, só com os rótulos da falta; axe", async () => {
    expect(
      await estadosDaFalta((leitura, situacao) => (
        <Router ssrPath="/operacao/demanda">
          <DemandaView
            estado={situacao}
            numero="10045"
            demanda={situacao === "pronto" ? DEMANDA : null}
            cliente="Itaú Unibanco"
            etapa="para_planejar"
            escopo={[]}
            ordens={[]}
            linhasComSaldo={0}
            locais={[]}
            prazo={null}
            erro={null}
            leitura={leitura}
          />
        </Router>
      )),
    ).toEqual(rotulosDaFalta({ mensagem: "Não foi possível carregar a demanda.", objeto: "demanda" }));
  });
});
