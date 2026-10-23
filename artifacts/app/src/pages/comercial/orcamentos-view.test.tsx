import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Router } from "wouter";

import { contratoDoDocumento, type ContratoResumo } from "@/lib/comercial/clientes";
import { acoesDepoisDoEnvio } from "@/lib/comercial/depois-do-envio";
import { itemDaFila, type ItemDaFila } from "@/lib/comercial/orcamentos";
import { violacoesDeAcessibilidade } from "@/test/acessibilidade";

import { FilaView, LinhaDaFila, type ContextoDaFila, type FilaViewProps } from "./orcamentos-view";

/**
 * Fila de orçamentos (docs/mockups/ComFila.dc.html), só a apresentação: sem
 * legenda (rótulos, dados e ações), uma ação principal, cores das etapas e a
 * ficha resumida, que no celular abre no lugar da fila.
 */

const AGORA = new Date("2026-10-21T13:00:00.000Z");

type Registro = Record<string, unknown>;

function linha(origem: string, total: number): Registro {
  return { id: `ln_${origem}_${total}`, origem, total_cents: total };
}

function item(numero: string, demanda: Registro, quote: Registro): ItemDaFila {
  return itemDaFila(
    numero,
    {
      numero,
      customer_code: "ITAU-UNIBANCO",
      customer_name: "Itaú Unibanco",
      contrato_id: "ct-itau",
      canal: "email",
      titulo: null,
      ref_cliente: null,
      solicitante: null,
      recebida_em: "2026-10-20T11:47:00.000Z",
      origem: null,
      destino: null,
      etapa: "em_montagem",
      etapa_desde: "2026-10-20T12:00:00.000Z",
      marcos: [],
      numero_legado: null,
      perda: null,
      ...demanda,
    },
    {
      numero,
      rotulo: numero,
      rv: 0,
      tipo_rv: "proposta",
      status: "rascunho",
      edicao: 1,
      data_base: "2026-10-20",
      tabela: { id: "pt_itau_com", nome: "LPU Itaú v2.0", variante: "Comercial" },
      linhas: [],
      total_cents: 0,
      autor_uid: "u-gui",
      aprovacao: null,
      devolucao: null,
      ...quote,
    },
  )!;
}

const ITENS: ItemDaFila[] = [
  item(
    "10052",
    {
      titulo: "Mudança de 32 estações",
      ref_cliente: "CE9012",
      solicitante: { contato_id: "ct_marina", empresa: "Souza & Lopes" },
      origem: { local_id: "loc_os", complemento: null },
      destino: { local_id: "loc_conc", complemento: null },
    },
    { linhas: [linha("tabela", 1_468_000), linha("alterado", 124_000)], total_cents: 1_592_000 },
  ),
  item(
    "10053",
    {
      customer_code: "GRUPO-SBF",
      customer_name: "Grupo SBF",
      contrato_id: null,
      titulo: "Transferência do escritório de Pinheiros",
      etapa_desde: "2026-10-21T11:15:00.000Z",
    },
    { tabela: { id: "pt_padrao", nome: "Tabela Dutelog 2026", variante: "Comercial" }, linhas: [linha("tabela", 742_000)], total_cents: 742_000 },
  ),
  item(
    "10045",
    {
      titulo: "Mudança do 4º e 5º andares",
      ref_cliente: "CE8977",
      numero_legado: "105-221",
      solicitante: { contato_id: "ct_paula", empresa: "Hass & Megale" },
      origem: { local_id: "loc_conc", complemento: null },
      etapa: "para_aprovar",
      etapa_desde: "2026-10-21T12:20:00.000Z",
      marcos: [
        { etapa: "em_montagem", em: "2026-10-20T21:10:00.000Z", por_uid: "u-gui" },
        { etapa: "para_aprovar", em: "2026-10-21T12:05:00.000Z", por_uid: "u-gui" },
      ],
    },
    {
      rotulo: "10045 – RV02",
      rv: 2,
      tipo_rv: "aditivo",
      status: "para_aprovar",
      data_base: "2026-10-14",
      linhas: [linha("tabela", 300_000), linha("tabela", 248_000), linha("alterado", 82_000), linha("avulso", 26_000), linha("ajuste", -42_000)],
      total_cents: 614_000,
    },
  ),
];

