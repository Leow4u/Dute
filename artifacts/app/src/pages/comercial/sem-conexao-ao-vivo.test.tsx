import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Router } from "wouter";

import { ProvedorDaConexao, type EstadoDaConexao } from "@/lib/carregando/estado-da-conexao";
import type { NovaTentativa } from "@/lib/comercial/leitura";
import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { conexaoEm } from "@/test/conexao";
import { textosForaDaLista } from "@/test/textos";

import { ClientesView, type ClientesViewProps } from "./clientes-view";
import { DocumentoView } from "./documento-view";
import { FilaView, type FilaViewProps } from "./orcamentos-view";

/**
 * O Comercial sem conexão, nas telas ao vivo (carregamento v2, parte 13j):
 * sem nada lido, o aviso da conexão no lugar da lista (dentro do cartão da
 * lista, sem outra borda); com a lista lida, ela fica, com "Sem conexão ·
 * lista de 10:42"; o erro do servidor segue com a falha da seção. Até a 13i,
 * a falha da seção nos dois casos, e a lista lida sem a hora. Dados sintéticos.
 */

const noop = () => undefined;
const DEZ_E_QUARENTA_E_DOIS = Date.UTC(2026, 10, 14, 13, 42);
const semConexao = (lidaEm: number | null = null): NovaTentativa => ({ tentando: false, tentar: noop, falta: "conexao", lidaEm });
const doServidor: NovaTentativa = { tentando: false, tentar: noop, falta: "servidor", lidaEm: null };

function naConexao(estado: EstadoDaConexao, elemento: ReactElement) {
  return renderToStaticMarkup(
    <ProvedorDaConexao value={conexaoEm(estado)}>
      <Router ssrPath="/comercial">{elemento}</Router>
    </ProvedorDaConexao>,
  );
}

function fila(overrides: Partial<FilaViewProps>): ReactElement {
  const props: FilaViewProps = {
    estado: "pronto",
    itens: [],
    agora: new Date("2026-11-14T13:42:00Z"),
    segmento: "todas",
    onSegmento: noop,
    busca: "",
    onBusca: noop,
    selecionado: null,
    onSelecionar: noop,
    fichaAberta: false,
    onVoltar: noop,
    contexto: { contratos: [], hoje: "2026-11-14" } as unknown as FilaViewProps["contexto"],
    onNovo: noop,
    onOrcarExecucao: noop,
    onAbrir: noop,
    envio: { acao: null, ocupado: false, erro: null, onEnviar: noop },
    depois: { acoes: { principal: null, secundarias: [] }, ocupado: false, aviso: null, onAcao: noop },
    ...overrides,
  };
  return <FilaView {...props} />;
}

function clientes(overrides: Partial<ClientesViewProps>): ReactElement {
  const props: ClientesViewProps = {
    estado: "pronto",
    cadastros: [],
    contratos: [],
    hoje: "2026-11-14",
    segmento: "todos",
    onSegmento: noop,
    busca: "",
    onBusca: noop,
    selecionado: null,
    onSelecionar: noop,
    aba: "dados",
    onAba: noop,
    locais: [],
    contatos: [],
    responsavel: null,
    ocupado: false,
    acoes: {
      novoProspect: noop,
      editar: noop,
      marcarCliente: noop,
      novoLocal: noop,
      editarLocal: noop,
      alternarLocal: noop,
      novoContato: noop,
      editarContato: noop,
      alternarContato: noop,
    },
    ...overrides,
  } as ClientesViewProps;
  return <ClientesView {...props} />;
}

/** O cabeçalho e os segmentos da fila, que ficam em todo estado. */
const DA_FILA = ["Orçamentos", "Buscar", "Novo orçamento", "Orçar execução", "Para enviar", "Para planejar", "A faturar", "—", /^Todas|^Em montagem|^Para aprovar|^Aprovad|^Enviad|^Aguardando|^Fechad|^Perdid|^Cancelad|^Execução|^Vistoria|^\d+$/];
const DOS_CLIENTES = ["Clientes", "Buscar", "Novo prospect", "—", /^Todos|^Clientes$|^Prospects$|^\d+$/];

