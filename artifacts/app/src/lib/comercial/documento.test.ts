import { describe, expect, it } from "vitest";

import {
  deveImprimir,
  documentoDoOrcamento,
  fonteDoDocumento,
  hrefDoDocumento,
  linhasDasCondicoes,
  nomeDoArquivo,
  parametrosDoDocumento,
  referenciasDoDocumento,
  textoDaExecucao,
  tituloDoDocumento,
} from "./documento";

/**
 * O documento A4 do orçamento (docs/mockups/ComDocumento.dc.html, parte 12a):
 * o título e o nome do arquivo, a prévia até o envio e, depois dele, a cópia
 * congelada em quotes/{numero}/revisoes/{rv}.
 */

type Registro = Record<string, unknown>;

const DEMANDA: Registro = {
  numero: "10045",
  customer_code: "ITAU-UNIBANCO",
  customer_name: "Itaú Unibanco S.A.",
  contrato_id: "itau-2026",
  titulo: "Mudança de 24 estações de trabalho",
  ref_cliente: "CE8977",
  solicitante: { contato_id: "ct_renata", empresa: "Souza & Lopes" },
  origem: { local_id: "loc_ceic", complemento: "8º andar" },
  destino: { local_id: "loc_fl", complemento: "12º andar" },
  execucao: { datas: ["2026-10-29"], de: null, ate: null, a_definir: false, visita_tecnica: null },
};

const LINHAS = [
  { id: "ln_1", origem: "tabela", codigo: "1.01", item: "Estação de trabalho em L 1,40 m", descricao: "x", servico: "Desmontagem", unidade: "UN", quantidade: "24", preco: "38.5", preco_tabela: "38.5", motivo: null, total_cents: 92_400 },
  { id: "ln_2", origem: "alterado", codigo: "5.02", item: "Transporte dedicado VUC até 2,5 t", descricao: "x", servico: "Frete", unidade: "VG", quantidade: "3", preco: "690", preco_tabela: "600", motivo: "Espera", total_cents: 207_000 },
  { id: "ln_3", origem: "ajuste", codigo: null, item: "Desconto combinado", descricao: "Desconto combinado", servico: null, unidade: null, quantidade: "1", preco: "-100", preco_tabela: null, motivo: "Combinado", total_cents: -10_000 },
];

const QUOTE: Registro = {
  numero: "10045",
  rotulo: "10045 – RV01",
  customer_code: "ITAU-UNIBANCO",
  rv: 1,
  tipo_rv: "proposta",
  status: "aprovado",
  edicao: 5,
  data_base: "2026-10-14",
  tabela: { id: "pt_itau", nome: "LPU v2.0", variante: "Comercial" },
  linhas: LINHAS,
  total_cents: 289_400,
  condicoes: "- Itens sujeitos a visita técnica.\n\n• Faturamento após autorização do cliente.",
  autor_uid: "u-gui",
  autor_nome: "Guilherme",
};

/** A RV 0, enviada em 14/10 e congelada: o que o cliente recebeu. */
const REVISAO_0: Registro = {
  ...QUOTE,
  rotulo: "10045",
  rv: 0,
  linhas: [LINHAS[0]],
  total_cents: 92_400,
  condicoes: "Condições da RV 0.",
  demanda: { ...DEMANDA, titulo: "Mudança (como foi enviada)" },
  enviado_por: "u-gui",
  enviado_em: "2026-10-14T19:30:00.000Z",
};

const AGORA = new Date("2026-10-21T15:00:00.000Z");

const CONTEXTO = {
  numero: "10045",
  agora: AGORA,
  contato: { nome: "Renata Albuquerque", empresa: "Souza & Lopes" },
  origem: "CEIC – Torre Olavo Setubal",
  destino: "Faria Lima 3400",
  contrato: { nome: "Contrato Itaú", numeros: ["2021/0187"] },
  autorNome: null,
};

