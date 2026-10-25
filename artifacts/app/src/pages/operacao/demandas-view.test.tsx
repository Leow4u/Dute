import { JSDOM } from "jsdom";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Router } from "wouter";

import { SEM_FILTRO_DE_DEMANDAS, type DemandaDaOperacao, type LinhaDeDemanda } from "@/lib/operacao/demandas";
import type { OsDaFila } from "@/lib/operacao/fila";
import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { textosDaTela, textosForaDaLista } from "@/test/textos";

import { DemandaView } from "./demanda-view";
import { DemandasView, osComRotulo } from "./demandas-view";

/** Operação › Demandas e Demanda (parte 3.5b; docs/mockups/OpDemandas.dc.html e OpDemanda.dc.html). */

const noop = () => undefined;

const DIRETA: DemandaDaOperacao = {
  numero: "10053",
  customerCode: "ITAU",
  titulo: "Troca de cadeiras",
  tipo: "paraquedas",
  entrada: "direta",
  etapa: "para_planejar",
  executarAte: "2026-10-23T22:00:00.000Z",
  osNumeros: ["10053-01"],
  escopo: [{ id: "ln_1", item: "Cadeira Flexform", quantidade: "40", unidade: "UN" }],
  fora: null,
  visitaTecnica: null,
  escopoRv: null,
  recebidaEm: "2026-10-23T16:05:00.000Z",
  canal: "whatsapp",
  pedidoPor: { nome: "Renata Campos", telefone: "11987654321" },
  origem: { localId: "loc_faria", complemento: "5º andar" },
  destino: null,
};

const LINHAS: LinhaDeDemanda[] = [
  { demanda: DIRETA, cliente: "Itaú Unibanco", etapa: "para_agendar", os: "1 · para agendar", proximo: null, prazo: { texto: "Hoje até 19:00", falta: "faltam 4h40", atrasada: false } },
  {
    demanda: { ...DIRETA, numero: "10043", tipo: "planejada", entrada: "comercial", titulo: "Instalação de 40 lockers", executarAte: null },
    cliente: "Banco Safra",
    etapa: "para_planejar",
    os: "Nenhuma",
    proximo: "Planejar OS",
    prazo: null,
  },
];

function lista(extra: Partial<Parameters<typeof DemandasView>[0]> = {}) {
  return renderToStaticMarkup(
    <Router ssrPath="/operacao/demandas">
      <DemandasView
        estado="pronto"
        resumo="Sexta, 23 de outubro · 14:20 · 2 demandas"
        linhas={LINHAS}
        filtros={SEM_FILTRO_DE_DEMANDAS}
        clientes={[{ valor: "ITAU", rotulo: "Itaú Unibanco" }]}
        busca=""
        onBusca={noop}
        onFiltros={noop}
        {...extra}
      />
    </Router>,
  );
}

