import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  AVULSO,
  andamentoInicial,
  etapasPossiveis,
  feitosAlterados,
  inclusaoVazia,
  instanteDaFoto,
  nomeDaFoto,
  pedidosDoAndamento,
  problemaDaFoto,
  problemasDoAndamento,
  type FormularioDeAndamento,
} from "./andamento";
import { CALLABLES_DA_OPERACAO } from "./api";
import { fichaDaLeitura, type FichaDaOs } from "./ficha-da-os";

/** "Registrar andamento" na ficha da OS (parte 3.7e). */

const CARLOS = "col_cccccccccccccccc";
const AGORA = new Date("2026-10-22T17:20:00.000Z"); // 14:20 em São Paulo

const FICHA = fichaDaLeitura("10045-01", {
  status: "em_execucao",
  edicao: 9,
  demanda: "10045",
  customer_code: "ITAU",
  janela: { data: "2026-10-22", inicio: "07:30", fim: "18:00" },
  equipe: [
    { colaborador_id: "col_jjjjjjjjjjjjjjjj", nome: "João Pereira", papel: "motorista", vinculo: "proprio" },
    { colaborador_id: CARLOS, nome: "Carlos Silva", papel: "lider", vinculo: "proprio" },
  ],
  itens: [
    { id: "ln_1", item: "Cadeira Flexform", unidade: "UN", planejado: "150", executado: "96", incluidos: [{ quantidade: "10", instante: "2026-10-22T12:32:00.000Z" }] },
    { id: "ln_2", item: "Mesa de trabalho", unidade: "UN", planejado: "60" },
  ],
  etapas: [
    { etapa: "saida_patio", instante: "2026-10-22T10:05:00.000Z" },
    { etapa: "carregamento", instante: "2026-10-22T10:50:00.000Z" },
  ],
}) as FichaDaOs;

const INICIAL = andamentoInicial(FICHA, AGORA);

describe("o formulário", () => {
  it("abre na próxima etapa, hoje, agora, informado pelo líder, por telefone, com o feito de cada linha", () => {
    expect(INICIAL).toEqual({
      tipo: "etapa",
      etapa: "saida_origem",
      data: "2026-10-22",
      hora: "14:20",
      informadoPor: CARLOS,
      meio: "telefone",
      feitos: { ln_1: "96", ln_2: "0" },
      inclusao: null,
      descricao: "",
    });
    expect(etapasPossiveis(FICHA)).toEqual(["saida_origem", "chegada_destino", "montagem", "fim"]);
    expect(etapasPossiveis({ etapas: [] })[0]).toBe("saida_patio");
  });
});

describe("a etapa", () => {
  it("vai no formato de registerStep, com o fuso de São Paulo", () => {
    expect(problemasDoAndamento(INICIAL, FICHA, AGORA)).toEqual([]);
    expect(pedidosDoAndamento(INICIAL, FICHA, "k1", AGORA)).toEqual([
      {
        callable: "registerStep",
        dados: { idempotency_key: "k1", numero: "10045-01", etapa: "saida_origem", instante: "2026-10-22T14:20-03:00", informado_por: CARLOS, meio: "telefone" },
      },
    ]);
  });

  it("sem etapa, hora no futuro, data antes da OS e OS sem equipe são impedimentos", () => {
    expect(problemasDoAndamento({ ...INICIAL, etapa: "", hora: "" }, FICHA, AGORA)).toEqual(["Escolha a etapa.", "Informe a data e a hora."]);
    expect(problemasDoAndamento({ ...INICIAL, hora: "15:00" }, FICHA, AGORA)).toEqual(["A hora informada ainda não chegou."]);
    expect(problemasDoAndamento({ ...INICIAL, data: "2026-10-21" }, FICHA, AGORA)).toEqual(["A data é de antes do dia da OS."]);
    expect(problemasDoAndamento(INICIAL, { ...FICHA, status: "agendada", equipe: [] }, AGORA)).toEqual(["Escale a equipe antes de iniciar a OS."]);
    expect(problemasDoAndamento(INICIAL, { ...FICHA, status: "em_revisao" }, AGORA)).toEqual(["A OS não recebe andamento."]);
  });
});

