import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { fichaDaLeitura, type FichaDaOs } from "../operacao/ficha-da-os";
import {
  conclusaoGuardada,
  fotosDoFinal,
  itensParaConcluir,
  nomeDaAssinatura,
  problemaParaConcluir,
  problemasDaConclusao,
  registroDeConclusao,
  responsavelSugerido,
  ultimaEtapa,
  type FormularioDaConclusao,
} from "./concluir";
import { registroNovo } from "./fila";
import { registroDeEtapa, registroDeFeito, registroDeFoto } from "./os-no-campo";

/**
 * Concluir a OS no celular (parte 3.9b): o feito contra o previsto com o
 * guardado por cima, o motivo de cada item a menos, as fotos do final e o
 * registro no formato de completeServiceOrder (parte 3.9a).
 */

const AGORA = new Date("2026-10-20T20:50:00.000Z");
const CARLOS = "col_cccccccccccccccc";
const DIEGO = "col_dddddddddddddddd";

const FICHA = fichaDaLeitura("10211-01", {
  status: "em_execucao",
  edicao: 9,
  demanda: "10211",
  customer_code: "ITAU",
  cliente_nome: "Itaú Unibanco",
  janela: { data: "2026-10-20", inicio: "07:30", fim: "18:00" },
  locais: { origem: { endereco: "Faria Lima 3500", contato: { nome: "Renata Campos" } }, destino: { endereco: "Torre B", complemento: "12º andar", contato: { nome: "Marcos Prado" } } },
  equipe: [
    { colaborador_id: CARLOS, nome: "Carlos Silva", papel: "lider", vinculo: "proprio", no_app: true, usuario_uid: "uid-carlos" },
    { colaborador_id: DIEGO, nome: "Diego Alves", papel: "montador", vinculo: "proprio", no_app: true, usuario_uid: "uid-diego" },
  ],
  itens: [
    {
      id: "ln_1",
      codigo: "3.05",
      item: "Cadeira Flexform",
      unidade: "UN",
      planejado: "150",
      executado: "160",
      incluidos: [{ quantidade: "10", instante: "2026-10-20T12:32:00.000Z", informado_por: CARLOS, pedido_por: "Renata", motivo: "Pedido no local" }],
    },
    { id: "ln_2", codigo: "2.02", item: "Mesa de trabalho", unidade: "UN", planejado: "60", executado: "58" },
  ],
  etapas: [
    { etapa: "saida_patio", instante: "2026-10-20T10:05:00.000Z" },
    { etapa: "montagem", instante: "2026-10-20T16:00:00.000Z" },
  ],
  fotos: [
    { id: "ft_0000000000000001", caminho: "os/10211-01/fotos/ft_0000000000000001.jpg", etapa: "carregamento", instante: "2026-10-20T11:00:00.000Z" },
    { id: "ft_f000000000000001", caminho: "os/10211-01/fotos/ft_f000000000000001.jpg", etapa: "fim", instante: "2026-10-20T20:46:00.000Z" },
  ],
}) as FichaDaOs;

const FORMULARIO: FormularioDaConclusao = {
  aceite: "assinatura",
  nome: " Renata Campos ",
  cargo: "Facilities",
  documento: "12.345.678-9",
  motivos: { ln_2: " 2 mesas com pé quebrado " },
};

/** As chaves do objeto `Concluir` da callable (functions/operacao/src/domain/conclusao.ts). */
function chavesDaCallable(): { topo: string[]; responsavel: string[]; diferenca: string[] } {
  const fonte = readFileSync(new URL("../../../../../functions/operacao/src/domain/conclusao.ts", import.meta.url), "utf8");
  const bloco = fonte.slice(fonte.indexOf("const Concluir = z"), fonte.indexOf("export type PedidoDeConclusao"));
  const responsavel = bloco.slice(bloco.indexOf("responsavel: z"), bloco.indexOf("assinatura: opcional"));
  const diferenca = bloco.slice(bloco.indexOf("diferencas: z"), bloco.indexOf("informado_por:"));
  const chaves = (trecho: string, recuo: number) => [...trecho.matchAll(new RegExp(`^ {${recuo}}(\\w+)(?::|,$)`, "gm"))].map((encontrado) => encontrado[1]);
  return { topo: chaves(bloco, 4), responsavel: chaves(responsavel, 8), diferenca: chaves(diferenca, 12) };
}

describe("itens para concluir", () => {
  it("o feito contra o previsto, a diferença e a inclusão em campo", () => {
    const itens = itensParaConcluir(FICHA, []);
    expect(itens.map((item) => [item.item, item.feito, item.previsto, item.diferenca, item.incluidos])).toEqual([
      ["Cadeira Flexform", "160", "160", null, ["+10 incluídas em campo · Carlos Silva · 09:32"]],
      ["Mesa de trabalho", "58", "60", "−2", []],
    ]);
  });

  it("o feito guardado na fila vale por cima do gravado", () => {
    const guardado = registroNovo(registroDeFeito(FICHA, { id: "ln_2", item: "Mesa de trabalho" }, 60_000, AGORA), "k1", AGORA);
    expect(itensParaConcluir(FICHA, [guardado]).map((item) => item.falta)).toEqual([0, 0]);
  });
});

