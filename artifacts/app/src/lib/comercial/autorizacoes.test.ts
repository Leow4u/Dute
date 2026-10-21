import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { somarDias } from "@workspace/dominio";
import { describe, expect, it } from "vitest";

import {
  AUTORIZACOES_QUE_ESPERAM,
  AVISOS_ANTES_DA_PERDA,
  ETAPAS_COM_PRAZO_DE_PERDA,
  FAIXAS_DE_IDADE,
  FILTROS_DE_IDADE,
  MARCAS_AUTORIZACAO,
  ROTULO_DO_FILTRO,
  TIPOS_AUTORIZACAO_CLIENTE,
  alertaDePrazoDePerda,
  alternarMarcacao,
  autorizacaoDoRegistro,
  autorizacoesParaOInicio,
  autorizadasAFaturar,
  chaveDaRv,
  conferenciaDoValor,
  contarPorFaixa,
  contratoDoPainel,
  demandaDoRegistro,
  diasEsperando,
  faixaDeIdade,
  formNovaAutorizacao,
  gruposDaFila,
  inicioDaEspera,
  linhasDaFila,
  linhasMarcadas,
  marcosDoPrazoDePerda,
  payloadCancelar,
  payloadRegistrar,
  podeMarcar,
  rotulosDoTipo,
  somaDasLinhas,
  textoDoRegistro,
  tipoDasLinhas,
  totalDasAutorizadas,
  valorDaTela,
  type AutorizacaoRegistrada,
  type DemandaDaFila,
  type FormAutorizacao,
  type LinhaDaFila,
} from "./autorizacoes";
import { contratoDoRegistro, type Contrato } from "./contratos";

/**
 * Tela de Autorizações do Comercial (docs/mockups/ComAutorizacoes.dc.html;
 * parte 15b de docs/plataforma/fase-6-comercial.md): a fila de executados
 * agrupada por cliente, o filtro de idade, a soma e a conferência do valor, a
 * entrada da recordAuthorization (parte 15a), as autorizadas a faturar e os
 * itens do Início. Demandas, números e CNPJs sintéticos.
 */

const HOJE = "2026-10-21";
/** O R$ de formatarReais (lib/dominio) vem com espaço que não quebra. */
const reais = (texto: string) => texto.replace(/R\$ /g, "R$\u00a0");
const here = dirname(fileURLToPath(import.meta.url));
const read = (relative: string) => readFileSync(resolve(here, "../../../../..", relative), "utf8").replace(/\r\n/g, "\n");

const ITAU = "ITAU-UNIBANCO";
const BTG = "BTG_Pactual";
const NOMES = new Map([
  [ITAU, "Itaú Unibanco"],
  [BTG, "BTG Pactual"],
]);

const CONTRATO_ITAU = contratoDoRegistro("itau-2026", {
  customer_code: ITAU,
  nome: "Gestão de Mudanças",
  vigente_de: "2026-07-01",
  vigente_ate: "2027-06-30",
  autorizacao: { tipo: "pedido_aceite", prazo_perda_dias: null },
  codigo_servico: "1602",
})!;
const CONTRATO_BTG = contratoDoRegistro("btg-2026", {
  customer_code: BTG,
  nome: "Armazenagem e serviços",
  vigente_de: "2026-01-01",
  vigente_ate: null,
  autorizacao: { tipo: "portal", prazo_perda_dias: 90 },
})!;
const CONTRATOS: Contrato[] = [CONTRATO_ITAU, CONTRATO_BTG];

/** A demanda como recordAuthorization e advanceDemand gravam (validada, aguardando autorização). */
function registro(numero: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  const itau = !String(extra.customer_code ?? "").startsWith("BTG");
  return {
    numero,
    customer_code: ITAU,
    customer_name: "Itaú Unibanco S.A.",
    contrato_id: itau ? "itau-2026" : "btg-2026",
    etapa: "aguardando_autorizacao",
    titulo: `Serviço ${numero}`,
    ref_cliente: `CE${numero.slice(-4)}`,
    solicitante: { contato_id: "ct_1", empresa: "Gerenciadora A" },
    numero_legado: null,
    executado_de: null,
    executado_ate: null,
    validacao: { rv: 2, etapa: "aguardando_autorizacao", autorizacao: itau ? "pedido_aceite" : "portal", em: "2026-10-20T13:00:00.000Z" },
    autorizacao_ids: [],
    ...extra,
  };
}