describe("Comercial › Orçamentos sem conexão", () => {
  it("sem nada lido: o aviso da conexão no lugar da fila, nunca a falha da seção", async () => {
    for (const estado of ["sem-conexao", "reconectando"] as const) {
      const html = naConexao(estado, fila({ estado: "erro", leitura: semConexao() }));
      expect(html).toContain(estado === "sem-conexao" ? "Sem conexão." : "Reconectando…");
      expect(html).not.toContain("Não foi possível carregar os orçamentos.");
      expect(textosForaDaLista(html, [...DA_FILA, "Sem conexão.", "Reconectando…", "Tentar de novo"])).toEqual([]);
      expect(await violacoesDeAcessibilidade(html)).toEqual([]);
    }
  });

  it("com a fila lida: ela fica, com a hora", async () => {
    const html = naConexao("sem-conexao", fila({ leitura: semConexao(DEZ_E_QUARENTA_E_DOIS) }));
    expect(html).toContain("Sem conexão · lista de 10:42");
    expect(html).toContain("Nenhum orçamento");
    expect(textosForaDaLista(html, [...DA_FILA, "Sem conexão · lista de 10:42", "Tentar de novo", "Nenhum orçamento"])).toEqual([]);
    expect(await violacoesDeAcessibilidade(html)).toEqual([]);
  });

  it("o erro do servidor segue com a falha da seção", () => {
    const html = naConexao("conectado", fila({ estado: "erro", leitura: doServidor }));
    expect(html).toContain("Não foi possível carregar os orçamentos.");
    expect(html).not.toMatch(/Sem conexão|Reconectando/);
  });
});

describe("Comercial › Clientes sem conexão", () => {
  it("sem nada lido: o aviso da conexão dentro do cartão da lista, sem outra borda e empilhado; o servidor, a falha da seção", async () => {
    const html = naConexao("sem-conexao", clientes({ estado: "erro", leitura: semConexao() }));
    expect(html).toContain("Sem conexão.");
    expect(html).not.toContain("Não foi possível carregar o cadastro.");
    expect(html).toMatch(/data-falha-na-leitura=""[^>]*class="[^"]*rounded-none border-0/);
    // A lista lateral tem 384 px: o aviso empilha também no computador, e o "Tentar de novo" não sai dela.
    expect(html).toMatch(/data-falha-na-leitura=""[^>]*class="[^"]*sm:flex-col/);
    expect(textosForaDaLista(html, [...DOS_CLIENTES, "Sem conexão.", "Tentar de novo"])).toEqual([]);
    expect(await violacoesDeAcessibilidade(html)).toEqual([]);
    expect(naConexao("conectado", clientes({ estado: "erro", leitura: doServidor }))).toContain("Não foi possível carregar o cadastro.");
  });

  it("com o cadastro lido: a faixa com a hora", () => {
    expect(naConexao("sem-conexao", clientes({ leitura: semConexao(DEZ_E_QUARENTA_E_DOIS) }))).toContain("Sem conexão · lista de 10:42");
  });
});

describe("Comercial › Documento do orçamento sem conexão", () => {
  it("nunca lido: o aviso da conexão; o erro do servidor, a falha da seção", () => {
    const documento = (leitura: NovaTentativa) => <DocumentoView estado="erro" documento={null} voltar={null} onImprimir={noop} leitura={leitura} />;
    const sem = naConexao("sem-conexao", documento(semConexao()));
    expect(sem).toContain("Sem conexão.");
    expect(sem).not.toContain("Não foi possível carregar o orçamento.");
    expect(naConexao("conectado", documento(doServidor))).toContain("Não foi possível carregar o orçamento.");
  });
});