describe("quem conclui", () => {
  it("o líder, com a OS em execução; o montador, não", () => {
    expect(problemaParaConcluir(FICHA, [], "uid-carlos")).toBeNull();
    expect(problemaParaConcluir(FICHA, [], "uid-diego")).toBe("Só o líder conclui a OS.");
    const semLider = { ...FICHA, equipe: FICHA.equipe.map((pessoa) => ({ ...pessoa, papel: "montador" as const })) };
    expect(problemaParaConcluir(semLider, [], "uid-diego")).toBeNull();
  });

  it("a agendada só depois da primeira etapa (mesmo guardada); a concluída e a guardada, não", () => {
    const agendada = { ...FICHA, status: "agendada" as const, etapas: [] };
    expect(problemaParaConcluir(agendada, [], "uid-carlos")).toBe("Registre a primeira etapa antes de concluir.");
    expect(problemaParaConcluir(agendada, [registroNovo(registroDeEtapa(FICHA, "saida_patio", AGORA), "k1", AGORA)], "uid-carlos")).toBeNull();
    expect(problemaParaConcluir({ ...FICHA, status: "em_revisao" }, [], "uid-carlos")).toBe("OS concluída");
    const guardada = registroNovo(registroDeConclusao(FICHA, FORMULARIO, itensParaConcluir(FICHA, []), null, AGORA), "k2", AGORA);
    expect(conclusaoGuardada(FICHA, [guardada])?.chave).toBe("k2");
    expect(problemaParaConcluir(FICHA, [guardada], "uid-carlos")).toBe("A conclusão já está guardada.");
  });
});

describe("o que a conclusão pede", () => {
  const itens = itensParaConcluir(FICHA, []);

  it("o motivo de cada item a menos, a foto do final, o nome e a assinatura", () => {
    expect(problemasDaConclusao(FORMULARIO, itens, 1, true)).toEqual([]);
    expect(problemasDaConclusao({ ...FORMULARIO, motivos: {}, nome: "" }, itens, 0, false)).toEqual([
      "Informe o motivo da diferença em Mesa de trabalho.",
      "Tire ao menos uma foto do final.",
      "Informe o nome do responsável.",
      "Colha a assinatura do responsável.",
    ]);
    expect(problemasDaConclusao({ ...FORMULARIO, aceite: "sem_aceite", nome: "" }, itens, 1, false)).toEqual(["Informe quem recebeu."]);
  });

  it("as fotos do final: as da etapa Fim, gravadas e guardadas", () => {
    const foto = registroNovo(
      registroDeFoto(FICHA, { arquivo: new Blob(["x"], { type: "image/jpeg" }), nome: "ft_f000000000000002.jpg", contentType: "image/jpeg", instante: AGORA.toISOString() }, { etapa: "fim" }),
      "k3",
      AGORA,
    );
    const final = fotosDoFinal(FICHA, [foto]);
    expect([final.gravadas.map((gravada) => gravada.id), final.guardadas.map((guardada) => guardada.chave)]).toEqual([["ft_f000000000000001"], ["k3"]]);
  });

  it("o cabeçalho: a última etapa e o contato do destino como responsável", () => {
    expect(ultimaEtapa(FICHA, [])).toEqual({ rotulo: "Montagem", hora: "13:00" });
    expect(responsavelSugerido(FICHA)).toBe("Marcos Prado");
  });
});

describe("o registro da conclusão", () => {
  const itens = itensParaConcluir(FICHA, []);

  it("com assinatura: os dados de completeServiceOrder e a imagem que sobe antes", () => {
    const arquivo = new Blob(["png"], { type: "image/png" });
    const registro = registroDeConclusao(FICHA, FORMULARIO, itens, { arquivo, nome: "as_0123456789abcdef.png" }, AGORA);
    expect(registro).toEqual({
      callable: "completeServiceOrder",
      dados: {
        numero: "10211-01",
        instante: "2026-10-20T20:50:00.000Z",
        aceite: "assinatura",
        responsavel: { nome: "Renata Campos", cargo: "Facilities", documento: "12.345.678-9" },
        assinatura: "as_0123456789abcdef.png",
        diferencas: [{ linha: "ln_2", motivo: "2 mesas com pé quebrado" }],
      },
      foto: { caminho: "os/10211-01/assinatura/as_0123456789abcdef.png", arquivo, contentType: "image/png" },
      rotulo: "Conclusão",
    });
    // O nome da assinatura é o que o storage.rules aceita.
    expect(nomeDaAssinatura(() => new Uint8Array([1, 35, 69, 103, 137, 171, 205, 239]))).toBe("as_0123456789abcdef.png");
  });

  it("sem aceite: só o nome de quem recebeu, sem assinatura nem imagem", () => {
    const registro = registroDeConclusao(FICHA, { ...FORMULARIO, aceite: "sem_aceite", nome: "Sr. Almeida" }, itens, { arquivo: new Blob(), nome: "as_0123456789abcdef.png" }, AGORA);
    expect(registro.dados).toEqual({
      numero: "10211-01",
      instante: "2026-10-20T20:50:00.000Z",
      aceite: "sem_aceite",
      responsavel: { nome: "Sr. Almeida" },
      diferencas: [{ linha: "ln_2", motivo: "2 mesas com pé quebrado" }],
    });
    expect(registro.foto).toBeUndefined();
  });

  it("só manda o que a callable aceita (o schema é strict)", () => {
    const { topo, responsavel, diferenca } = chavesDaCallable();
    expect(topo).toEqual(expect.arrayContaining(["idempotency_key", "numero", "instante", "aceite", "responsavel", "assinatura", "diferencas"]));
    const registro = registroNovo(registroDeConclusao(FICHA, FORMULARIO, itens, { arquivo: new Blob(), nome: "as_0123456789abcdef.png" }, AGORA), "k", AGORA);
    for (const chave of Object.keys(registro.dados)) expect(topo, chave).toContain(chave);
    for (const chave of Object.keys(registro.dados.responsavel as object)) expect(responsavel, chave).toContain(chave);
    for (const linha of registro.dados.diferencas as object[]) for (const chave of Object.keys(linha)) expect(diferenca, chave).toContain(chave);
  });
});