describe("Demandas", () => {
  it("lista número, título, cliente, tipo, entrada, etapa, OS e o próximo passo, com o link da ficha", () => {
    const html = lista();
    const textos = textosDaTela(html);
    for (const texto of ["Demandas", "Sexta, 23 de outubro · 14:20 · 2 demandas", "10053", "Troca de cadeiras", "Itaú Unibanco", "Paraquedas", "Direta", "Para agendar", "1 · para agendar", "Hoje até 19:00 · faltam 4h40", "Planejar OS", "Todas as etapas"]) {
      expect(textos, texto).toContain(texto);
    }
    expect(html).toContain('href="/operacao/demanda?numero=10053"');
    expect(html).not.toContain("R$");
  });

  it("sem legenda: só rótulos, dados e ações", () => {
    expect(
      textosForaDaLista(lista(), [
        "Demandas",
        "Sexta, 23 de outubro · 14:20 · 2 demandas",
        "Buscar demanda, OS ou cliente",
        "Nova demanda",
        /^(Tipo|Entrada|Cliente|Etapa)$/,
        /^(Todos os tipos|Todas as entradas|Todos os clientes|Todas as etapas)$/,
        /^(Paraquedas|Emergencial|Planejada|Comercial|Direta|Armazenagem|Itaú Unibanco|Banco Safra)$/,
        /^(No comercial|Aguardando cliente|Para planejar|Para agendar|Agendada|Em execução|Em revisão|Execução a orçar|A faturar|Faturada|Paga|Perdida|Cancelada)$/,
        /^(Demanda|OS|Próximo)$/,
        /^\d{5}$/,
        /^(Troca de cadeiras|Instalação de 40 lockers)$/,
        /^(1 · para agendar|Nenhuma|Nenhuma OS|1 OS · para agendar|—)$/,
        /^(Comercial|Direta) · (Nenhuma OS|1 OS · para agendar)$/,
        /^(Hoje até 19:00 · faltam 4h40|Planejar OS)$/,
      ]),
    ).toEqual([]);
  });

  it("vazio, carregando e erro", () => {
    expect(textosDaTela(lista({ linhas: [] }))).toContain("Nenhuma demanda");
    expect(textosDaTela(lista({ estado: "carregando" }))).toContain("Carregando");
    expect(textosDaTela(lista({ estado: "erro" }))).toContain("Não foi possível carregar as demandas.");
  });

  it("a entrega do WMS (a direta do canal wms) diz Armazenagem na tabela e no cartão", () => {
    const entrega: LinhaDeDemanda = { ...LINHAS[0], demanda: { ...DIRETA, numero: "10060", titulo: "Entrega do pedido PED-0118", canal: "wms" } };
    const dom = new JSDOM(`<!doctype html><body>${lista({ linhas: [entrega] })}</body>`);
    const { document } = dom.window;
    expect(document.querySelector("tbody tr td:nth-child(4)")?.textContent).toBe("Armazenagem");
    expect(document.querySelector("li")?.textContent).toContain("Armazenagem · 1 OS · para agendar");
    dom.window.close();
  });

  it("o resumo das OS fora da tabela diz OS", () => {
    expect(osComRotulo("Nenhuma")).toBe("Nenhuma OS");
    expect(osComRotulo("3 · 1 em execução")).toBe("3 OS · 1 em execução");
  });

  it("não tem problema de acessibilidade", async () => {
    expect(await violacoesDeAcessibilidade(lista())).toEqual([]);
  });
});

const ABERTA: OsDaFila = {
  numero: "10053-01",
  demanda: "10053",
  customer_code: "ITAU",
  status: "agendada",
  edicao: 2,
  itens: [{ id: "ln_1", item: "Cadeira Flexform", quantidade: "25" }],
  agenda: { data: "2026-10-23", hora: "15:00", fim: "19:00", equipe: ["col_lf"], veiculos: [] },
  pessoas: [{ id: "col_lf", nome: "Lucas Ferreira", papel: "montador" }],
  placas: [],
  servicos: ["transporte"],
  rota: "Agência Rebouças → Faria Lima",
};

function ficha(extra: Partial<Parameters<typeof DemandaView>[0]> = {}) {
  return renderToStaticMarkup(
    <Router ssrPath="/operacao/demanda">
      <DemandaView
        estado="pronto"
        numero="10053"
        demanda={DIRETA}
        cliente="Itaú Unibanco"
        etapa="agendada"
        escopo={[{ id: "ln_1", item: "Cadeira Flexform", unidade: "UN", escopo: "40", nasOs: "25", osNumeros: ["10053-01"], saldo: "15" }]}
        ordens={[ABERTA]}
        linhasComSaldo={1}
        locais={[{ rotulo: "Origem", nome: "Faria Lima", endereco: "Av. Brig. Faria Lima, 3500 · São Paulo/SP", complemento: "5º andar" }]}
        prazo={{ texto: "Hoje até 19:00", falta: "faltam 4h40", atrasada: false }}
        erro={null}
        {...extra}
      />
    </Router>,
  );
}

