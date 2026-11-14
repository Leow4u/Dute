import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Router } from "wouter";

import { ProvedorDaConexao, type EstadoDaConexao } from "@/lib/carregando/estado-da-conexao";
import type { NovaTentativa } from "@/lib/operacao/leitura";
import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { conexaoEm } from "@/test/conexao";
import { textosForaDaLista } from "@/test/textos";

import { CampoConcluirView } from "./concluir-view";
import { CampoHojeView } from "./hoje-view";
import { CampoOsView } from "./os-view";

/**
 * O campo (/campo) sem conexão, nas telas ao vivo (carregamento v2, parte
 * 13j): sem nada lido, o aviso da conexão ("Sem conexão." ou "Reconectando…",
 * com "Tentar de novo"), e não "Não foi possível carregar suas OS."; com as OS
 * lidas, elas ficam, com "Sem conexão · lista de 10:42"; o erro do servidor
 * segue com a falha da seção. Dados sintéticos.
 */

const noop = () => undefined;
const DEZ_E_QUARENTA_E_DOIS = Date.UTC(2026, 10, 14, 13, 42);
const semConexao = (lidaEm: number | null = null): NovaTentativa => ({ tentando: false, tentar: noop, falta: "conexao", lidaEm });
const doServidor: NovaTentativa = { tentando: false, tentar: noop, falta: "servidor", lidaEm: null };

function naConexao(estado: EstadoDaConexao, elemento: ReactElement) {
  return renderToStaticMarkup(
    <ProvedorDaConexao value={conexaoEm(estado)}>
      <Router ssrPath="/campo">{elemento}</Router>
    </ProvedorDaConexao>,
  );
}

const hoje = (estado: "erro" | "pronto", leitura: NovaTentativa) => (
  <CampoHojeView estado={estado} dia="Sábado, 14 de novembro" ola="Olá, Carlos" lista={{ agora: [], depois: [], feito: [] }} leitura={leitura} />
);

describe("Campo › Minhas OS sem conexão", () => {
  it("sem nada lido: o aviso da conexão, nunca a falha da seção", async () => {
    for (const estado of ["sem-conexao", "reconectando"] as const) {
      const html = naConexao(estado, hoje("erro", semConexao()));
      expect(html).toContain(estado === "sem-conexao" ? "Sem conexão." : "Reconectando…");
      expect(html).not.toContain("Não foi possível carregar suas OS.");
      expect(textosForaDaLista(html, ["Sábado, 14 de novembro", "Olá, Carlos", "Sem conexão.", "Reconectando…", "Tentar de novo"])).toEqual([]);
      expect(await violacoesDeAcessibilidade(html)).toEqual([]);
    }
  });

  it("com as OS lidas: ficam, com a hora", async () => {
    const html = naConexao("sem-conexao", hoje("pronto", semConexao(DEZ_E_QUARENTA_E_DOIS)));
    expect(html).toContain("Sem conexão · lista de 10:42");
    expect(html).toContain("Nenhuma OS para você");
    expect(textosForaDaLista(html, ["Sábado, 14 de novembro", "Olá, Carlos", "Sem conexão · lista de 10:42", "Tentar de novo", "Nenhuma OS para você"])).toEqual([]);
    expect(await violacoesDeAcessibilidade(html)).toEqual([]);
  });

  it("o erro do servidor segue com a falha da seção", () => {
    const html = naConexao("conectado", hoje("erro", doServidor));
    expect(html).toContain("Não foi possível carregar suas OS.");
    expect(html).not.toMatch(/Sem conexão|Reconectando/);
  });
});

describe("Campo › OS e Concluir sem conexão", () => {
  const os = (leitura: NovaTentativa) => (
    <CampoOsView estado="erro" numero="10211-01" ficha={null} uid="uid-carlos" pendentes={[]} urls={{}} catalogo={[]} erroDasFotos={null} agora={() => new Date()} onRegistrar={noop} onFotos={noop} leitura={leitura} />
  );
  const concluir = (leitura: NovaTentativa) => (
    <CampoConcluirView
      {...({ estado: "erro", numero: "10211-01", ficha: null, uid: "uid-carlos", pendentes: [], leitura } as unknown as Parameters<typeof CampoConcluirView>[0])}
    />
  );

  it("a OS nunca lida: o aviso da conexão; o erro do servidor, a falha da seção", () => {
    expect(naConexao("sem-conexao", os(semConexao()))).toContain("Sem conexão.");
    expect(naConexao("sem-conexao", os(semConexao()))).not.toContain("Não foi possível carregar a OS.");
    expect(naConexao("conectado", os(doServidor))).toContain("Não foi possível carregar a OS.");
  });

  it("a conclusão nunca lida: o mesmo", () => {
    expect(naConexao("sem-conexao", concluir(semConexao()))).toContain("Sem conexão.");
    expect(naConexao("conectado", concluir(doServidor))).toContain("Não foi possível carregar a OS.");
  });
});
