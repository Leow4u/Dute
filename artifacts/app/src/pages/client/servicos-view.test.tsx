import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Router } from "wouter";

import { NfsDosServicos } from "@/components/portal/nfs-dos-servicos";
import { fichaDaLeitura } from "@/lib/operacao/ficha-da-os";
import { cobrancaPorDemanda, nfDoPortal, numerosDasOs, ordenarOs, osDoPortal } from "@/lib/portal/servicos";
import { formularioInicial, solicitacaoDoPortal, type FormularioDaSolicitacao } from "@/lib/portal/solicitacao";
import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { textosDaTela, textosForaDaLista } from "@/test/textos";

import { ServicosView, type PedidoNaTela, type ServicosViewProps } from "./servicos-view";

/**
 * Portal › Minhas OS e as NFs dos serviços em Faturas (parte 4.3b) e o
 * Solicitar OS com as solicitações em aberto (parte 4.4b): só rótulos,
 * dados e ações, sem nada interno da OS, e a identidade v3. Dados
 * sintéticos.
 */

const HOJE = "2026-10-23";

function ficha(numero: string, extra: Record<string, unknown> = {}) {
  return fichaDaLeitura(numero, {
    demanda: numero.slice(0, 5),
    customer_code: "ITAU",
    status: "agendada",
    edicao: 1,
    servicos: ["transporte"],
    janela: { data: "2026-10-24", inicio: "09:30", fim: "12:00" },
    locais: { origem: { nome: "Galpão 3", endereco: "Rua das Indústrias, 450" }, destino: { endereco: "Av. Paulista, 1000" } },
    equipe: [{ colaborador_id: "c2", nome: "João Pereira", papel: "motorista" }],
    veiculos: [{ veiculo_id: "v1", placa: "DEF4G56", tipo: "caminhao" }],
    ocorrencias: [{ id: "o1", instante: "2026-10-23T12:00:00.000Z", canal: "escritorio", descricao: "Cliente atrasou a liberação" }],
    ...extra,
  })!;
}

const OS = ordenarOs([
  osDoPortal(ficha("10045-01", { status: "em_execucao", etapas: [{ etapa: "saida_patio", instante: "2026-10-24T12:35:00.000Z", canal: "celular" }] }), HOJE),
  osDoPortal(ficha("10046-01", { janela: { data: "2026-10-28", inicio: "08:00" } }), HOJE),
  osDoPortal(
    ficha("10040-01", { status: "revisada", janela: { data: "2026-10-05" }, conclusao: { instante: "2026-10-05T17:40:00.000Z", canal: "celular", aceite: "assinatura", responsavel: { nome: "Bruna Costa" } } }),
    HOJE,
  ),
]);

const NFS = [
  nfDoPortal("fat_000000000000000000001234", {
    customer_code: "ITAU",
    status: "emitida",
    valor_cents: 1_484_500,
    recebido_cents: 484_500,
    nf: { numero: "1234", serie: "1", emitida_em: "2026-10-06" },
    vencimento: "2026-10-20",
    forma: "boleto",
    demandas: [{ numero: "10040", valor_cents: 1_484_500, titulo: "Transporte de arquivo" }],
  })!,
];

function props(extra: Partial<ServicosViewProps> = {}): ServicosViewProps {
  return {
    estado: "pronto",
    os: OS,
    numeros: numerosDasOs(OS),
    aPagarCents: 1_000_000,
    cobrancas: cobrancaPorDemanda(NFS, HOJE),
    busca: "",
    aberta: OS.find((os) => os.numero === "10045-01") ?? null,
    solicitacoes: [],
    pedido: null,
    acoes: {
      buscar: () => undefined,
      abrir: () => undefined,
      fechar: () => undefined,
      solicitar: () => undefined,
      mudar: () => undefined,
      anexar: () => undefined,
      removerAnexo: () => undefined,
      enviar: () => undefined,
      cancelar: () => undefined,
    },
    ...extra,
  };
}