const DEMANDAS: DemandaDaFila[] = [
  registro("10029", { executado_ate: "2026-08-12", titulo: "Montagem de sala de treinamento", numero_legado: "9898" }),
  registro("10031", { executado_ate: "2026-09-02", solicitante: { contato_id: "ct_2", empresa: "Gerenciadora B" } }),
  registro("10036", { executado_ate: "2026-09-15" }),
  registro("10042", { executado_ate: "2026-09-22" }),
  registro("10045", {
    executado_ate: "2026-10-06",
    titulo: "Desmontagem e transporte de mobiliário",
    validacao: { rv: 3, etapa: "aguardando_autorizacao", autorizacao: "pedido_aceite", em: "2026-10-08T13:00:00.000Z" },
  }),
  registro("10047", { executado_ate: "2026-10-09", titulo: "Transporte de arquivo deslizante" }),
  registro("10044", {
    customer_code: BTG,
    customer_name: "Banco BTG Pactual S.A.",
    executado_ate: "2026-09-25",
    titulo: "Desmontagem de estande",
    ref_cliente: "REQ 0001",
    solicitante: null,
  }),
].map((data) => demandaDoRegistro(String(data.numero), data)!);

const VALORES = new Map<string, number>([
  [chaveDaRv("10029", 2), 2231000],
  [chaveDaRv("10031", 2), 1842050],
  [chaveDaRv("10036", 2), 394640],
  [chaveDaRv("10042", 2), 987400],
  [chaveDaRv("10045", 3), 1423680],
  [chaveDaRv("10047", 2), 651200],
  [chaveDaRv("10044", 2), 548000],
]);

const LINHAS = linhasDaFila(DEMANDAS, { nomes: NOMES, valores: VALORES, hoje: HOJE });
const linha = (numero: string) => LINHAS.find((item) => item.numero === numero)!;

function form(extra: Partial<FormAutorizacao> = {}): FormAutorizacao {
  return { ...formNovaAutorizacao(HOJE), pedido: "4500000001", aceite: "1000000001", valor: "20.748,80", ...extra };
}

/** Lista literal `export const NOME = [ ... ]` de um arquivo das Functions (só texto ou número). */
function listaDoBackend(source: string, nome: string): Array<string | number> {
  const match = new RegExp(`export const ${nome}\\b[^=]*=\\s*\\[([^\\]]*)\\]`).exec(source);
  if (!match) throw new Error(`${nome} não encontrado`);
  return Array.from(match[1].matchAll(/"([^"]+)"|(-?\d+)/g), ([, texto, numero]) => texto ?? Number(numero));
}

describe("listas iguais às da callable (functions/comercial)", () => {
  const autorizacao = read("functions/comercial/src/domain/autorizacao.ts");
  const events = read("functions/comercial/src/domain/events.ts");
  const demanda = read("functions/comercial/src/domain/demanda.ts");

  it("faixas de idade, avisos do prazo de perda e as etapas em que ele corre", () => {
    expect(listaDoBackend(autorizacao, "FAIXAS_DE_IDADE")).toEqual([...FAIXAS_DE_IDADE]);
    expect(listaDoBackend(autorizacao, "AVISOS_ANTES_DA_PERDA")).toEqual([...AVISOS_ANTES_DA_PERDA]);
    expect(listaDoBackend(autorizacao, "ETAPAS_COM_PRAZO_DE_PERDA")).toEqual([...ETAPAS_COM_PRAZO_DE_PERDA]);
  });

  it("tipos de autorização, marcas e os tipos que fazem a demanda esperar", () => {
    expect(listaDoBackend(events, "TIPOS_AUTORIZACAO_CLIENTE")).toEqual([...TIPOS_AUTORIZACAO_CLIENTE]);
    expect(listaDoBackend(events, "MARCAS_AUTORIZACAO")).toEqual([...MARCAS_AUTORIZACAO]);
    expect(listaDoBackend(demanda, "AUTORIZACOES_QUE_ESPERAM")).toEqual([...AUTORIZACOES_QUE_ESPERAM]);
  });

  it("o registro enviado só tem campos da entrada `record` (Registrar é .strict())", () => {
    const fonte = read("functions/comercial/src/domain/autorizacoes.ts");
    const bloco = /const Registrar = z\s*\.object\(\{([\s\S]*?)\n {2}\}\)\s*\.strict\(\)/.exec(fonte)?.[1] ?? "";
    const campos = Array.from(bloco.matchAll(/^ {4}(\w+)[:,]/gm), ([, campo]) => campo);
    expect(campos.length).toBeGreaterThan(10);
    const enviado = payloadRegistrar(
      form({ tomador: "11.222.333/0001-81", centroCusto: "41220", escopo: "Mudança", documentoNome: "Pedido.pdf", documentoReferencia: "https://x.test/p.pdf" }),
      linhasMarcadas(LINHAS, ["10045", "10047"]),
      "chave-1",
      HOJE,
    );
    expect(enviado.ok).toBe(true);
    const chaves = enviado.ok ? Object.keys(enviado.valor) : [];
    expect(chaves.filter((chave) => !campos.includes(chave))).toEqual([]);
    expect(chaves).toEqual(expect.arrayContaining(["action", "request_id", "customer_code", "tipo", "valor", "demandas", "recebida_em"]));
  });

  it("o cancelamento só tem os campos de `cancel`", () => {
    const fonte = read("functions/comercial/src/domain/autorizacoes.ts");
    const bloco = /const Cancelar = z\s*\.object\(\{([\s\S]*?)\n {2}\}\)\s*\.strict\(\)/.exec(fonte)?.[1] ?? "";
    const campos = Array.from(bloco.matchAll(/^ {4}(\w+)[:,]/gm), ([, campo]) => campo);
    const enviado = payloadCancelar("aut_abc", "Registrada por engano", "chave-2");
    expect(enviado.ok && Object.keys(enviado.valor).sort()).toEqual([...campos].sort());
  });
});