const CONTRATO = contratoDoDocumento("ct-itau", {
  customer_code: "ITAU-UNIBANCO",
  nome: "Contrato Itaú",
  vigente_de: "2025-07-01",
  vigente_ate: "2027-06-30",
  status: "vigente",
}) as ContratoResumo;

const NOMES: Record<string, string> = { "u-gui": "Guilherme", "u-leo": "Leonardo" };

const CONTEXTO: ContextoDaFila = {
  prospects: new Set(["GRUPO-SBF"]),
  contatos: new Map([
    ["ct_marina", { nome: "Marina Teixeira", empresa: "Souza & Lopes" }],
    ["ct_paula", { nome: "Paula Nogueira", empresa: "Hass & Megale" }],
  ]),
  locais: new Map([
    ["loc_os", "CEIC – Torre Olavo Setubal"],
    ["loc_conc", "CEIC – Torre Conceição"],
  ]),
  contratos: new Map([["ct-itau", CONTRATO]]),
  nomeDe: (uid) => (uid ? (NOMES[uid] ?? null) : null),
};

const noop = () => undefined;

function props(overrides: Partial<FilaViewProps> = {}): FilaViewProps {
  return {
    estado: "pronto",
    itens: ITENS,
    agora: AGORA,
    segmento: "todas",
    onSegmento: noop,
    busca: "",
    onBusca: noop,
    selecionado: ITENS[2],
    onSelecionar: noop,
    fichaAberta: false,
    onVoltar: noop,
    contexto: CONTEXTO,
    onNovo: noop,
    onOrcarExecucao: noop,
    onAbrir: noop,
    envio: { acao: null, ocupado: false, erro: null, onEnviar: noop },
    depois: { acoes: { principal: null, secundarias: [] }, ocupado: false, aviso: null, onAcao: noop },
    ...overrides,
  };
}

function render(overrides: Partial<FilaViewProps> = {}) {
  return renderToStaticMarkup(
    <Router ssrPath="/comercial">
      <FilaView {...props(overrides)} />
    </Router>,
  );
}

/** Textos visíveis, na ordem: o que a pessoa lê na tela. */
function texts(html: string) {
  return html
    .replace(/<span class="sr-only">[^<]*<\/span>/g, "")
    .split(/<[^>]+>/)
    .map((text) => text.replace(/&amp;/g, "&").replace(/ /g, " ").trim())
    .filter(Boolean);
}

const CABECALHO = [
  "Orçamentos",
  "Orçar execução",
  "Novo orçamento",
  "Todas",
  "3",
  "Em montagem",
  "2",
  "Para aprovar",
  "1",
  "Para enviar",
  "0",
  "Aguardando cliente",
  "0",
  "Para planejar",
  "0",
  "Execução a orçar",
  "0",
  "Aguardando autorização",
  "0",
  "A faturar",
  "0",
  "Perdidas",
  "0",
];

const GRUPOS = [
  "Em montagem",
  "2",
  "10052",
  "Proposta",
  "Itaú Unibanco",
  "Mudança de 32 estações",
  "CE9012 · CEIC – Torre Olavo Setubal → CEIC – Torre Conceição",
  "Marina Teixeira · Souza & Lopes",
  "R$ 15.920,00",
  "Em montagem",
  "1 dia",
  "10053",
  "Proposta",
  "Grupo SBF",
  "Prospect",
  "Transferência do escritório de Pinheiros",
  "R$ 7.420,00",
  "Em montagem",
  "hoje",
  "Para aprovar",
  "1",
  "10045 – RV02",
  "Aditivo",
  "nº legado 105-221",
  "Itaú Unibanco",
  "Mudança do 4º e 5º andares",
  "CE8977 · CEIC – Torre Conceição",
  "Paula Nogueira · Hass & Megale",
  "R$ 6.140,00",
  "Para aprovar",
  "40 min",
];