describe("rota do documento", () => {
  it("a RV e o pedido de impressão vão na busca; sem número válido, nada", () => {
    expect(hrefDoDocumento("10045", 1)).toBe("/comercial/orcamento/documento?numero=10045&rv=1");
    expect(hrefDoDocumento("10045")).toBe("/comercial/orcamento/documento?numero=10045");
    expect(hrefDoDocumento("10045", 0, { imprimir: true })).toBe("/comercial/orcamento/documento?numero=10045&rv=0&imprimir=1");
    expect(parametrosDoDocumento("?numero=10045&rv=1&imprimir=1")).toEqual({ numero: "10045", rv: 1, imprimir: true });
    expect(parametrosDoDocumento("numero=10045")).toEqual({ numero: "10045", rv: null, imprimir: false });
    expect(parametrosDoDocumento("?numero=10045&rv=x")).toEqual({ numero: "10045", rv: null, imprimir: false });
    expect(parametrosDoDocumento("?numero=../users")).toBeNull();
  });
});

describe("título e nome do arquivo", () => {
  it('"Orçamento 10045" na RV 0; "Orçamento 10045 – RV01" depois', () => {
    expect(tituloDoDocumento("10045")).toBe("Orçamento 10045");
    expect(tituloDoDocumento("10045 – RV01")).toBe("Orçamento 10045 – RV01");
  });

  it("o nome do PDF: título, referência e título da demanda; o que falta fica de fora", () => {
    expect(nomeDoArquivo({ rotulo: "10045 – RV01", refCliente: "CE8977", titulo: "Mudança de layout" })).toBe(
      "Orçamento 10045 – RV01 – CE8977 – Mudança de layout",
    );
    expect(nomeDoArquivo({ rotulo: "10045", refCliente: null, titulo: "Mudança" })).toBe("Orçamento 10045 – Mudança");
    expect(nomeDoArquivo({ rotulo: "10045", refCliente: null, titulo: null })).toBe("Orçamento 10045");
  });

  it("sem caractere que o Windows recusa em nome de arquivo", () => {
    expect(nomeDoArquivo({ rotulo: "10045", refCliente: "SL/260", titulo: 'Sala "A": 3º andar?' })).toBe(
      "Orçamento 10045 – SL-260 – Sala -A- 3º andar-",
    );
  });
});

describe("a fonte: prévia até o envio, cópia congelada depois", () => {
  it("a RV em curso ainda não enviada é a prévia, do orçamento e da demanda ao vivo", () => {
    const fonte = fonteDoDocumento({ rv: 1, quote: QUOTE, demanda: DEMANDA, revisao: null });
    expect(fonte).toMatchObject({ estado: "pronto", congelada: false, rv: 1, enviadoEm: null });
    // A RV aprovada (revisoes/{rv} sem envio) continua prévia.
    expect(fonteDoDocumento({ rv: 1, quote: QUOTE, demanda: DEMANDA, revisao: { ...QUOTE, enviado_em: null } })).toMatchObject({
      congelada: false,
    });
  });

  it("enviada, lê a cópia congelada em revisoes/{rv}, com a demanda como foi enviada", () => {
    const fonte = fonteDoDocumento({ rv: 0, quote: QUOTE, demanda: DEMANDA, revisao: REVISAO_0 });
    expect(fonte).toMatchObject({ estado: "pronto", congelada: true, rv: 0, enviadoEm: "2026-10-14T19:30:00.000Z" });
    if (fonte.estado !== "pronto") throw new Error("fonte");
    expect(fonte.orcamento).toBe(REVISAO_0);
    expect(fonte.demanda.titulo).toBe("Mudança (como foi enviada)");
    // A RV atual enviada também vem da cópia, mesmo com o orçamento ao vivo diferente.
    const atualEnviada = fonteDoDocumento({ rv: null, quote: { ...QUOTE, rv: 0, status: "enviado" }, demanda: DEMANDA, revisao: REVISAO_0 });
    expect(atualEnviada).toMatchObject({ congelada: true, rv: 0 });
  });

  it("RV antiga sem envio não tem documento; o orçamento que não existe, também não; lendo, carregando", () => {
    expect(fonteDoDocumento({ rv: 0, quote: QUOTE, demanda: DEMANDA, revisao: null })).toEqual({ estado: "nao_encontrado" });
    expect(fonteDoDocumento({ rv: 0, quote: null, demanda: DEMANDA, revisao: undefined })).toEqual({ estado: "nao_encontrado" });
    expect(fonteDoDocumento({ rv: null, quote: undefined, demanda: undefined, revisao: undefined })).toEqual({ estado: "carregando" });
    expect(fonteDoDocumento({ rv: 1, quote: QUOTE, demanda: undefined, revisao: null })).toEqual({ estado: "carregando" });
    expect(fonteDoDocumento({ rv: 1, quote: QUOTE, demanda: DEMANDA, revisao: undefined })).toEqual({ estado: "carregando" });
  });

  it("o contato, os locais e o contrato que se leem pelo nome", () => {
    expect(referenciasDoDocumento(fonteDoDocumento({ rv: 1, quote: QUOTE, demanda: DEMANDA, revisao: null }))).toEqual({
      contatoId: "ct_renata",
      origemLocalId: "loc_ceic",
      destinoLocalId: "loc_fl",
      contratoId: "itau-2026",
    });
  });
});

