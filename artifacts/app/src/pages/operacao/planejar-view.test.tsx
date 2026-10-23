import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Router } from "wouter";

import type { Sugestao, SugestaoNaTela } from "@/lib/memoria/sugestao";
import type { ColaboradorDaLista, VeiculoDaLista } from "@/lib/operacao/cadastro";
import type { DemandaDaOperacao, LinhaDoSaldo } from "@/lib/operacao/demandas";
import { dividir, planoInicial, restantes, vistoriaInicial, type FormularioDoPlano } from "@/lib/operacao/planejar";
import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { textosDaTela, textosForaDaLista } from "@/test/textos";

import { PlanejarView } from "./planejar-view";

/** Operação › Planejar OS (parte 3.6a, docs/mockups/OpOSPlanejar.dc.html). */

const noop = () => undefined;
const HOJE = "2026-10-27";

const DEMANDA: DemandaDaOperacao = {
  numero: "10045",
  customerCode: "ITAU",
  titulo: "Mudança do 5º andar",
  tipo: "planejada",
  entrada: "comercial",
  etapa: "para_planejar",
  executarAte: null,
  osNumeros: ["10045-01"],
  escopo: [],
  fora: null,
  visitaTecnica: null,
  escopoRv: null,
  recebidaEm: null,
  canal: null,
  pedidoPor: null,
  origem: null,
  destino: null,
};

const SALDO: LinhaDoSaldo[] = [
  { id: "ln_1", item: "Cadeira Flexform", unidade: "UN", escopo: "300", nasOs: "140", osNumeros: ["10045-01"], saldo: "160" },
  { id: "ln_2", item: "Mesa de trabalho", unidade: "UN", escopo: "60", nasOs: "0", osNumeros: [], saldo: "60" },
];

const PESSOAS = [
  { id: "col_cs", nome: "Carlos Silva", funcao: "Líder", vinculo: "proprio", empresa: "", papeis: ["lider"], noApp: true, ativo: true },
  { id: "col_vm", nome: "Valter Moreira", funcao: "Motorista", vinculo: "terceiro", empresa: "Rota Sul", papeis: ["motorista"], noApp: false, ativo: true },
  { id: "col_da", nome: "Diego Alves", funcao: "Montador", vinculo: "freelancer", empresa: "", papeis: [], noApp: false, ativo: true },
] as ColaboradorDaLista[];

const VEICULOS = [
  { id: "vei_def", placa: "DEF-4G56", tipo: "Baú", resumo: "VW Delivery · 5000 kg · 30 m³", dono: "proprio", empresa: "", ativo: true },
  { id: "vei_fgh", placa: "FGH-2B34", tipo: "Truck", resumo: "8000 kg · 45 m³", dono: "terceiro", empresa: "Rota Sul", ativo: true },
] as VeiculoDaLista[];

function render(form: FormularioDoPlano, extra: Partial<Parameters<typeof PlanejarView>[0]> = {}) {
  return renderToStaticMarkup(
    <Router ssrPath="/operacao/planejar">
      <PlanejarView
        estado="pronto"
        numero="10045"
        demanda={DEMANDA}
        cliente="Itaú Unibanco"
        saldo={SALDO}
        restante={restantes(SALDO, form)}
        locais={[{ rotulo: "Origem", nome: "Faria Lima", endereco: "Av. Brig. Faria Lima, 3500", complemento: "5º andar" }]}
        form={form}
        onForm={noop}
        onQuantidade={noop}
        onIgualar={noop}
        onDividir={noop}
        onRemoverOs={noop}
        pessoas={PESSOAS}
        veiculos={VEICULOS}
        alertas={[]}
        problemas={[]}
        ocupado={false}
        erro={null}
        onGravar={noop}
        {...extra}
      />
    </Router>,
  );
}

const COM_EQUIPE: FormularioDoPlano = {
  ...planoInicial(SALDO, HOJE),
  equipe: [
    { colaboradorId: "col_cs", papel: "lider", ordens: [0] },
    { colaboradorId: "col_vm", papel: "motorista", ordens: [0] },
  ],
  veiculos: [{ veiculoId: "vei_fgh", ordens: [0] }],
};