const FICHA = [
  "Voltar",
  "10045 – RV02",
  "Aditivo",
  "Para aprovar",
  "Mudança do 4º e 5º andares",
  "nº legado 105-221",
  "Cliente",
  "Itaú Unibanco",
  "Local",
  "CEIC – Torre Conceição",
  "Para",
  "Paula Nogueira · Hass & Megale",
  "Referência",
  "CE8977",
  "Contrato",
  "Contrato Itaú · até 30/06/2027",
  "Tabela",
  "LPU Itaú v2.0 · Comercial",
  "Data-base",
  "14/10/2026",
  "Linhas",
  "Tabela",
  "2 linhas",
  "R$ 5.480,00",
  "Alterado",
  "1 linha",
  "R$ 820,00",
  "Avulso",
  "1 linha",
  "R$ 260,00",
  "Ajuste",
  "1 linha",
  "-R$ 420,00",
  "Total",
  "R$ 6.140,00",
  "Histórico",
  "Recebido",
  "20/10 08:47 · e-mail de Paula Nogueira",
  "Montado",
  "21/10 09:05 · Guilherme · RV02",
  "Aprovado",
  "pendente",
  "Enviado",
  "pendente",
  "Abrir orçamento",
  "Prévia do PDF",
];

describe("fila de orçamentos", () => {
  it("sem legenda: cabeçalho, segmentos, grupos e ficha só têm rótulos, dados e ações", () => {
    expect(texts(render())).toEqual([...CABECALHO, ...GRUPOS, ...FICHA]);
  });

  it("identidade v3 dentro do layout do app, e uma ação principal só (Novo orçamento)", () => {
    const html = render();
    expect(html).toMatch(/^<div class="v3 /);
    expect(html.match(/bg-primary text-primary-foreground/g)).toHaveLength(1);
    expect(html).toMatch(/bg-primary text-primary-foreground[^"]*"[^>]*>(?:<svg[^>]*>.*?<\/svg>)?Novo orçamento<\/button>/);
    expect(html).toContain('aria-label="Buscar orçamento"');
    expect(html).toContain('placeholder="Número, nº legado, cliente, referência ou título"');
  });

  it("segmento escolhido fica marcado e só o grupo dele aparece", () => {
    const html = render({ segmento: "para_aprovar" });
    expect(html).toMatch(/<button[^>]*aria-pressed="true"[^>]*>.*?Para aprovar/);
    const grupos = Array.from(html.matchAll(/<section aria-label="([^"]+)" class="overflow-hidden/g), ([, rotulo]) => rotulo);
    expect(grupos).toEqual(["Para aprovar"]);
  });

  it("a linha mostra a cor da etapa do mockup, por token do tema", () => {
    const html = render();
    expect(html).toContain("bg-amber-soft text-amber-soft-foreground");
    expect(html).toContain("bg-muted text-foreground");
  });

  it("clique seleciona a linha; duplo clique abre o orçamento", () => {
    const abertos: string[] = [];
    const selecionados: string[] = [];
    const linha = LinhaDaFila({
      item: ITENS[0],
      ativo: false,
      agora: AGORA,
      contexto: CONTEXTO,
      onSelecionar: (numero) => selecionados.push(numero),
      onAbrir: (numero) => abertos.push(numero),
    });
    linha.props.onClick();
    expect(selecionados).toEqual([ITENS[0].numero]);
    expect(abertos).toEqual([]);
    linha.props.onDoubleClick();
    expect(abertos).toEqual([ITENS[0].numero]);
  });

  it("a ficha leva à montagem do orçamento", () => {
    const html = render();
    expect(html).toContain('href="/comercial/orcamento?numero=10045"');
    const montagem = texts(render({ selecionado: ITENS[0] }));
    expect(montagem.slice(-2)).toEqual(["Continuar montagem", "Prévia do PDF"]);
  });

  it("a ficha abre o documento da RV em curso: a prévia até o envio; o PDF depois", () => {
    expect(render()).toContain('href="/comercial/orcamento/documento?numero=10045&amp;rv=2"');
    const enviado = item("10041", { etapa: "aguardando_cliente" }, { status: "enviado", rv: 0 });
    const lista = texts(render({ itens: [enviado], selecionado: enviado }));
    expect(lista.slice(-2)).toEqual(["Abrir orçamento", "PDF"]);
  });

  it("a ficha oferece o envio ao cliente que a fila decidiu, sem virar a ação principal", () => {
    const enviados: Array<[string, string]> = [];
    const aprovado = item("10048", { etapa: "para_enviar" }, { status: "aprovado" });
    const html = render({
      itens: [aprovado],
      selecionado: aprovado,
      envio: { acao: "send", ocupado: false, erro: null, onEnviar: (orc, acao) => enviados.push([orc.numero, acao]) },
    });
    expect(texts(html).slice(-3)).toEqual(["Enviar ao cliente", "Abrir orçamento", "Prévia do PDF"]);
    expect(html.match(/bg-primary text-primary-foreground/g)).toHaveLength(1);
    // Enviando: o botão não responde; a recusa do servidor aparece em alerta na ficha.
    const enviando = render({ selecionado: aprovado, itens: [aprovado], envio: { acao: "send", ocupado: true, erro: null, onEnviar: noop } });
    expect(enviando).toMatch(/<button[^>]*disabled=""[^>]*>(?:<svg[^>]*>.*?<\/svg>)?Enviar ao cliente<\/button>/);
    const recusado = render({
      selecionado: aprovado,
      itens: [aprovado],
      envio: { acao: "send", ocupado: false, erro: "O orçamento 10048 mudou: está em rascunho, não aprovado. Abra de novo.", onEnviar: noop },
    });
    expect(recusado).toMatch(/role="alert"[^>]*>O orçamento 10048 mudou/);
  });

  it("no celular, a fila abre a ficha no lugar da lista; no computador, ficam lado a lado", () => {
    const fechada = render();
    expect(fechada).toMatch(/<section aria-label="Orçamentos" class="[^"]*\bflex\b[^"]*"/);
    expect(fechada).toMatch(/<aside aria-label="Orçamento selecionado" class="[^"]*\bhidden lg:flex\b/);
    const aberta = render({ fichaAberta: true });
    expect(aberta).toMatch(/<section aria-label="Orçamentos" class="[^"]*\bhidden lg:flex\b/);
    expect(aberta).not.toMatch(/<aside aria-label="Orçamento selecionado" class="[^"]* hidden lg:flex/);
    expect(aberta).toMatch(/<div class="[^"]*lg:hidden[^"]*"><button[^>]*>.*?Voltar/);
  });

  it("vazio, carregando e erro não se confundem", () => {
    expect(texts(render({ itens: [], selecionado: null })).slice(CABECALHO.length)).toEqual(["Nenhum orçamento"]);
    expect(texts(render({ busca: "zzz", selecionado: null })).slice(CABECALHO.length)).toEqual(["Nenhum orçamento"]);
    expect(texts(render({ estado: "carregando", itens: [], selecionado: null })).slice(CABECALHO.length)).toEqual(["Carregando..."]);
    expect(texts(render({ estado: "erro", itens: [], selecionado: null })).slice(CABECALHO.length)).toEqual([
      "Não foi possível carregar os orçamentos.",
    ]);
  });

  it("a busca filtra a lista e as contagens continuam as da fila inteira", () => {
    const lista = texts(render({ busca: "sbf", selecionado: null }));
    expect(lista.slice(0, CABECALHO.length)).toEqual(CABECALHO);
    expect(lista.slice(CABECALHO.length)).toEqual(["Em montagem", "1", "10053", "Proposta", "Grupo SBF", "Prospect", "Transferência do escritório de Pinheiros", "R$ 7.420,00", "Em montagem", "hoje"]);
  });

  it("perdida mostra o motivo; devolvido mostra a nota", () => {
    const perdida = item("10034", { etapa: "perdida", etapa_desde: "2026-10-08T12:20:00.000Z", perda: { motivo: "Preço · fechou com outro fornecedor", em: "2026-10-08T12:20:00.000Z" } }, {});
    const comPerda = texts(render({ itens: [perdida], selecionado: perdida }));
    expect(comPerda.slice(-5)).toEqual(["08/10 09:20", "Motivo", "Preço · fechou com outro fornecedor", "Abrir orçamento", "Prévia do PDF"]);
    const devolvido = item("10050", {}, { devolucao: { nota: "Rever o preço da cadeira", por_uid: "u-leo", em: "2026-10-21T12:30:00.000Z" } });
    const comNota = texts(render({ itens: [devolvido], selecionado: devolvido }));
    expect(comNota).toEqual(expect.arrayContaining(["Devolvido", "21/10 09:30 · Leonardo", "Devolução", "Rever o preço da cadeira"]));
  });

  it("Orçar execução é secundária ao Novo orçamento: vem antes, em contorno, e abre a demanda direta", () => {
    const html = render();
    expect(html).toMatch(/<button[^>]*border border-border bg-card[^>]*>(?:<svg[^>]*>.*?<\/svg>)?Orçar execução<\/button>/);
    expect(html.indexOf("Orçar execução")).toBeLessThan(html.indexOf("Novo orçamento"));
    expect(html.match(/bg-primary text-primary-foreground/g)).toHaveLength(1);
  });
});