describe("demanda lida do Firestore", () => {
  it("o que a fila usa: cliente, contrato, RV validada, tipo e gerenciadora", () => {
    expect(demandaDoRegistro("10045", registro("10045"))).toMatchObject({
      numero: "10045",
      customerCode: ITAU,
      contratoId: "itau-2026",
      etapa: "aguardando_autorizacao",
      gerenciadora: "Gerenciadora A",
      validacao: { rv: 2, autorizacao: "pedido_aceite" },
    });
  });

  it("sem cliente, fica fora; o número vem do id quando falta", () => {
    expect(demandaDoRegistro("10045", { ...registro("10045"), customer_code: "" })).toBeNull();
    expect(demandaDoRegistro("10050", { ...registro("10050"), numero: undefined })?.numero).toBe("10050");
  });
});

describe("dias esperando a autorização (os mesmos casos de functions/comercial)", () => {
  const validada = demandaDoRegistro("10045", registro("10045", {
    executado_de: "2026-10-05",
    executado_ate: "2026-10-06",
    validacao: { rv: 1, etapa: "aguardando_autorizacao", autorizacao: "pedido_aceite", em: "2026-10-08T13:00:00.000Z" },
  }))!;

  it("conta do fim da execução, a data que a fila mostra", () => {
    expect(inicioDaEspera(validada)).toEqual({ data: "2026-10-06", desde: "execucao" });
    expect(diasEsperando(validada, "2026-10-21")).toBe(15);
    expect(diasEsperando(validada, "2026-10-06")).toBe(0);
  });

  it("sem o fim da execução, usa o início dela", () => {
    expect(inicioDaEspera({ ...validada, executadoAte: null })).toEqual({ data: "2026-10-05", desde: "execucao" });
  });

  it("sem a execução (o legado), conta da validação, no dia de São Paulo", () => {
    const legado = { ...validada, executadoDe: null, executadoAte: null, validacao: { ...validada.validacao!, em: "2026-10-09T02:30:00.000Z" } };
    expect(inicioDaEspera(legado)).toEqual({ data: "2026-10-08", desde: "validacao" });
    expect(diasEsperando(legado, "2026-10-21")).toBe(13);
  });

  it("a data mais antiga vale: validação antes do fim da execução conta da validação", () => {
    expect(inicioDaEspera({ ...validada, executadoAte: "2026-10-12" })).toEqual({ data: "2026-10-08", desde: "validacao" });
  });

  it("sem execução nem validação, ou com hoje inválido, null; hoje antes do início dá 0", () => {
    expect(diasEsperando({ ...validada, executadoDe: null, executadoAte: null, validacao: null }, HOJE)).toBeNull();
    expect(diasEsperando(validada, "21/10/2026")).toBeNull();
    expect(diasEsperando(validada, "2026-10-01")).toBe(0);
  });

  it("faixas: até 30, de 31 a 60, mais de 60", () => {
    const casos: Array<[number, string]> = [
      [0, "ate_30"],
      [30, "ate_30"],
      [31, "31_60"],
      [60, "31_60"],
      [61, "mais_60"],
    ];
    for (const [dias, faixa] of casos) expect(faixaDeIdade(dias), String(dias)).toBe(faixa);
  });
});