describe("Demanda", () => {
  it("mostra o escopo com o que está nas OS e o saldo, as OS, o pedido da direta e os locais", () => {
    const html = ficha();
    const textos = textosDaTela(html);
    for (const texto of [
      "Demandas",
      "Demanda 10053",
      "· Troca de cadeiras",
      "Paraquedas",
      "Agendada",
      "Itaú Unibanco",
      "Direta",
      "Escopo e saldo",
      "Pedido",
      "Nas OS",
      "Saldo",
      "Cadeira Flexform",
      "40",
      "25",
      "OS 10053-01",
      "15",
      "OS desta demanda · 1",
      "23/10/2026 15:00–19:00 · Lucas Ferreira · Sem veículo",
      "Saldo de 1 item",
      "Planejar OS",
      "Pedido por",
      "Renata Campos · 11987654321",
      "Recebida",
      "WhatsApp · 23/10/2026 13:05",
      "Executar até",
      "Hoje 19:00 · faltam 4h40",
      "Locais",
      "Origem",
      "Faria Lima",
      "Av. Brig. Faria Lima, 3500 · São Paulo/SP · 5º andar",
    ]) {
      expect(textos, texto).toContain(texto);
    }
    expect(html).toContain('href="/operacao/os?numero=10053-01"');
    expect(html).toContain('href="/operacao/demandas"');
    expect(html).toContain('href="/operacao/planejar?demanda=10053"');
    expect(html).not.toContain("R$");
  });

  it("a demanda do Comercial diz Orçado; fora de Para planejar, sem abrir OS", () => {
    const textos = textosDaTela(ficha({ demanda: { ...DIRETA, entrada: "comercial", pedidoPor: null, recebidaEm: null, canal: null }, etapa: "execucao_a_orcar", prazo: null }));
    expect(textos).toContain("Orçado");
    expect(textos).not.toContain("Planejar OS");
    expect(textos).not.toContain("Pedido por");
  });

  it("a entrega do WMS diz Armazenagem e segue com o escopo da direta", () => {
    const textos = textosDaTela(ficha({ demanda: { ...DIRETA, numero: "10060", titulo: "Entrega do pedido PED-0118", canal: "wms", pedidoPor: null } }));
    expect(textos).toContain("Armazenagem");
    expect(textos).toContain("Armazenagem · 23/10/2026 13:05");
    expect(textos).toContain("Pedido");
    expect(textos).not.toContain("Direta");
  });

  it("não encontrada, carregando e erro", () => {
    expect(textosDaTela(ficha({ estado: "nao_encontrada", demanda: null }))).toContain("Demanda 10053 não encontrada");
    expect(textosDaTela(ficha({ estado: "carregando", demanda: null }))).toContain("Carregando");
    expect(textosDaTela(ficha({ estado: "erro", demanda: null }))).toContain("Não foi possível carregar a demanda.");
  });

  it("não tem problema de acessibilidade", async () => {
    expect(await violacoesDeAcessibilidade(ficha())).toEqual([]);
  });
});

describe("a vistoria na ficha da demanda (parte 3.11c)", () => {
  it("antes do escopo fechado, a ficha oferece planejar a vistoria, com o dia da visita técnica", () => {
    const comDia = ficha({ ordens: [], linhasComSaldo: 0, etapa: "no_comercial", vistoria: "2026-10-28" });
    expect(textosDaTela(comDia)).toEqual(expect.arrayContaining(["Vistoria · 28/10/2026", "Planejar vistoria"]));
    expect(textosDaTela(comDia)).not.toContain("Nenhuma OS");
    expect(comDia).toContain('href="/operacao/planejar?demanda=10053&amp;vistoria=1"');
    expect(textosDaTela(ficha({ ordens: [], linhasComSaldo: 0, etapa: "no_comercial", vistoria: "" }))).toContain("Vistoria");
    expect(textosDaTela(ficha())).not.toContain("Planejar vistoria");
  });
});