describe("a ficha depois do envio (parte 12b)", () => {
  const contexto = { role: "comercial", uid: "u-gui" };

  function comAcoes(it: ItemDaFila, extra: Partial<FilaViewProps["depois"]> = {}) {
    return render({
      itens: [it],
      selecionado: it,
      depois: { acoes: acoesDepoisDoEnvio(it, contexto), ocupado: false, aviso: null, onAcao: noop, ...extra },
    });
  }

  const enviada = (numero: string, demanda: Registro, quote: Registro = {}) =>
    item(numero, demanda, { status: "enviado", ...quote });

  it("aguardando cliente, proposta: Fechado, Revisar e Perdido antes do link do orçamento", () => {
    const proposta = enviada("10041", { etapa: "aguardando_cliente" });
    expect(texts(comAcoes(proposta)).slice(-5)).toEqual(["Fechado", "Revisar", "Perdido", "Abrir orçamento", "PDF"]);
  });

  it("aguardando cliente, RV de execução e aditivo: Validado; só o aditivo se recusa", () => {
    const execucao = enviada("10042", { etapa: "aguardando_cliente" }, { rv: 2, tipo_rv: "execucao" });
    expect(texts(comAcoes(execucao)).slice(-4)).toEqual(["Validado", "Revisar", "Abrir orçamento", "PDF"]);
    const aditivo = enviada("10043", { etapa: "aguardando_cliente" }, { rv: 1, tipo_rv: "aditivo" });
    expect(texts(comAcoes(aditivo)).slice(-5)).toEqual(["Validado", "Recusar aditivo", "Revisar", "Abrir orçamento", "PDF"]);
  });

  it("para planejar, execução a orçar e perdida", () => {
    const planejar = enviada("10044", { etapa: "para_planejar" });
    expect(texts(comAcoes(planejar)).slice(-5)).toEqual(["Registrar execução", "Aditivo", "Perdido", "Abrir orçamento", "PDF"]);
    const orcar = enviada("10046", { etapa: "execucao_a_orcar" });
    expect(texts(comAcoes(orcar)).slice(-4)).toEqual(["Orçar execução", "Validado", "Abrir orçamento", "PDF"]);
    const perdida = enviada("10047", { etapa: "perdida", perda: { motivo: "preco", em: "2026-10-08T12:20:00.000Z" } });
    expect(texts(comAcoes(perdida)).slice(-3)).toEqual(["Reabrir", "Abrir orçamento", "PDF"]);
  });

  it("rascunho de RV seguinte: Descartar RV e Continuar montagem; a RV de execução em rascunho também continua a montagem", () => {
    const seguinte = item("10048", { etapa: "em_montagem" }, { rv: 1, revisao_de: { rv: 0, edicao: 3, motivo: "correcao" } });
    expect(texts(comAcoes(seguinte)).slice(-4)).toEqual(["Descartar RV", "Perdido", "Continuar montagem", "Prévia do PDF"]);
    const execucao = item("10049", { etapa: "execucao_a_orcar" }, { rv: 2, tipo_rv: "execucao", revisao_de: { rv: 1, edicao: 5, motivo: "execucao" } });
    expect(texts(comAcoes(execucao)).slice(-4)).toEqual(["Descartar RV", "Perdido", "Continuar montagem", "Prévia do PDF"]);
  });

  it("nenhum botão da etapa é a ação principal da tela: só Novo orçamento é", () => {
    const html = comAcoes(enviada("10041", { etapa: "aguardando_cliente" }));
    expect(html.match(/bg-primary text-primary-foreground/g)).toHaveLength(1);
  });

  it("ocupado trava os botões; a recusa de concorrência aparece em alerta", () => {
    const planejar = enviada("10044", { etapa: "para_planejar" });
    const ficha = comAcoes(planejar);
    expect(ficha).toMatch(/<button[^>]*type="button"[^>]*>(?:<svg[^>]*>.*?<\/svg>)?Registrar execução<\/button>/);
    const ocupado = comAcoes(planejar, { ocupado: true });
    expect(ocupado).toMatch(/<button[^>]*disabled=""[^>]*>(?:<svg[^>]*>.*?<\/svg>)?Registrar execução<\/button>/);
    const recusado = comAcoes(planejar, { aviso: "A demanda 10044 mudou: está aguardando o cliente, na 10044. Abra de novo. O orçamento foi recarregado." });
    expect(recusado).toMatch(/role="alert"[^>]*>A demanda 10044 mudou/);
  });

  it("sem ação para a etapa (papel sem o Comercial, faturamento): a ficha fica como estava", () => {
    const faturar = enviada("10050", { etapa: "aguardando_autorizacao" });
    expect(texts(comAcoes(faturar)).slice(-2)).toEqual(["Abrir orçamento", "PDF"]);
    const sem = render({
      itens: [item("10041", { etapa: "aguardando_cliente" }, { status: "enviado" })],
      selecionado: item("10041", { etapa: "aguardando_cliente" }, { status: "enviado" }),
    });
    expect(texts(sem).slice(-2)).toEqual(["Abrir orçamento", "PDF"]);
  });

  it("a direta que a Operação executou, ainda sem orçamento: só Orçar execução, sem linhas, total nem PDF (parte 3.10d)", async () => {
    const daOperacao = itemDaFila(
      "10301",
      {
        numero: "10301",
        customer_code: "ITAU-UNIBANCO",
        customer_name: "Itaú Unibanco",
        contrato_id: null,
        entrada: "direta",
        aberta_pela: "operacao",
        canal: "telefone",
        titulo: "Retirada de mobiliário",
        solicitante: null,
        etapa: "execucao_a_orcar",
        etapa_desde: "2026-10-21T10:00:00.000Z",
        marcos: [{ etapa: "execucao_a_orcar", em: "2026-10-21T10:00:00.000Z", por_uid: "u-coord" }],
        executado_de: "2026-10-20",
      },
      null,
    )!;
    const html = comAcoes(daOperacao);
    const lidos = texts(html);
    expect(lidos).toContain("Sem orçamento");
    expect(lidos).not.toContain("Linhas");
    expect(lidos).not.toContain("Total");
    expect(lidos.at(-1)).toBe("Orçar execução");
    expect(lidos).not.toContain("Abrir orçamento");
    expect(lidos).not.toContain("Prévia do PDF");
    // O número não leva a uma montagem que ainda não existe.
    expect(html).not.toMatch(/href="[^"]*numero=10301/);
    expect(await violacoesDeAcessibilidade(html)).toEqual([]);
  });
});