describe("prazo de perda (os mesmos casos de functions/comercial)", () => {
  const demanda = demandaDoRegistro("10045", registro("10045", { executado_ate: "2026-10-06" }))!;
  const em = (dias: number) => somarDias("2026-10-06", dias);

  it("no prazo de 90 dias, avisa aos 30, 60 e 80 dias", () => {
    expect(marcosDoPrazoDePerda(90)).toEqual([30, 60, 80]);
    expect(marcosDoPrazoDePerda(20)).toEqual([0, 10]);
    expect(marcosDoPrazoDePerda(5)).toEqual([0]);
  });

  it("antes dos 30 dias, nada; depois, o marco, os dias que faltam e o limite", () => {
    expect(alertaDePrazoDePerda(90, demanda, em(29))).toBeNull();
    const casos: Array<[number, number, number, boolean]> = [
      [30, 30, 60, false],
      [60, 60, 30, false],
      [80, 80, 10, false],
      [90, 80, 0, false],
      [91, 80, -1, true],
    ];
    for (const [dias, marco, restantes, vencido] of casos) {
      expect(alertaDePrazoDePerda(90, demanda, em(dias)), `dia ${dias}`).toEqual({
        prazo_dias: 90,
        dias,
        marco,
        restantes,
        limite: "2027-01-04",
        vencido,
        desde: "execucao",
      });
    }
  });

  it("a faturar também; fora dessas etapas ou sem prazo no contrato, não", () => {
    expect(alertaDePrazoDePerda(90, { ...demanda, etapa: "a_faturar" }, em(60))?.marco).toBe(60);
    expect(alertaDePrazoDePerda(90, { ...demanda, etapa: "perdida" }, em(85))).toBeNull();
    expect(alertaDePrazoDePerda(null, demanda, em(85))).toBeNull();
    expect(alertaDePrazoDePerda(0, demanda, em(85))).toBeNull();
  });
});

describe("fila de executados", () => {
  it("cada linha: RV validada, legado, título, referência, gerenciadora, execução, dias e valor", () => {
    expect(linha("10029")).toMatchObject({
      rotulo: "10029 – RV02",
      legado: "nº legado 9898",
      titulo: "Montagem de sala de treinamento",
      detalhe: "CE0029 · Gerenciadora A · executada 12/08",
      dias: 70,
      faixa: "mais_60",
      atrasada: true,
      valorCents: 2231000,
      cliente: "Itaú Unibanco",
      tipo: "pedido_aceite",
    });
    expect(linha("10045")).toMatchObject({ rotulo: "10045 – RV03", dias: 15, atrasada: false, valorCents: 1423680 });
    // Sem gerenciadora (o pedido veio direto do cliente): a linha não inventa uma.
    expect(linha("10044")).toMatchObject({ detalhe: "REQ 0001 · executada 25/09", cliente: "BTG Pactual", tipo: "portal" });
  });

  it("o badge fica vermelho só acima de 30 dias", () => {
    const atrasada = (dias: number) =>
      linhasDaFila([{ ...DEMANDAS[4], executadoAte: somarDias(HOJE, -dias) }], { nomes: NOMES, valores: VALORES, hoje: HOJE })[0].atrasada;
    expect([29, 30, 31].map(atrasada)).toEqual([false, false, true]);
  });

  it("valor ainda não lido fica null, e o total do grupo também", () => {
    const semValor = linhasDaFila(DEMANDAS, { nomes: NOMES, valores: new Map(), hoje: HOJE });
    expect(semValor.every((item) => item.valorCents === null)).toBe(true);
    expect(gruposDaFila(semValor, "todas").map((grupo) => grupo.totalCents)).toEqual([null, null]);
  });

  it("só a demanda que aguarda autorização entra; outro ano mostra o ano", () => {
    const aFaturar = demandaDoRegistro("10040", registro("10040", { etapa: "a_faturar", executado_ate: "2026-08-20" }))!;
    const antiga = demandaDoRegistro("10010", registro("10010", { executado_ate: "2025-12-20" }))!;
    const linhas = linhasDaFila([aFaturar, antiga], { nomes: NOMES, valores: VALORES, hoje: HOJE });
    expect(linhas.map((item) => item.numero)).toEqual(["10010"]);
    expect(linhas[0].detalhe).toContain("executada 20/12/2025");
  });

  it("agrupada por cliente, o mais antigo primeiro, com a contagem e o total do grupo", () => {
    const grupos = gruposDaFila(LINHAS, "todas");
    expect(grupos.map((grupo) => [grupo.cliente, grupo.linhas.map((item) => item.numero), grupo.totalCents])).toEqual([
      ["Itaú Unibanco", ["10029", "10031", "10036", "10042", "10045", "10047"], 7529970],
      ["BTG Pactual", ["10044"], 548000],
    ]);
  });

  it("filtro de idade: Todas, Até 30 dias, 31–60 e Mais de 60, com a contagem de cada um", () => {
    expect(FILTROS_DE_IDADE.map((filtro) => ROTULO_DO_FILTRO[filtro])).toEqual(["Todas", "Até 30 dias", "31–60 dias", "Mais de 60"]);
    expect(contarPorFaixa(LINHAS)).toEqual({ todas: 7, ate_30: 4, "31_60": 2, mais_60: 1 });
    const numeros = (filtro: (typeof FILTROS_DE_IDADE)[number]) =>
      gruposDaFila(LINHAS, filtro).map((grupo) => [grupo.cliente, grupo.linhas.map((item) => item.numero), grupo.totalCents]);
    expect(numeros("ate_30")).toEqual([
      ["Itaú Unibanco", ["10042", "10045", "10047"], 3062280],
      ["BTG Pactual", ["10044"], 548000],
    ]);
    expect(numeros("31_60")).toEqual([["Itaú Unibanco", ["10031", "10036"], 2236690]]);
    expect(numeros("mais_60")).toEqual([["Itaú Unibanco", ["10029"], 2231000]]);
  });

  it("a busca acha pela demanda, pelo legado, pela referência e pela gerenciadora, sem acento", () => {
    const busca = (termo: string) => gruposDaFila(LINHAS, "todas", termo).flatMap((grupo) => grupo.linhas.map((item) => item.numero));
    expect(busca("10045")).toEqual(["10045"]);
    expect(busca("9898")).toEqual(["10029"]);
    expect(busca("req 0001")).toEqual(["10044"]);
    expect(busca("gerenciadora b")).toEqual(["10031"]);
    expect(busca("itau")).toHaveLength(6);
    expect(contarPorFaixa(LINHAS, "itau")).toEqual({ todas: 6, ate_30: 3, "31_60": 2, mais_60: 1 });
  });
});