describe("Planejar OS", () => {
  it("tem quando, itens do saldo com restante, equipe, veículos, locais, instruções e o resumo", () => {
    const html = render(COM_EQUIPE);
    const textos = textosDaTela(html);
    for (const texto of [
      "Demanda 10045",
      "Planejar OS · Demanda 10045",
      "Planejada",
      "Itaú Unibanco",
      "Mudança do 5º andar",
      "Quando",
      "Data",
      "Início",
      "Fim",
      "Mais uma OS",
      "Itens do saldo",
      "Igualar ao saldo",
      "Cadeira Flexform",
      "Saldo 160 un",
      "Nesta OS",
      "Restante",
      "0",
      "Equipe · 2",
      "Carlos Silva",
      "no app",
      "Valter Moreira",
      "Terceiro · Rota Sul",
      "Adicionar pessoa",
      "Veículos · 1",
      "FGH-2B34",
      "Adicionar veículo",
      "Locais",
      "Origem",
      "Faria Lima",
      "Contato no local",
      "Instruções",
      "Para a equipe",
      "Resumo",
      "27/10/2026",
      "2 · 1 terceiro",
      "Agendar",
      "Salvar rascunho",
      "Cancelar",
    ]) {
      expect(textos, texto).toContain(texto);
    }
    expect(html).not.toContain("R$");
    // A pessoa ainda fora do plano aparece para adicionar, no grupo do vínculo.
    expect(html).toMatch(/<optgroup label="Freelancer"><option value="col_da">Diego Alves · Montador<\/option><\/optgroup>/);
  });

  it("com duas OS, cada linha tem uma quantidade por OS e cada pessoa escolhe em quais OS entra", () => {
    const html = render(dividir(COM_EQUIPE));
    const textos = textosDaTela(html);
    for (const texto of ["OS 1", "OS 2", "OS 1: igualar ao saldo", "OS 2: igualar ao saldo"]) expect(textos, texto).toContain(texto);
    expect(html).toContain('aria-label="OS de Carlos Silva"');
    expect(html).toContain('aria-label="Tirar a OS 2"');
  });

  it("os alertas ficam em atenção e o que impede, como alerta de erro", () => {
    const textos = textosDaTela(render(COM_EQUIPE, { alertas: ["A OS sem veículo"], problemas: ["Cadeira Flexform: as OS somam 170 e o saldo é 160."] }));
    expect(textos).toContain("A OS sem veículo");
    expect(textos).toContain("Cadeira Flexform: as OS somam 170 e o saldo é 160.");
  });

  it("sem legenda: só rótulos, dados e ações", () => {
    expect(
      textosForaDaLista(render(COM_EQUIPE), [
        /^(Demanda 10045|Planejar OS · Demanda 10045|Planejada|Itaú Unibanco|·|Mudança do 5º andar)$/,
        /^(Quando|Mais uma OS|Data|Início|Fim)$/,
        /^(Itens do saldo|Igualar ao saldo|Cadeira Flexform|Mesa de trabalho|Saldo 160 un|Saldo 60 un|Nesta OS|Restante|0)$/,
        /^(Equipe · 2|Carlos Silva|Valter Moreira|Terceiro · Rota Sul|no app|Sem papel|Líder|Motorista|Papel de .+|Tirar .+|Adicionar pessoa|Escolha|Freelancer|Diego Alves · Montador)$/,
        /^[A-Z]{2}$/,
        /^(Veículos · 1|FGH-2B34|Truck · 8000 kg · 45 m³|Adicionar veículo|DEF-4G56 · Baú)$/,
        /^(Locais|Origem|Destino|Faria Lima|Av\. Brig\. Faria Lima, 3500 · 5º andar|Sem local|Contato no local|Telefone)$/,
        /^(Instruções|Para a equipe)$/,
        /^(Resumo|OS|1|Itens|2|Equipe|2 · 1 terceiro|Veículos|27\/10\/2026|Agendar|Salvar rascunho|Cancelar)$/,
      ]),
    ).toEqual([]);
  });

  it("carregando, erro, não encontrada e sem saldo", () => {
    expect(textosDaTela(render(COM_EQUIPE, { estado: "carregando", form: null }))).toContain("Carregando");
    expect(textosDaTela(render(COM_EQUIPE, { estado: "erro", form: null }))).toContain("Não foi possível carregar a demanda.");
    expect(textosDaTela(render(COM_EQUIPE, { estado: "nao_encontrada", demanda: null, form: null }))).toContain("Demanda 10045 não encontrada");
    expect(textosDaTela(render(COM_EQUIPE, { estado: "sem_saldo", form: null }))).toContain("Todo o saldo da demanda já está em OS");
  });

  it("não tem problema de acessibilidade", async () => {
    expect(await violacoesDeAcessibilidade(render(dividir(COM_EQUIPE), { alertas: ["OS 2 sem líder"] }))).toEqual([]);
  });
});