function pedido(extra: Partial<PedidoNaTela> = {}, form: Partial<FormularioDaSolicitacao> = {}): PedidoNaTela {
  return {
    aberto: true,
    form: { ...formularioInicial(HOJE), ...form },
    problemas: {},
    enviando: false,
    erro: null,
    problemaDoAnexo: null,
    enviada: false,
    hoje: HOJE,
    ...extra,
  };
}

const SOLICITACOES = [
  solicitacaoDoPortal("sol_0000000000000001", {
    tipo_servico: "transporte",
    status: "recebida",
    data: "2026-10-27",
    horario: "08:00",
    origem: "Rua das Indústrias, 450",
    destino: "Av. Paulista, 1000",
    descricao: "Levar 12 paletes",
    recebida_em: "2026-10-23T12:00:00.000Z",
  })!,
  solicitacaoDoPortal("sol_0000000000000002", {
    tipo_servico: "mudanca",
    status: "aceita",
    demanda: "10050",
    data: "2026-10-30",
    horario: "07:00",
    origem: "Rua Funchal, 200",
    recebida_em: "2026-10-22T12:00:00.000Z",
  })!,
  solicitacaoDoPortal("sol_0000000000000003", {
    tipo_servico: "servico_em_campo",
    status: "recusada",
    data: "2026-10-25",
    horario: "10:00",
    origem: "Rua Augusta, 10",
    recusa: { motivo: "Fora da área atendida", em: "2026-10-22T18:00:00.000Z" },
    recebida_em: "2026-10-21T12:00:00.000Z",
  })!,
];

function render(extra: Partial<ServicosViewProps> = {}) {
  return renderToStaticMarkup(
    <Router ssrPath="/portal/servicos">
      <ServicosView {...props(extra)} />
    </Router>,
  );
}