describe("marcar demandas para a autorização", () => {
  it("sem nada marcado, qualquer uma; depois, só do mesmo cliente, contrato e tipo", () => {
    expect(podeMarcar(linha("10044"), [])).toBe(true);
    const itau = linhasMarcadas(LINHAS, ["10045"]);
    expect(podeMarcar(linha("10047"), itau)).toBe(true);
    expect(podeMarcar(linha("10044"), itau)).toBe(false);
    const outroContrato = { ...linha("10047"), contratoId: "itau-2021" };
    expect(podeMarcar(outroContrato, itau)).toBe(false);
  });

  it("marca e desmarca; a marcação que não cabe é ignorada", () => {
    expect(alternarMarcacao([], linha("10045"), LINHAS)).toEqual(["10045"]);
    expect(alternarMarcacao(["10045"], linha("10047"), LINHAS)).toEqual(["10045", "10047"]);
    expect(alternarMarcacao(["10045", "10047"], linha("10045"), LINHAS)).toEqual(["10047"]);
    expect(alternarMarcacao(["10045"], linha("10044"), LINHAS)).toEqual(["10045"]);
  });

  it("as marcadas seguem a ordem da fila; a que saiu da fila sai da marcação", () => {
    expect(linhasMarcadas(LINHAS, ["10047", "10045", "99999"]).map((item) => item.numero)).toEqual(["10045", "10047"]);
  });

  it("a soma das RVs marcadas, em centavos; sem valor lido, null", () => {
    expect(somaDasLinhas(linhasMarcadas(LINHAS, ["10045", "10047"]))).toBe(2074880);
    expect(somaDasLinhas([])).toBe(0);
    expect(somaDasLinhas([{ ...linha("10045"), valorCents: null }])).toBeNull();
  });

  it("o tipo vem da validação: pedido e aceite, portal ou outro registro", () => {
    expect(tipoDasLinhas(linhasMarcadas(LINHAS, ["10045"]))).toBe("pedido_aceite");
    expect(tipoDasLinhas(linhasMarcadas(LINHAS, ["10044"]))).toBe("portal");
    expect(tipoDasLinhas([])).toBe("pedido_aceite");
    const legado = demandaDoRegistro("10001", registro("10001", { validacao: { rv: 0, etapa: "aguardando_autorizacao", autorizacao: null, em: "2026-10-01T12:00:00Z" } }))!;
    expect(tipoDasLinhas(linhasDaFila([legado], { nomes: NOMES, valores: VALORES, hoje: HOJE }))).toBe("outro");
    expect(rotulosDoTipo("pedido_aceite")).toEqual({ pedido: "Pedido", aceite: "Aceite", valor: "Valor do aceite (R$)" });
    expect(rotulosDoTipo("portal")).toEqual({ pedido: "Pedido do portal", aceite: null, valor: "Valor do pedido (R$)" });
    expect(rotulosDoTipo("outro")).toEqual({ pedido: "Pedido", aceite: "Aceite", valor: "Valor autorizado (R$)" });
  });
});

