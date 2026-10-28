import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  AVULSO,
  andamentoInicial,
  etapasPossiveis,
  feitosAlterados,
  inclusaoVazia,
  instanteDaFoto,
  itensAMenos,
  nomeDaAssinaturaDoArquivo,
  nomeDaFoto,
  pedidosDoAndamento,
  problemaDaFoto,
  problemasDoAndamento,
  tiposDeAndamento,
  type FormularioDeAndamento,
} from "./andamento";
import { passosDaOs, fichaDaLeitura as lerFicha, type FichaDaOs as Ficha } from "./ficha-da-os";
import { rotuloDoStatusDaOs } from "@/components/operacao/partes";
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
      aceite: "assinatura",
      nome: "",
      cargo: "",
      motivos: {},
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

describe("a conclusão pelo escritório (parte 3.9c)", () => {
  const conclusao: FormularioDeAndamento = {
    ...INICIAL,
    tipo: "conclusao",
    hora: "14:10",
    nome: " Renata Campos ",
    cargo: "Facilities",
    motivos: { ln_1: " Cadeiras do 5º andar ", ln_2: "Mesas para a próxima OS" },
  };

  it("vai no formato de completeServiceOrder, depois da foto do final e da via assinada", () => {
    expect(itensAMenos(FICHA).map((item) => [item.id, item.feito, item.previsto])).toEqual([
      ["ln_1", 96_000, 160_000],
      ["ln_2", 0, 60_000],
    ]);
    expect(problemasDoAndamento(conclusao, FICHA, AGORA, { fotosDoFinal: 1, assinatura: "as_0123456789abcdef.jpg" })).toEqual([]);
    expect(pedidosDoAndamento(conclusao, FICHA, "k6", AGORA, "as_0123456789abcdef.jpg")).toEqual([
      {
        callable: "completeServiceOrder",
        dados: {
          idempotency_key: "k6",
          numero: "10045-01",
          instante: "2026-10-22T14:10-03:00",
          aceite: "assinatura",
          // Sem o número do documento (decisão 3 da LGPD).
          responsavel: { nome: "Renata Campos", cargo: "Facilities" },
          assinatura: "as_0123456789abcdef.jpg",
          diferencas: [
            { linha: "ln_1", motivo: "Cadeiras do 5º andar" },
            { linha: "ln_2", motivo: "Mesas para a próxima OS" },
          ],
          informado_por: CARLOS,
          meio: "telefone",
        },
      },
    ]);
    expect(nomeDaAssinaturaDoArquivo("image/jpeg", () => new Uint8Array([1, 35, 69, 103, 137, 171, 205, 239]))).toBe("as_0123456789abcdef.jpg");
  });

  it("sem aceite: só quem recebeu, sem assinatura", () => {
    const sem = { ...conclusao, aceite: "sem_aceite" as const, nome: "Sr. Almeida" };
    expect(problemasDoAndamento(sem, FICHA, AGORA, { fotosDoFinal: 1, assinatura: null })).toEqual([]);
    const [pedido] = pedidosDoAndamento(sem, FICHA, "k7", AGORA, "as_0123456789abcdef.jpg");
    expect(pedido.dados.responsavel).toEqual({ nome: "Sr. Almeida" });
    expect(pedido.dados).not.toHaveProperty("assinatura");
  });

  it("pede o motivo de cada item a menos, a foto do final, o nome e a via assinada; a hora não vem antes da última etapa", () => {
    expect(problemasDoAndamento({ ...conclusao, motivos: {}, nome: "", hora: "07:40" }, FICHA, AGORA)).toEqual([
      "A hora vem antes de Carregamento.",
      "Informe o motivo da diferença em Cadeira Flexform.",
      "Informe o motivo da diferença em Mesa de trabalho.",
      "Anexe ao menos uma foto do final.",
      "Informe o nome do responsável.",
      "Anexe a foto da via assinada.",
    ]);
    // A foto do final que já está na OS conta.
    const comFoto = { ...FICHA, fotos: [{ id: "ft_1", caminho: "c", etapa: "fim" as const, ocorrencia: null, linha: null, legenda: null, instante: "2026-10-22T17:00:00.000Z", canal: "celular" as const, meio: null, informadoPor: null }] };
    expect(problemasDoAndamento(conclusao, comFoto, AGORA, { fotosDoFinal: 0, assinatura: "as_x.jpg" })).toEqual([]);
    expect(problemasDoAndamento(conclusao, { ...FICHA, status: "agendada" }, AGORA)).toEqual(["Registre a primeira etapa antes de concluir."]);
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
    // O envio de confirmação pertence ao acesso inicial, sem perfil de Operação.
    expect([...CALLABLES_DA_OPERACAO, "sendInviteEmailVerification"].sort()).toEqual([...exportadas].sort());
  });
});

describe("a vistoria no escritório (parte 3.11d)", () => {
  const vistoria = (extra: Record<string, unknown> = {}) =>
    lerFicha("10060-01", { tipo: "vistoria", status: "agendada", edicao: 2, demanda: "10060", customer_code: "ITAU", servicos: ["vistoria"], equipe: [{ colaborador_id: "col_cccccccccccccccc", nome: "Carlos Silva", papel: "lider" }], ...extra }) as Ficha;

  it("o andamento é só etapa e ocorrência; as etapas, só ir e chegar", () => {
    expect(tiposDeAndamento(vistoria())).toEqual(["etapa", "ocorrencia"]);
    expect(etapasPossiveis(vistoria())).toEqual(["saida_patio", "chegada_origem"]);
    expect(etapasPossiveis(vistoria({ etapas: [{ etapa: "chegada_origem", instante: "2026-10-22T17:05:00.000Z" }] }))).toEqual([]);
    expect(tiposDeAndamento(lerFicha("10045-01", { status: "agendada", edicao: 2, demanda: "10045", customer_code: "ITAU" }) as Ficha)).toEqual(["etapa", "itens", "ocorrencia", "conclusao"]);
  });

  it("os três passos: agendar, executar e enviar ao Comercial; enviada, todos feitos", () => {
    const agendada = passosDaOs(vistoria());
    expect(agendada.map((passo) => [passo.titulo, passo.estado])).toEqual([
      ["Agendar", "feito"],
      ["Executar", "atual"],
      ["Enviar ao Comercial", "pendente"],
    ]);
    expect(agendada[1].quem).toBe("Líder · Carlos Silva");
    const enviada = passosDaOs(vistoria({ status: "revisada", vistoria: { instante: "2026-10-22T18:40:00.000Z", canal: "celular", ambientes: [] } }));
    expect(enviada.map((passo) => passo.estado)).toEqual(["feito", "feito", "feito"]);
    expect(enviada[2].detalhe).toBe("Enviada 15:40");
    expect(passosDaOs(vistoria({ status: "aberta" }))[0].estado).toBe("atual");
  });

  it("a vistoria revisada diz que foi enviada ao Comercial; a OS de serviço continua revisada", () => {
    expect(rotuloDoStatusDaOs({ status: "revisada", tipo: "vistoria" })).toBe("Enviada ao Comercial");
    expect(rotuloDoStatusDaOs({ status: "agendada", tipo: "vistoria" })).toBe("Agendada");
    expect(rotuloDoStatusDaOs({ status: "revisada" })).toBe("Revisada");
  });
});
