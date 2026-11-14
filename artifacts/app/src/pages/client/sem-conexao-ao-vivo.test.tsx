import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Router } from "wouter";

import { ListaDeAvisos } from "@/components/portal/sino";
import { ProvedorDaConexao, type EstadoDaConexao } from "@/lib/carregando/estado-da-conexao";
import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { conexaoEm } from "@/test/conexao";
import { textosForaDaLista } from "@/test/textos";

import { ComprovanteView } from "./comprovante-view";
import { ServicosView, type NovaTentativaNaTela, type ServicosViewProps } from "./servicos-view";

/**
 * O portal sem conexão, nas leituras ao vivo (carregamento v2, parte 13j):
 * Minhas OS, o comprovante e os avisos do sino. Sem nada lido, o aviso da
 * conexão ("Sem conexão." ou "Reconectando…"), e não "Não foi possível
 * carregar as OS."; com as OS lidas, elas ficam, com "Sem conexão · lista de
 * 10:42"; o erro do servidor segue como antes. As leituras de apoio (as NFs,
 * as solicitações) sem conexão não repetem o aviso que as OS já dão. Dados
 * sintéticos.
 */

const noop = () => undefined;
const DEZ_E_QUARENTA_E_DOIS = Date.UTC(2026, 10, 14, 13, 42);
const semConexao = (lidaEm: number | null = null): NovaTentativaNaTela => ({ tentando: false, onTentar: noop, falta: "conexao", lidaEm });
const doServidor: NovaTentativaNaTela = { tentando: false, onTentar: noop, falta: "servidor", lidaEm: null };

function naConexao(estado: EstadoDaConexao, elemento: ReactElement) {
  return renderToStaticMarkup(
    <ProvedorDaConexao value={conexaoEm(estado)}>
      <Router ssrPath="/portal">{elemento}</Router>
    </ProvedorDaConexao>,
  );
}

function servicos(overrides: Partial<ServicosViewProps>): ReactElement {
  const props: ServicosViewProps = {
    estado: "pronto",
    os: [],
    numeros: { emAndamento: 0, agendadas: 0, concluidas: 0 } as ServicosViewProps["numeros"],
    aPagarCents: null,
    cobrancas: new Map(),
    busca: "",
    aberta: null,
    solicitacoes: [],
    pedido: null,
    acoes: { buscar: noop, abrir: noop, fechar: noop, solicitar: noop, mudar: noop, anexar: noop, removerAnexo: noop, enviar: noop, cancelar: noop },
    ...overrides,
  };
  return <ServicosView {...props} />;
}

const DE_MINHAS_OS = ["Minhas OS", "Buscar"];

describe("Portal › Minhas OS sem conexão", () => {
  it("sem nada lido: o aviso da conexão no lugar da lista, uma vez só, mesmo com as NFs e as solicitações sem conexão", async () => {
    for (const estado of ["sem-conexao", "reconectando"] as const) {
      const html = naConexao(
        estado,
        servicos({
          estado: "erro",
          leitura: semConexao(),
          falhas: [
            { mensagem: "Não foi possível carregar as NFs das OS.", tentando: false, onTentar: noop, falta: "conexao" },
            { mensagem: "Não foi possível carregar as solicitações.", tentando: false, onTentar: noop, falta: "conexao" },
          ],
        }),
      );
      expect(html).toContain(estado === "sem-conexao" ? "Sem conexão." : "Reconectando…");
      expect(html).not.toContain("Não foi possível carregar");
      expect(html.match(/data-falha-na-leitura/g)).toHaveLength(1);
      expect(textosForaDaLista(html, [...DE_MINHAS_OS, "Sem conexão.", "Reconectando…", "Tentar de novo"])).toEqual([]);
      expect(await violacoesDeAcessibilidade(html)).toEqual([]);
    }
  });

  it("com as OS lidas: ficam, com a hora", async () => {
    const html = naConexao("sem-conexao", servicos({ leitura: semConexao(DEZ_E_QUARENTA_E_DOIS) }));
    expect(html).toContain("Sem conexão · lista de 10:42");
    expect(html).toContain("Nenhuma OS ainda");
    expect(
      textosForaDaLista(html, [...DE_MINHAS_OS, "Sem conexão · lista de 10:42", "Tentar de novo", "Nenhuma OS ainda", "Em execução", "Agendadas", "Concluídas", "0"]),
    ).toEqual([]);
    expect(await violacoesDeAcessibilidade(html)).toEqual([]);
  });

  it("o erro do servidor segue com a falha", () => {
    const html = naConexao("conectado", servicos({ estado: "erro", leitura: doServidor }));
    expect(html).toContain("Não foi possível carregar as OS.");
    expect(html).not.toMatch(/Sem conexão|Reconectando/);
  });
});

describe("Portal › comprovante sem conexão", () => {
  const comprovante = (estado: "erro" | "pronto", leitura: NovaTentativaNaTela) => (
    <ComprovanteView {...({ estado, numero: "10045-01", comprovante: null, urls: {}, onBaixar: noop, leitura } as unknown as Parameters<typeof ComprovanteView>[0])} />
  );

  it("nunca lido: o aviso da conexão; o erro do servidor, a falha", () => {
    const sem = naConexao("sem-conexao", comprovante("erro", semConexao()));
    expect(sem).toContain("Sem conexão.");
    expect(sem).not.toContain("Não foi possível carregar o comprovante.");
    expect(naConexao("conectado", comprovante("erro", doServidor))).toContain("Não foi possível carregar o comprovante.");
  });
});

describe("Portal › avisos do sino sem conexão", () => {
  const avisos = (falta: "conexao" | "servidor") => (
    <ListaDeAvisos avisos={null} erro vistosAte={null} agora={new Date("2026-11-14T13:42:00Z")} onTentar={noop} falta={falta} />
  );

  it("nunca lidos: o aviso da conexão, sem outra borda e empilhado; o erro do servidor, a falha", async () => {
    const sem = naConexao("sem-conexao", avisos("conexao"));
    expect(sem).toContain("Sem conexão.");
    expect(sem).not.toContain("Não foi possível carregar os avisos.");
    expect(textosForaDaLista(sem, ["Avisos", "Sem conexão.", "Tentar de novo"])).toEqual([]);
    // O sino tem 22rem: o aviso empilha também no computador, e o "Tentar de novo" não sai dele.
    expect(sem).toMatch(/data-falha-na-leitura=""[^>]*class="[^"]*rounded-none border-0[^"]*sm:flex-col/);
    expect(await violacoesDeAcessibilidade(sem)).toEqual([]);
    expect(naConexao("conectado", avisos("servidor"))).toContain("Não foi possível carregar os avisos.");
  });
});