describe("valor do aceite e conferência com a soma das RVs", () => {
  it("o valor como a pessoa digita vira decimal com ponto, até 2 casas", () => {
    expect(valorDaTela("20.748,80")).toBe("20748.80");
    expect(valorDaTela("R$ 20.748,8")).toBe("20748.8");
    expect(valorDaTela("20748.80")).toBe("20748.80");
    expect(valorDaTela("1.234")).toBe("1234");
    expect(valorDaTela("1234")).toBe("1234");
    for (const invalido of ["", "abc", "1,234,5", "12,345", "-10,00", "0,001"]) expect(valorDaTela(invalido), invalido).toBeNull();
  });

  it("igual à soma: verde, \"Valor confere\"", () => {
    expect(conferenciaDoValor("20.748,80", 2074880)).toEqual({ tom: "ok", texto: "Valor confere com a soma das RVs" });
  });

  it("diferente: âmbar, \"Diverge em\" a diferença", () => {
    expect(conferenciaDoValor("20.000,00", 2074880)).toEqual({ tom: "diverge", texto: reais("Diverge em R$ 748,80") });
    expect(conferenciaDoValor("21.000", 2074880)).toEqual({ tom: "diverge", texto: reais("Diverge em R$ 251,20") });
  });

  it("sem valor, sem soma ou sem demanda marcada, nenhuma conferência", () => {
    expect(conferenciaDoValor("", 2074880)).toBeNull();
    expect(conferenciaDoValor("abc", 2074880)).toBeNull();
    expect(conferenciaDoValor("20.748,80", null)).toBeNull();
    expect(conferenciaDoValor("20.748,80", 0)).toBeNull();
  });
});

describe("painel: cliente, contrato e código de serviço", () => {
  it("o contrato da seleção: até quando vale e o código de serviço padrão", () => {
    expect(contratoDoPainel(CONTRATO_ITAU)).toEqual({ vigencia: "Contrato até 30/06/2027", codigoServico: "1602" });
    expect(contratoDoPainel(CONTRATO_BTG)).toEqual({ vigencia: "Contrato sem prazo", codigoServico: "" });
    expect(contratoDoPainel(null)).toEqual({ vigencia: "Sem contrato", codigoServico: "" });
  });

  it("formulário novo: recebida hoje, o resto vazio, código do contrato até alguém mudar", () => {
    expect(formNovaAutorizacao(HOJE)).toEqual({
      pedido: "",
      aceite: "",
      recebidaEm: HOJE,
      valor: "",
      tomador: "",
      centroCusto: "",
      codigoServico: null,
      escopo: "",
      documentoNome: "",
      documentoReferencia: "",
    });
  });
});