describe("os itens", () => {
  const itens: FormularioDeAndamento = { ...INICIAL, tipo: "itens", feitos: { ln_1: "128", ln_2: "22,5" } };

  it("manda só as linhas que mudaram, uma chamada por linha, com a vírgula virando ponto", () => {
    expect(feitosAlterados({ feitos: { ln_1: "96.0", ln_2: "0" } }, FICHA)).toEqual([]);
    expect(problemasDoAndamento(itens, FICHA, AGORA)).toEqual([]);
    expect(pedidosDoAndamento(itens, FICHA, "k2", AGORA)).toEqual([
      {
        callable: "registerItem",
        dados: { action: "executed", idempotency_key: "k2:ln_1", numero: "10045-01", linha: "ln_1", executado: "128", instante: "2026-10-22T17:20:00.000Z", informado_por: CARLOS, meio: "telefone" },
      },
      {
        callable: "registerItem",
        dados: { action: "executed", idempotency_key: "k2:ln_2", numero: "10045-01", linha: "ln_2", executado: "22.5", instante: "2026-10-22T17:20:00.000Z", informado_por: CARLOS, meio: "telefone" },
      },
    ]);
  });

  it("acima do previsto pede a inclusão; nada mudou também impede; antes da primeira etapa, não", () => {
    expect(problemasDoAndamento({ ...itens, feitos: { ln_1: "161" } }, FICHA, AGORA)).toEqual(["Cadeira Flexform: o feito passa do previsto. Inclua o que foi além do planejado."]);
    expect(problemasDoAndamento({ ...itens, feitos: { ln_1: "1,2,3" } }, FICHA, AGORA)).toEqual(["Cadeira Flexform: a quantidade está fora do formato."]);
    expect(problemasDoAndamento({ ...itens, feitos: INICIAL.feitos }, FICHA, AGORA)).toEqual(["Nenhum feito mudou."]);
    expect(problemasDoAndamento(itens, { ...FICHA, status: "agendada" }, AGORA)).toEqual(["Registre a primeira etapa antes dos itens."]);
  });

  it("a inclusão vai na linha ou avulsa, com quem pediu e o motivo", () => {
    const naLinha: FormularioDeAndamento = {
      ...itens,
      feitos: INICIAL.feitos,
      inclusao: { ...inclusaoVazia(FICHA), quantidade: "10", pedidoPor: "Renata Campos", motivo: "Sala 412" },
    };
    expect(problemasDoAndamento(naLinha, FICHA, AGORA)).toEqual([]);
    expect(pedidosDoAndamento(naLinha, FICHA, "k3", AGORA)).toEqual([
      {
        callable: "registerItem",
        dados: {
          action: "added",
          idempotency_key: "k3:inclusao",
          numero: "10045-01",
          linha: "ln_1",
          quantidade: "10",
          pedido_por: "Renata Campos",
          motivo: "Sala 412",
          instante: "2026-10-22T17:20:00.000Z",
          informado_por: CARLOS,
          meio: "telefone",
        },
      },
    ]);
    const avulsa: FormularioDeAndamento = { ...naLinha, inclusao: { ...naLinha.inclusao!, linha: AVULSO, item: "Retirada de entulho", unidade: "vb", quantidade: "1" } };
    expect(pedidosDoAndamento(avulsa, FICHA, "k4", AGORA)[0].dados).toMatchObject({ item: "Retirada de entulho", unidade: "VB" });
    expect(problemasDoAndamento({ ...avulsa, inclusao: { ...avulsa.inclusao!, item: "", quantidade: "0", pedidoPor: "", motivo: "" } }, FICHA, AGORA)).toEqual([
      "Item avulso: informe o nome e a unidade.",
      "Informe a quantidade além do planejado.",
      "Informe quem pediu no local.",
      "Informe o motivo.",
    ]);
  });
});

describe("a ocorrência", () => {
  it("vai no formato de registerOccurrence; sem descrição, impede", () => {
    const ocorrencia: FormularioDeAndamento = { ...INICIAL, tipo: "ocorrencia", descricao: "  Elevador parado  ", meio: "" };
    expect(problemasDoAndamento(ocorrencia, FICHA, AGORA)).toEqual([]);
    expect(pedidosDoAndamento(ocorrencia, FICHA, "k5", AGORA)).toEqual([
      {
        callable: "registerOccurrence",
        dados: { idempotency_key: "k5", numero: "10045-01", descricao: "Elevador parado", instante: "2026-10-22T17:20:00.000Z", informado_por: CARLOS, meio: null },
      },
    ]);
    expect(problemasDoAndamento({ ...ocorrencia, descricao: "ok" }, FICHA, AGORA)).toEqual(["Descreva a ocorrência."]);
  });
});

describe("fotos", () => {
  it("o nome é ft_ com 16 hex na extensão do tipo; tipo e tamanho fora são recusados", () => {
    expect(nomeDaFoto("image/jpeg", () => new Uint8Array([0, 1, 2, 3, 0xaa, 0xbb, 0xcc, 0xff]))).toBe("ft_00010203aabbccff.jpg");
    expect(nomeDaFoto("image/webp")).toMatch(/^ft_[a-f0-9]{16}\.webp$/);
    expect(nomeDaFoto("image/heic")).toBeNull();
    expect(problemaDaFoto({ type: "image/heic", size: 10 })).toBe("Use foto JPG, PNG ou WebP.");
    expect(problemaDaFoto({ type: "image/png", size: 8 * 1024 * 1024 })).toBe("A foto passa de 8 MB.");
    expect(problemaDaFoto({ type: "image/png", size: 10 })).toBeNull();
  });

  it("o instante é o do arquivo, se for do dia da OS em diante e não estiver no futuro", () => {
    expect(instanteDaFoto(Date.parse("2026-10-22T12:31:00.000Z"), "2026-10-22", AGORA)).toBe("2026-10-22T12:31:00.000Z");
    expect(instanteDaFoto(Date.parse("2026-10-20T12:00:00.000Z"), "2026-10-22", AGORA)).toBe(AGORA.toISOString());
    expect(instanteDaFoto(Date.parse("2026-10-23T12:00:00.000Z"), "2026-10-22", AGORA)).toBe(AGORA.toISOString());
  });
});

describe("as callables", () => {
  it("toda callable que o app chama existe em functions/operacao", () => {
    const fonte = readFileSync(new URL("../../../../../functions/operacao/src/index.ts", import.meta.url), "utf8");
    const exportadas = Array.from(fonte.matchAll(/^export const (\w+) = onCall\(/gm), (match) => match[1]);
    expect([...CALLABLES_DA_OPERACAO].sort()).toEqual([...exportadas].sort());
  });
});
