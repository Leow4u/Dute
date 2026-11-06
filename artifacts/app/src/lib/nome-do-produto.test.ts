import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

import * as regra from "@workspace/dominio";
import {
  caixaDasLetras,
  familiaDoCodigo,
  nomeComTamanho,
  nomeSemTamanho,
  ordemDoTamanho,
  padronizarNome,
  problemaDoNome,
  sufixoDoCodigo,
  tamanhoDoCodigo,
  type NomePadronizado,
  type ProblemaDoNome,
} from "@workspace/dominio";

/**
 * O padrão do nome do produto (lib/dominio/src/nome-do-produto.ts, decisões do
 * Leonardo de 06/11/2026). Os casos ficam num JSON que
 * tools/padronizar-nomes/regras.test.mjs também roda, contra a cópia em
 * JavaScript da ferramenta do relatório, e a trava no fim confere que a cópia
 * responde igual ao original nas mesmas entradas.
 */

type Entrada = { nome: string; codigo: string; tamanho: string };

type Casos = {
  sufixos: { caso: string; codigo: string; sufixo: string | null }[];
  tamanhos_do_codigo: { caso: string; codigo: string; tamanho: string | null }[];
  familias: { caso: string; codigo: string; familia: string }[];
  nomes: (Entrada & { caso: string; genero: string; esperado: NomePadronizado })[];
  exibicao: (Entrada & { caso: string; sem_tamanho: string; com_tamanho: string })[];
  problemas: (Entrada & { caso: string; problema: ProblemaDoNome | null })[];
};

const here = dirname(fileURLToPath(import.meta.url));
const casos = JSON.parse(readFileSync(resolve(here, "../../../../lib/dominio/src/nome-do-produto.casos.json"), "utf8")) as Casos;

describe("padrão do nome: casos de referência", () => {
  it("o JSON de casos foi lido", () => {
    expect(casos.nomes.length).toBeGreaterThanOrEqual(20);
    expect(casos.sufixos.length).toBeGreaterThanOrEqual(5);
    expect(casos.exibicao.length).toBeGreaterThanOrEqual(10);
    expect(casos.problemas.length).toBeGreaterThanOrEqual(10);
  });

  it.each(casos.sufixos)("sufixo · $caso", ({ codigo, sufixo }) => {
    expect(sufixoDoCodigo(codigo)).toBe(sufixo);
  });

  it.each(casos.tamanhos_do_codigo)("tamanho do código · $caso", ({ codigo, tamanho }) => {
    expect(tamanhoDoCodigo(codigo)).toBe(tamanho);
  });

  it.each(casos.familias)("família · $caso", ({ codigo, familia }) => {
    expect(familiaDoCodigo(codigo)).toBe(familia);
  });

  it.each(casos.nomes)("nome · $caso", ({ nome, codigo, genero, tamanho, esperado }) => {
    expect(padronizarNome({ nome, codigo, genero, tamanho })).toEqual(esperado);
  });

  it.each(casos.exibicao)("exibição · $caso", (caso) => {
    expect(nomeSemTamanho(caso)).toBe(caso.sem_tamanho);
    expect(nomeComTamanho(caso)).toBe(caso.com_tamanho);
  });

  it.each(casos.problemas)("problema · $caso", (caso) => {
    expect(problemaDoNome(caso)).toEqual(caso.problema);
  });

  it("a ordem dos tamanhos é PP, P, M, G, GG, XG, XGG, depois N1…, depois os números", () => {
    const ordenados = ["42", "N3", "GG", "PP", "XGG", "N1", "M", "38", "U"].sort((a, b) => ordemDoTamanho(a) - ordemDoTamanho(b));
    expect(ordenados).toEqual(["PP", "M", "GG", "XGG", "U", "N1", "N3", "38", "42"]);
  });

  it("a caixa das letras é idempotente", () => {
    for (const caso of casos.nomes) {
      if (!caso.esperado.nome || caso.esperado.conferir.includes("nome é só o tamanho")) continue;
      expect(caixaDasLetras(caso.esperado.nome), caso.caso).toBe(caso.esperado.nome);
    }
  });

  it("aplicar o padrão duas vezes não muda mais nada", () => {
    for (const caso of casos.nomes) {
      const primeira = padronizarNome(caso);
      const segunda = padronizarNome({ ...caso, nome: primeira.nome, tamanho: primeira.tamanho ?? "" });
      expect(segunda.nome, caso.caso).toBe(primeira.nome);
      expect(segunda.motivos.filter((motivo) => motivo !== "tamanho pelo código"), caso.caso).toEqual([]);
    }
  });

  it("o nome padronizado nunca tem problema que trave o cadastro", () => {
    for (const caso of casos.nomes) {
      const padrao = padronizarNome(caso);
      if (!padrao.nome || padrao.conferir.length) continue;
      expect(problemaDoNome({ nome: padrao.nome, codigo: caso.codigo, tamanho: padrao.tamanho ?? "" }), caso.caso).toBeNull();
    }
  });
});

describe("padrão do nome: a cópia da ferramenta é a gerada deste arquivo", () => {
  const RAIZ = resolve(here, "../../../..");
  const COPIA = resolve(RAIZ, "tools/padronizar-nomes/regras.mjs");

  it("tools/padronizar-nomes/regras.mjs é o que gerar-regras.mjs produz de lib/dominio", async () => {
    const ts = await import("typescript");
    const gerador = (await import(/* @vite-ignore */ pathToFileURL(resolve(RAIZ, "tools/padronizar-nomes/gerar-regras.mjs")).href)) as {
      gerar: (fonte: string, typescript: unknown) => string;
    };
    const fonte = readFileSync(resolve(RAIZ, "lib/dominio/src/nome-do-produto.ts"), "utf8");
    const esperado = gerador.gerar(fonte, ts.default ?? ts);
    expect(readFileSync(COPIA, "utf8").replace(/\r\n/g, "\n"), "regras.mjs desatualizado: rode node tools/padronizar-nomes/gerar-regras.mjs").toBe(esperado);
  });

  it("as mesmas listas e as mesmas saídas em todas as entradas dos casos", async () => {
    const copia = (await import(/* @vite-ignore */ pathToFileURL(COPIA).href)) as typeof regra;
    expect([...copia.SIGLAS]).toEqual([...regra.SIGLAS]);
    expect([...copia.CONECTIVOS]).toEqual([...regra.CONECTIVOS]);
    expect([...copia.UNIDADES]).toEqual([...regra.UNIDADES]);
    expect([...copia.TAMANHOS_DE_ROUPA]).toEqual([...regra.TAMANHOS_DE_ROUPA]);
    expect([...copia.CORES_COMPOSTAS]).toEqual([...regra.CORES_COMPOSTAS]);
    const entradas = [...casos.nomes, ...casos.exibicao, ...casos.problemas];
    for (const entrada of entradas) {
      for (const nome of ["padronizarNome", "nomeSemTamanho", "nomeComTamanho", "problemaDoNome", "tamanhoDoProduto"] as const) {
        expect((copia[nome] as (valor: unknown) => unknown)(entrada), `${nome} · ${entrada.caso}`).toEqual((regra[nome] as (valor: unknown) => unknown)(entrada));
      }
      for (const nome of ["sufixoDoCodigo", "tamanhoDoCodigo", "familiaDoCodigo"] as const) {
        expect(copia[nome](entrada.codigo), `${nome} · ${entrada.caso}`).toEqual(regra[nome](entrada.codigo));
      }
    }
  });
});