describe("entrada da recordAuthorization", () => {
  const marcadas = linhasMarcadas(LINHAS, ["10045", "10047"]);

  it("pedido e aceite: as demandas com a RV validada, o valor em decimal e o tipo do contrato", () => {
    const enviado = payloadRegistrar(form({ centroCusto: " 41220 ", escopo: "Mudança de andar" }), marcadas, "chave-1", HOJE);
    expect(enviado).toEqual({
      ok: true,
      valor: {
        action: "record",
        request_id: "chave-1",
        customer_code: ITAU,
        tipo: "pedido_aceite",
        pedido: "4500000001",
        aceite: "1000000001",
        recebida_em: HOJE,
        valor: "20748.80",
        demandas: [
          { numero: "10045", rv: 3 },
          { numero: "10047", rv: 2 },
        ],
        tomador_documento: null,
        codigo_servico: null,
        centro_custo: "41220",
        escopo: "Mudança de andar",
        documento: null,
      },
    });
  });

  it("código de serviço mudado vai; o padrão do contrato fica com o servidor", () => {
    const enviado = payloadRegistrar(form({ codigoServico: "1603" }), marcadas, "k", HOJE);
    expect(enviado.ok && enviado.valor.codigo_servico).toBe("1603");
    const invalido = payloadRegistrar(form({ codigoServico: "16" }), marcadas, "k", HOJE);
    expect(invalido).toEqual({ ok: false, problema: "Código de serviço: 3 a 5 algarismos (ex.: 1602)." });
  });

  it("portal: só o pedido do portal, sem aceite", () => {
    const enviado = payloadRegistrar(form({ pedido: "PO 0000001", aceite: "ignorado", valor: "5.480,00" }), linhasMarcadas(LINHAS, ["10044"]), "k", HOJE);
    expect(enviado.ok && [enviado.valor.tipo, enviado.valor.pedido, enviado.valor.aceite]).toEqual(["portal", "PO 0000001", null]);
  });

  it("o que a callable recusaria, a tela avisa antes", () => {
    const problema = (extra: Partial<FormAutorizacao>, linhas: LinhaDaFila[] = marcadas) => {
      const enviado = payloadRegistrar(form(extra), linhas, "k", HOJE);
      return enviado.ok ? null : enviado.problema;
    };
    expect(problema({}, [])).toBe("Marque ao menos uma demanda.");
    expect(problema({ pedido: " " })).toBe("Informe o pedido.");
    expect(problema({ aceite: "" })).toBe("Informe o aceite.");
    expect(problema({ pedido: "" }, linhasMarcadas(LINHAS, ["10044"]))).toBe("Informe o pedido do portal.");
    expect(problema({ pedido: "45#1" })).toBe("Pedido: letras, números, espaço, ponto, barra e hífen.");
    expect(problema({ valor: "" })).toBe("Informe o valor em reais (ex.: 20.748,80).");
    expect(problema({ valor: "0,00" })).toBe("O valor precisa ser maior que zero.");
    expect(problema({ recebidaEm: "2026-10-22" })).toBe("Recebida em não pode ser depois de hoje.");
    expect(problema({ recebidaEm: "" })).toBe("Informe quando a autorização chegou.");
    expect(problema({ documentoNome: "Pedido.pdf" })).toBe("Documento: informe o nome e onde está.");
  });

  it("outro registro (legado): sem o pedido, pede o documento como prova", () => {
    const legado = demandaDoRegistro("10001", registro("10001", { validacao: { rv: 0, etapa: "aguardando_autorizacao", autorizacao: null, em: "2026-10-01T12:00:00Z" } }))!;
    const linhas = linhasDaFila([legado], { nomes: NOMES, valores: VALORES, hoje: HOJE });
    const semProva = payloadRegistrar(form({ pedido: "", aceite: "" }), linhas, "k", HOJE);
    expect(semProva).toEqual({ ok: false, problema: "Registre a prova: o pedido ou o documento." });
    const comDocumento = payloadRegistrar(form({ pedido: "", aceite: "", documentoNome: "E-mail", documentoReferencia: "Pasta/autorizacao.msg" }), linhas, "k", HOJE);
    expect(comDocumento.ok && [comDocumento.valor.tipo, comDocumento.valor.pedido, comDocumento.valor.documento]).toEqual([
      "outro",
      null,
      { nome: "E-mail", referencia: "Pasta/autorizacao.msg" },
    ]);
    // A RV 0 vai como 0.
    expect(comDocumento.ok && comDocumento.valor.demandas).toEqual([{ numero: "10001", rv: 0 }]);
  });

  it("cancelar pede o motivo", () => {
    expect(payloadCancelar("aut_1", " ", "k")).toEqual({ ok: false, problema: "Diga por que a autorização é cancelada." });
    expect(payloadCancelar("aut_1", "Duplicada", "k")).toEqual({
      ok: true,
      valor: { action: "cancel", request_id: "k", autorizacao_id: "aut_1", motivo: "Duplicada" },
    });
  });

  it("depois de registrar: o pedido, as demandas e o valor", () => {
    expect(textoDoRegistro({ pedido: "4500000001", demandas: 2, valorCents: 2074880 })).toBe(reais("Pedido 4500000001 registrado · 2 demandas · R$ 20.748,80"));
    expect(textoDoRegistro({ pedido: null, demandas: 1, valorCents: 548000 })).toBe(reais("Autorização registrada · 1 demanda · R$ 5.480,00"));
  });
});