describe("o documento", () => {
  it("a prévia: marca, título, nome do arquivo, quadro do mockup, linhas, total, condições e quem montou", () => {
    const fonte = fonteDoDocumento({ rv: 1, quote: QUOTE, demanda: DEMANDA, revisao: null });
    if (fonte.estado !== "pronto") throw new Error("fonte");
    const documento = documentoDoOrcamento(fonte, CONTEXTO);
    expect(documento.previa).toBe(true);
    expect(documento.titulo).toBe("Orçamento 10045 – RV01");
    expect(documento.nomeDoArquivo).toBe("Orçamento 10045 – RV01 – CE8977 – Mudança de 24 estações de trabalho");
    expect(documento.tipo).toBe("Proposta");
    expect(documento.campos.map((campo) => [campo.rotulo, campo.valor, campo.largura])).toEqual([
      ["Emissão", "21/10/2026", 2],
      ["Data-base de preço", "14/10/2026", 2],
      ["Data de execução", "29/10/2026", 2],
      ["Cliente", "Itaú Unibanco S.A.", 2],
      ["Contrato nº", "2021/0187", 1],
      ["Tabela", "LPU v2.0 · Comercial", 3],
      ["Para", "Renata Albuquerque · Souza & Lopes", 4],
      ["Referência do cliente", "CE8977", 2],
      ["Descrição da atividade", "Mudança de 24 estações de trabalho", 6],
      ["Origem", "CEIC – Torre Olavo Setubal · 8º andar", 3],
      ["Destino", "Faria Lima 3400 · 12º andar", 3],
    ]);
    expect(documento.linhas).toEqual([
      { chave: "ln_1", codigo: "1.01", item: "Estação de trabalho em L 1,40 m", servico: "Desmontagem", unidade: "UN", valorUnitario: "38,50", quantidade: "24", total: "924,00" },
      { chave: "ln_2", codigo: "5.02", item: "Transporte dedicado VUC até 2,5 t", servico: "Frete", unidade: "VG", valorUnitario: "690,00", quantidade: "3", total: "2.070,00" },
      { chave: "ln_3", codigo: "", item: "Desconto combinado", servico: "Ajuste", unidade: "", valorUnitario: "", quantidade: "", total: "-100,00" },
    ]);
    expect(documento.total).toBe("R$ 2.894,00");
    expect(documento.condicoes).toEqual(["Itens sujeitos a visita técnica.", "Faturamento após autorização do cliente."]);
    expect(documento.autor).toBe("Guilherme");
  });

  it("enviado: a cópia congelada, sem marca, com a emissão do envio e a demanda como foi enviada", () => {
    const fonte = fonteDoDocumento({ rv: 0, quote: QUOTE, demanda: DEMANDA, revisao: REVISAO_0 });
    if (fonte.estado !== "pronto") throw new Error("fonte");
    const documento = documentoDoOrcamento(fonte, CONTEXTO);
    expect(documento.previa).toBe(false);
    expect(documento.titulo).toBe("Orçamento 10045");
    expect(documento.nomeDoArquivo).toBe("Orçamento 10045 – CE8977 – Mudança (como foi enviada)");
    expect(documento.campos[0]).toEqual({ rotulo: "Emissão", valor: "14/10/2026", largura: 2 });
    expect(documento.linhas.map((linha) => linha.chave)).toEqual(["ln_1"]);
    expect(documento.total).toBe("R$ 924,00");
    expect(documento.condicoes).toEqual(["Condições da RV 0."]);
  });

  it("sem contrato, o cliente ocupa a linha com a tabela; sem locais, sem origem e destino; o autor pelo perfil no orçamento antigo", () => {
    const demanda = { ...DEMANDA, contrato_id: null, origem: null, destino: null, titulo: null };
    const fonte = fonteDoDocumento({ rv: 1, quote: { ...QUOTE, autor_nome: undefined, tabela: null }, demanda, revisao: null });
    if (fonte.estado !== "pronto") throw new Error("fonte");
    const documento = documentoDoOrcamento(fonte, { ...CONTEXTO, contrato: null, origem: null, destino: null, autorNome: "Leonardo" });
    expect(documento.campos.map((campo) => [campo.rotulo, campo.largura])).toEqual([
      ["Emissão", 2],
      ["Data-base de preço", 2],
      ["Data de execução", 2],
      ["Cliente", 3],
      ["Tabela", 3],
      ["Para", 4],
      ["Referência do cliente", 2],
    ]);
    expect(documento.campos.find((campo) => campo.rotulo === "Tabela")?.valor).toBe("Sem tabela");
    expect(documento.autor).toBe("Leonardo");
  });

  it("a data de execução: a executada na RV de execução; o intervalo; a definir", () => {
    expect(textoDaExecucao({ ...DEMANDA, executado_de: "2026-10-24", executado_ate: "2026-10-25" }, "execucao")).toBe("24/10/2026 a 25/10/2026");
    expect(textoDaExecucao({ execucao: { datas: [], de: "2026-10-24", ate: "2026-10-25", a_definir: false } }, "proposta")).toBe(
      "24/10/2026 a 25/10/2026",
    );
    expect(textoDaExecucao({ execucao: { datas: [], de: null, ate: null, a_definir: true } }, "proposta")).toBe("A definir");
    expect(textoDaExecucao({}, "proposta")).toBe("A definir");
  });

  it("as condições: uma por linha, sem o marcador digitado e sem linha vazia", () => {
    expect(linhasDasCondicoes("  - Um\n* Dois\n\n• Três  ")).toEqual(["Um", "Dois", "Três"]);
    expect(linhasDasCondicoes(null)).toEqual([]);
  });
});

describe("a impressão depois do envio", () => {
  it("abre sozinha só no documento enviado, quando pedida, uma vez", () => {
    expect(deveImprimir({ pedido: true, congelada: true, jaAbriu: false })).toBe(true);
    expect(deveImprimir({ pedido: true, congelada: true, jaAbriu: true })).toBe(false);
    // A prévia nunca abre a impressão sozinha: o PDF só sai depois de gravar o envio.
    expect(deveImprimir({ pedido: true, congelada: false, jaAbriu: false })).toBe(false);
    expect(deveImprimir({ pedido: false, congelada: true, jaAbriu: false })).toBe(false);
  });
});