const PRINCIPAL = /<button[^>]*class="[^"]*bg-primary text-primary-foreground[^"]*"[^>]*>/g;

describe("Minhas OS", () => {
  it("os números, a lista com a NF da demanda e o andamento da OS aberta, sem legenda", () => {
    expect(textosDaTela(render())).toEqual([
      "Minhas OS",
      "Em execução",
      "1",
      "Agendadas",
      "Concluídas",
      "A pagar",
      "R$ 10.000,00",
      "OS 10045-01",
      "Transporte",
      "24/10/2026 09:30–12:00",
      "OS 10046-01",
      "28/10/2026 08:00",
      "Agendada",
      "OS 10040-01",
      "05/10/2026",
      "Concluída",
      "NF 1234 · Vencida há 3 dias",
      "Pedido recebido",
      "Saída do pátio · 09:35",
      "4",
      "Data",
      "Origem",
      "Galpão 3 · Rua das Indústrias, 450",
      "Destino",
      "Av. Paulista, 1000",
      "Motorista",
      "João Pereira · DEF-4G56",
    ]);
    const permitidos = [
      /^(Minhas OS|Em execução|Agendadas|Concluídas|A pagar|Agendada|Concluída|Para agendar|Cancelada|Pedido recebido)$/,
      /^\d+$/,
      /^R\$ [\d.]+,\d{2}$/,
      /^OS \d{5}-\d{2}$/,
      /^(Transporte|Vistoria)$/,
      /^\d{2}\/\d{2}\/\d{4}( \d{2}:\d{2}(–\d{2}:\d{2})?)?$/,
      /^NF \d+ · (Vence|Vencida|Paga).*$/,
      /^(Saída do pátio|Chegada na origem|Carregamento|Saída da origem|Chegada no destino|Montagem|Fim) · \d{2}:\d{2}$/,
      /^(Data|Origem|Destino|Motorista|Recebimento|Faturamento)$/,
      // Endereço e "nome · endereço", "motorista · placa".
      /^(Rua|Av\.) .+, \d+$/,
      /^.+ · .+$/,
    ];
    expect(textosForaDaLista(render(), permitidos)).toEqual([]);
  });

  it("nada interno da OS chega à tela: ocorrências, revisão, equipe além do motorista", () => {
    const html = render();
    expect(html).not.toMatch(/atrasou|Conferido|ocorr/i);
    expect(html).toMatch(/^<div class="v3 /);
    expect(html.match(PRINCIPAL) ?? []).toHaveLength(0);
  });

  it("a OS concluída mostra quem recebeu e a NF da demanda", () => {
    const textos = textosDaTela(render({ aberta: OS.find((os) => os.numero === "10040-01") ?? null }));
    expect(textos).toEqual(expect.arrayContaining(["Recebimento", "Recebido por Bruna Costa · 05/10/2026 14:40", "Faturamento", "NF 1234 · Vencida há 3 dias"]));
  });

  it("sem as faturas no contrato não há A pagar nem NF; carregando, erro, vazio e busca dizem o que é", () => {
    const semFaturas = textosDaTela(render({ aPagarCents: null, cobrancas: new Map(), aberta: null }));
    expect(semFaturas).not.toContain("A pagar");
    expect(semFaturas.some((texto) => texto.startsWith("NF "))).toBe(false);
    expect(textosDaTela(render({ estado: "carregando", os: [], aberta: null }))).toEqual(["Minhas OS", "Carregando..."]);
    expect(textosDaTela(render({ estado: "erro", os: [], aberta: null }))).toEqual(["Minhas OS", "Não foi possível carregar as OS."]);
    expect(textosDaTela(render({ os: [], numeros: { emAndamento: 0, agendadas: 0, concluidas: 0 }, aberta: null }))).toContain("Nenhuma OS ainda");
    expect(textosDaTela(render({ busca: "nada assim", aberta: null }))).toContain("Nenhuma OS encontrada");
    expect(textosDaTela(render({ busca: "paulista", aberta: null })).filter((texto) => texto.startsWith("OS "))).toHaveLength(3);
  });

  it("passa nas regras WCAG 2.1 A e AA do axe", async () => {
    expect(await violacoesDeAcessibilidade(render())).toEqual([]);
    expect(await violacoesDeAcessibilidade(render({ aberta: null }))).toEqual([]);
  });
});

describe("Solicitar OS (parte 4.4b)", () => {
  const principais = (html: string) => (html.match(/<button[^>]*class="[^"]*bg-primary text-primary-foreground[^"]*"[^>]*>[\s\S]*?<\/button>/g) ?? []).map((botao) => textosDaTela(botao).join(" "));

  it("com a Operação liberada, Solicitar OS é a única ação principal; sem ela, não aparece", () => {
    expect(principais(render({ pedido: pedido({ aberto: false }) }))).toEqual(["Solicitar OS"]);
    expect(principais(render())).toEqual([]);
  });

  it("o formulário no lugar do painel: os campos do desenho, Enviar solicitação a única ação principal", () => {
    const html = render({ pedido: pedido() });
    const formulario = html.slice(html.indexOf('<form aria-label="Solicitar OS"'));
    expect(textosDaTela(formulario)).toEqual([
      "Solicitar OS",
      "Tipo de serviço",
      "Transporte / frete",
      "Armazenagem / movimentação",
      "Serviço em campo",
      "Mudança / transporte dedicado",
      "Data",
      "Horário",
      "Origem",
      "Destino",
      "O que será feito",
      "Anexar nota fiscal ou documento",
      "Enviar solicitação",
    ]);
    expect(principais(html)).toEqual(["Enviar solicitação"]);
    // O painel da OS aberta dá lugar ao formulário.
    expect(html).not.toContain('aria-label="OS 10045-01"');
    expect(html).toContain('min="2026-10-23"');
    expect(html).toContain('value="2026-10-24"');
  });

  it("o que falta aparece no campo, os anexos se tiram, o erro da callable e o enviando dizem o que é", () => {
    const arquivo = new File(["%PDF"], "NF 4498.pdf", { type: "application/pdf" });
    const html = render({
      pedido: pedido(
        { problemas: { quando: "A data e o horário já passaram.", origem: "Informe a origem." }, erro: "A Operação não está no contrato do seu acesso." },
        { anexos: [{ arquivo, nome: "an_0123456789abcdef.pdf", rotulo: "NF 4498.pdf" }] },
      ),
    });
    const textos = textosDaTela(html);
    expect(textos).toEqual(expect.arrayContaining(["A data e o horário já passaram.", "Informe a origem.", "NF 4498.pdf", "A Operação não está no contrato do seu acesso."]));
    expect(html).toMatch(/<input[^>]*aria-invalid="true"[^>]*aria-describedby="solicitar-origem-problema"[^>]*id="solicitar-origem"|<input[^>]*id="solicitar-origem"[^>]*aria-invalid="true"/);
    expect(html).toContain('aria-label="Tirar NF 4498.pdf"');
    expect(html).toMatch(/<p role="alert"[^>]*>A Operação não está no contrato do seu acesso\.<\/p>/);
    const enviando = render({ pedido: pedido({ enviando: true }) });
    expect(principais(enviando)).toEqual(["Enviando..."]);
    expect(enviando).toMatch(/<button[^>]*type="submit"[^>]*disabled=""/);
    const cheio = Array.from({ length: 3 }, (_, indice) => ({ arquivo, nome: `an_000000000000000${indice}.pdf`, rotulo: `Doc ${indice}` }));
    expect(textosDaTela(render({ pedido: pedido({}, { anexos: cheio }) }))).not.toContain("Anexar nota fiscal ou documento");
  });

  it("as solicitações em aberto antes das OS, com a situação, a demanda e o motivo; a que acabou de sair avisa", () => {
    const html = render({ solicitacoes: SOLICITACOES, aberta: null, pedido: pedido({ aberto: false, enviada: true }) });
    const secao = html.slice(html.indexOf('<section aria-label="Solicitações"'), html.indexOf('<section aria-label="OS"'));
    expect(textosDaTela(secao)).toEqual([
      "Solicitações",
      "Solicitação enviada",
      "Transporte / frete · 27/10/2026 08:00",
      "Rua das Indústrias, 450 → Av. Paulista, 1000",
      "Aguardando a Dutelog",
      "Mudança / transporte dedicado · 30/10/2026 07:00",
      "Rua Funchal, 200",
      "Demanda 10050",
      "Em planejamento",
      "Serviço em campo · 25/10/2026 10:00",
      "Rua Augusta, 10",
      "Fora da área atendida",
      "Não atendida",
    ]);
    expect(secao).toMatch(/<p role="status"[^>]*>Solicitação enviada<\/p>/);
    expect(textosDaTela(render({ solicitacoes: [], aberta: null }))).not.toContain("Solicitações");
  });

  it("passa nas regras WCAG 2.1 A e AA do axe, com o formulário e as solicitações", async () => {
    expect(await violacoesDeAcessibilidade(render({ solicitacoes: SOLICITACOES, pedido: pedido() }))).toEqual([]);
    expect(await violacoesDeAcessibilidade(render({ solicitacoes: SOLICITACOES, pedido: pedido({ problemas: { origem: "Informe a origem.", quando: "A data e o horário já passaram." } }) }))).toEqual([]);
    expect(await violacoesDeAcessibilidade(render({ pedido: pedido({ aberto: false }) }))).toEqual([]);
  });
});

describe("as NFs dos serviços em Faturas", () => {
  const html = () => renderToStaticMarkup(<NfsDosServicos nfs={NFS} hoje={HOJE} />);

  it("a NF com as demandas, o saldo do pagamento parcial e a situação pelo vencimento", () => {
    expect(textosDaTela(html())).toEqual([
      "NFs dos serviços",
      "A pagar R$ 10.000,00",
      "NF 1234",
      "Emitida 06/10/2026 · vence 20/10/2026",
      "10040 · Transporte de arquivo · R$ 14.845,00",
      "R$ 10.000,00",
      "de R$ 14.845,00",
      "Vencida há 3 dias",
    ]);
    expect(html()).toMatch(/^<section aria-label="NFs dos serviços" class="v3 /);
  });

  it("sem NF, nada aparece", () => {
    expect(renderToStaticMarkup(<NfsDosServicos nfs={[]} hoje={HOJE} />)).toBe("");
  });

  it("passa nas regras WCAG 2.1 A e AA do axe", async () => {
    expect(await violacoesDeAcessibilidade(html())).toEqual([]);
  });
});