describe("autorizadas, a faturar", () => {
  const autorizacoes = [
    autorizacaoDoRegistro("aut_1", {
      customer_code: ITAU,
      contrato_id: "itau-2026",
      tipo: "pedido_aceite",
      pedido: "4500000001",
      aceite: "1000000001",
      recebida_em: "2026-10-14",
      valor_cents: 3120460,
      demandas: [
        { numero: "10033", rv: 2, rotulo: "10033 – RV02", valor_cents: 1500000 },
        { numero: "10035", rv: 2, rotulo: "10035 – RV02", valor_cents: 1620460 },
      ],
      centro_custo: "41220",
      marcas: [],
      status: "registrada",
      registrada_em: "2026-10-14T15:00:00.000Z",
      nf_ids: [],
    }),
    autorizacaoDoRegistro("aut_2", {
      customer_code: BTG,
      contrato_id: "btg-2026",
      tipo: "portal",
      pedido: "PO 0000001",
      aceite: null,
      recebida_em: "2026-10-19",
      valor_cents: 795000,
      demandas: [{ numero: "10040", rv: 2, rotulo: "10040 – RV02", valor_cents: 790000 }],
      centro_custo: null,
      marcas: ["valor_diverge"],
      status: "registrada",
      registrada_em: "2026-10-19T12:00:00.000Z",
      nf_ids: [],
    }),
    // Já usada numa NF (Fase 7): não está mais a faturar.
    autorizacaoDoRegistro("aut_3", {
      customer_code: ITAU,
      tipo: "pedido_aceite",
      pedido: "4500000002",
      aceite: "1000000002",
      recebida_em: "2026-10-01",
      valor_cents: 100000,
      demandas: [{ numero: "10020", rv: 1, rotulo: "10020 – RV01", valor_cents: 100000 }],
      status: "registrada",
      registrada_em: "2026-10-01T12:00:00.000Z",
      nf_ids: ["nf_1"],
    }),
    autorizacaoDoRegistro("aut_4", { customer_code: ITAU, tipo: "pedido_aceite", status: "cancelada", valor_cents: 1, demandas: [] }),
  ].filter((item): item is AutorizacaoRegistrada => item !== null);
  const aFaturar = demandaDoRegistro("10040", registro("10040", { customer_code: BTG, etapa: "a_faturar", executado_ate: "2026-08-20", autorizacao_ids: ["aut_2"] }))!;

  it("a mais recente primeiro, com pedido, aceite ou portal, cliente, demandas, marcas, valor e quando chegou", () => {
    const linhas = autorizadasAFaturar(autorizacoes, { nomes: NOMES, demandas: [aFaturar], contratos: CONTRATOS, hoje: HOJE });
    expect(linhas).toEqual([
      {
        id: "aut_2",
        pedido: "PO 0000001",
        sub: "Portal do fornecedor",
        cliente: "BTG Pactual",
        demandas: ["10040 – RV02"],
        marcas: ["Valor diverge"],
        info: "faturar até 18/11/2026",
        valorCents: 795000,
        quando: "autorizada 19/10",
      },
      {
        id: "aut_1",
        pedido: "4500000001",
        sub: "Aceite 1000000001",
        cliente: "Itaú Unibanco",
        demandas: ["10033 – RV02", "10035 – RV02"],
        marcas: [],
        info: "CC 41220",
        valorCents: 3120460,
        quando: "autorizada 14/10",
      },
    ]);
    expect(totalDasAutorizadas(linhas)).toBe(3915460);
  });

  it("a busca acha pelo pedido, pelo aceite e pela demanda", () => {
    const busca = (termo: string) =>
      autorizadasAFaturar(autorizacoes, { nomes: NOMES, demandas: [aFaturar], contratos: CONTRATOS, hoje: HOJE, busca: termo }).map(
        (item) => item.id,
      );
    expect(busca("1000000001")).toEqual(["aut_1"]);
    expect(busca("po 0000001")).toEqual(["aut_2"]);
    expect(busca("10035")).toEqual(["aut_1"]);
    expect(busca("btg")).toEqual(["aut_2"]);
  });
});

describe("itens do Início", () => {
  const aFaturar = demandaDoRegistro("10040", registro("10040", { customer_code: BTG, etapa: "a_faturar", executado_ate: "2026-08-20", autorizacao_ids: ["aut_2"] }))!;
  const vencida = demandaDoRegistro("10041", registro("10041", { customer_code: BTG, executado_ate: "2026-07-01" }))!;

  it("os executados esperando há mais de 30 dias, o mais antigo primeiro", () => {
    const pendencias = autorizacoesParaOInicio(DEMANDAS, CONTRATOS, NOMES, HOJE);
    expect(pendencias.esperandoMaisDe30).toEqual([
      { numero: "10029", rotulo: "10029 – RV02", cliente: "Itaú Unibanco", dias: 70 },
      { numero: "10031", rotulo: "10031 – RV02", cliente: "Itaú Unibanco", dias: 49 },
      { numero: "10036", rotulo: "10036 – RV02", cliente: "Itaú Unibanco", dias: 36 },
    ]);
  });

  it("o prazo de perda: só no contrato com prazo, aguardando ou a faturar, o mais próximo primeiro", () => {
    const pendencias = autorizacoesParaOInicio([...DEMANDAS, aFaturar, vencida], CONTRATOS, NOMES, HOJE);
    expect(pendencias.prazos).toEqual([
      // Executada em 01/07: 112 dias, venceu em 29/09.
      { numero: "10041", rotulo: "10041 – RV02", cliente: "BTG Pactual", limite: "2026-09-29", restantes: -22, vencido: true, critico: true },
      { numero: "10040", rotulo: "10040 – RV02", cliente: "BTG Pactual", limite: "2026-11-18", restantes: 28, vencido: false, critico: false },
    ]);
    // A 10044 (BTG, 26 dias) ainda não chegou ao primeiro aviso; o Itaú não tem prazo.
    expect(pendencias.prazos.map((item) => item.numero)).not.toContain("10044");
  });

  it("no último aviso (10 dias antes do fim), crítico", () => {
    const perto = demandaDoRegistro("10043", registro("10043", { customer_code: BTG, executado_ate: somarDias(HOJE, -82) }))!;
    expect(autorizacoesParaOInicio([perto], CONTRATOS, NOMES, HOJE).prazos[0]).toMatchObject({ restantes: 8, critico: true });
  });
});