describe("a duração sugerida (parte 5.2b)", () => {
  const SUGESTAO: Sugestao = {
    pessoas: 2,
    itens: [
      { lpu_item_id: "lpu_cadeira", item: "Cadeira Flexform", quantidade: "160", minutos: 120, base: { escopo: "cliente", execucoes: 6, homem_minuto_por_unidade: 1.5, os_recentes: ["10040-01", "10039-01"] } },
      { lpu_item_id: "lpu_mesa", item: "Mesa de trabalho", quantidade: "60", minutos: null, base: null },
    ],
    minutos_total: 120,
    completa: false,
    divisao: null,
    plano_otimista: { escopo: "cliente", execucoes: 6, erro_medio_pct: 22, acima_da_janela: 5 },
  };
  const pronta = (sugestao: Sugestao = SUGESTAO): SugestaoNaTela => ({ chave: "k", estado: "pronto", sugestao });
  const comSugestao = (extra: Partial<Parameters<typeof PlanejarView>[0]> = {}) => render(COM_EQUIPE, { sugestoes: [pronta()], ignoradas: [false], onUsarSugestao: noop, onIgnorarSugestao: noop, ...extra });
  const principais = (html: string) => (html.match(/<button[^>]*class="[^"]*bg-primary text-primary-foreground[^"]*"[^>]*>[\s\S]*?<\/button>/g) ?? []).map((botao) => textosDaTela(botao).join(" "));

  it("no Quando, a duração com a equipe, a base de cada item com as OS, o item sem base e o aviso do plano otimista", () => {
    const html = comSugestao();
    const inicio = html.indexOf('aria-label="Duração sugerida · Nesta OS"');
    const grupo = html.slice(html.indexOf(">", inicio) + 1);
    expect(textosDaTela(grupo.slice(0, grupo.indexOf("</div></li>")))).toEqual([
      "Duração sugerida 2h com 2 pessoas",
      "Usar",
      "Ignorar",
      "Cadeira Flexform · 0,8 min por unidade com 2 pessoas · 6 execuções do cliente: 10040-01, 10039-01",
      "Mesa de trabalho · sem base",
      "Os planos deste cliente passam da janela em 22%, na média de 6 OS.",
    ]);
    // A sugestão não ganha ação principal: Agendar continua a única.
    expect(principais(html)).toEqual(["Agendar"]);
    expect(html).not.toMatch(/R\$|preço|valor/);
  });

  it("sem base em nenhum item, diz só isso; acima de 8h, a divisão; ignorada, carregando ou sem memória, nada aparece", () => {
    const semBase = textosDaTela(comSugestao({ sugestoes: [pronta({ ...SUGESTAO, minutos_total: null, plano_otimista: null })] }));
    expect(semBase).toContain("Sem base para sugerir a duração");
    expect(semBase).not.toContain("Usar");
    expect(textosDaTela(comSugestao({ sugestoes: [pronta({ ...SUGESTAO, minutos_total: 600, divisao: { os: 2, minutos_por_os: 300 } })] }))).toContain("Passa de 8h: 2 OS de 5h");
    for (const extra of [{ ignoradas: [true] }, { sugestoes: [{ chave: "k", estado: "carregando" as const, sugestao: null }] }, { onUsarSugestao: undefined }]) {
      expect(textosDaTela(comSugestao(extra)), JSON.stringify(extra)).not.toContain("Duração sugerida 2h com 2 pessoas");
    }
  });

  it("não tem problema de acessibilidade", async () => {
    expect(await violacoesDeAcessibilidade(comSugestao())).toEqual([]);
  });
});

describe("Planejar vistoria (parte 3.11c)", () => {
  const vistoria = () => render(vistoriaInicial("2026-10-28"), { vistoria: true, saldo: [], restante: new Map() });

  it("uma OS só, sem itens, com a equipe, os veículos, o local de origem e as instruções; sem legenda", async () => {
    const html = vistoria();
    const textos = textosDaTela(html);
    expect(textos).toContain("Planejar vistoria · Demanda 10045");
    for (const ausente of ["Mais uma OS", "Itens do saldo", "Destino", "Itens", "Planejar OS · Demanda 10045"]) expect(textos, ausente).not.toContain(ausente);
    expect(textos).toEqual(expect.arrayContaining(["Quando", "Local", "Origem", "Faria Lima", "Contato no local", "Agendar", "Salvar rascunho"]));
    expect(await violacoesDeAcessibilidade(html)).toEqual([]);
  });

  it("indisponível: mostra por que a demanda não recebe vistoria", () => {
    const html = render(vistoriaInicial("2026-10-28"), { estado: "indisponivel", vistoria: true, motivo: "A demanda já tem a vistoria 10045-01 em aberto." });
    expect(textosDaTela(html)).toEqual(["Demanda 10045", "A demanda já tem a vistoria 10045-01 em aberto."]);
  });
});
