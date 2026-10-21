import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Router } from "wouter";

import {
  cadastroDoDocumento,
  contatoDoDocumento,
  contratoDoDocumento,
  localDoDocumento,
  type CadastroComercial,
  type ContratoResumo,
} from "@/lib/comercial/clientes";
import { LEGACY_CUSTOMER_CODE } from "@/lib/operations";

import { ABA_INICIAL, ClientesView, type ClientesViewProps, type FichaAba } from "./clientes-view";

const CADASTROS = (
  [
    ["BTG_Pactual", { code: LEGACY_CUSTOMER_CODE, name: LEGACY_CUSTOMER_CODE, sku_prefix: "BTG" }],
    [
      "ITAU-UNIBANCO",
      {
        customer_code: "ITAU-UNIBANCO",
        name: "Itaú Unibanco",
        legal_name: "Itaú Unibanco S.A.",
        document: "11222333000181",
        comercial: { cidade: "São Paulo", uf: "SP", responsavel_uid: "u-gui" },
        created_at: new Date(2026, 9, 2),
      },
    ],
    ["BANCO-SAFRA", { customer_code: "BANCO-SAFRA", name: "Banco Safra" }],
    ["GRUPO-SBF", { customer_code: "GRUPO-SBF", name: "Grupo SBF", stage: "prospect", comercial: { cidade: "São Paulo", uf: "SP" } }],
    ["VERTICE", { customer_code: "VERTICE", name: "Vértice Engenharia", stage: "prospect", comercial: { cidade: "Barueri", uf: "SP" } }],
  ] as Array<[string, Record<string, unknown>]>
).map(([id, data]) => cadastroDoDocumento(id, data)!) as CadastroComercial[];

const CONTRATOS = (
  [
    ["ct-itau", { customer_code: "ITAU-UNIBANCO", nome: "Contrato Itaú", vigente_de: "2025-07-01", vigente_ate: "2027-06-30", status: "vigente" }],
    ["ct-itau-2021", { customer_code: "ITAU-UNIBANCO", nome: "RFQ 2021", vigente_de: "2021-07-01", vigente_ate: "2023-06-30", status: "encerrado" }],
    ["ct-btg", { customer_code: LEGACY_CUSTOMER_CODE, nome: "Armazenagem", vigente_de: "2024-07-01", vigente_ate: null, status: "vigente" }],
  ] as Array<[string, Record<string, unknown>]>
).map(([id, data]) => contratoDoDocumento(id, data)!) as ContratoResumo[];

const LOCAIS = [
  localDoDocumento("loc_1", {
    customer_code: "ITAU-UNIBANCO",
    nome: "CEIC – Torre Olavo Setubal",
    sigla: "CEIC-OS",
    endereco: { logradouro: "Pça. Alfredo Egydio de Souza Aranha", numero: "100", bairro: "Jabaquara", cidade: null, uf: null, cep: null },
  })!,
  localDoDocumento("loc_2", { customer_code: "ITAU-UNIBANCO", nome: "Itaú Clube", sigla: null, endereco: null, ativo: false })!,
];

const CONTATOS = [
  contatoDoDocumento("ct_1", { customer_code: "ITAU-UNIBANCO", nome: "Renata Okubo", papel: "gestor_cliente", email: "renata@exemplo.com.br" })!,
  contatoDoDocumento("ct_2", { customer_code: "ITAU-UNIBANCO", nome: "Camila Duarte", papel: "gerenciadora", empresa: "Souza & Lopes", telefone: "11999990000" })!,
];

const noop = () => undefined;

function props(overrides: Partial<ClientesViewProps> = {}): ClientesViewProps {
  return {
    estado: "pronto",
    cadastros: CADASTROS,
    contratos: CONTRATOS,
    hoje: "2026-10-21",
    segmento: "todos",
    onSegmento: noop,
    busca: "",
    onBusca: noop,
    selecionado: CADASTROS.find((cadastro) => cadastro.id === "ITAU-UNIBANCO")!,
    onSelecionar: noop,
    aba: "dados",
    onAba: noop,
    locais: LOCAIS,
    contatos: CONTATOS,
    responsavel: "Guilherme",
    ocupado: false,
    acoes: {
      novoProspect: noop,
      editar: noop,
      marcarCliente: noop,
      novoLocal: noop,
      editarLocal: noop,
      alternarLocal: noop,
      novoContato: noop,
      editarContato: noop,
      alternarContato: noop,
    },
    ...overrides,
  };
}

function render(overrides: Partial<ClientesViewProps> = {}) {
  return renderToStaticMarkup(
    <Router ssrPath="/comercial/clientes">
      <ClientesView {...props(overrides)} />
    </Router>,
  );
}

/** Textos visíveis, na ordem: o que a pessoa lê na tela. */
function texts(html: string) {
  return html
    .replace(/<span class="sr-only">[^<]*<\/span>/g, "")
    .split(/<[^>]+>/)
    .map((text) => text.trim())
    .filter(Boolean)
    .map((text) => text.replace(/&amp;/g, "&"));
}

const CABECALHO_E_LISTA = [
  "Clientes",
  "Todos",
  "5",
  "Clientes",
  "3",
  "Prospects",
  "2",
  "Novo prospect",
  "Clientes",
  "BS",
  "Banco Safra",
  "Sem contrato",
  "BP",
  LEGACY_CUSTOMER_CODE,
  "Contrato sem prazo",
  "Armazenagem",
  "IU",
  "Itaú Unibanco",
  "São Paulo/SP · Contrato até 30/06/2027",
  "Prospects",
  "GS",
  "Grupo SBF",
  "São Paulo/SP · Sem contrato",
  "Prospect",
  "VE",
  "Vértice Engenharia",
  "Barueri/SP · Sem contrato",
  "Prospect",
];

const FICHA_ITAU = [
  "IU",
  "Itaú Unibanco",
  "Itaú Unibanco S.A.",
  "CNPJ 11.222.333/0001-81",
  "São Paulo/SP",
  "Contrato até 30/06/2027",
  "Editar",
  "Dados",
  "Locais",
  "2",
  "Contatos",
  "2",
  "Contratos",
  "2",
];

describe("tela de Clientes e prospects", () => {
  it("sem legenda: cabeçalho, lista e ficha com a aba Dados só têm rótulos, dados e ações", () => {
    expect(texts(render())).toEqual([
      ...CABECALHO_E_LISTA,
      ...FICHA_ITAU,
      "Código",
      "ITAU-UNIBANCO",
      "Razão social",
      "Itaú Unibanco S.A.",
      "CNPJ",
      "11.222.333/0001-81",
      "Cidade/UF",
      "São Paulo/SP",
      "Responsável",
      "Guilherme",
    ]);
  });

  it("identidade v3 dentro do layout do app, e uma ação principal só", () => {
    const html = render();
    expect(html).toMatch(/^<div class="v3 /);
    expect(html.match(/bg-primary text-primary-foreground/g)).toHaveLength(1);
    expect(html).toContain('aria-label="Buscar por nome ou CNPJ"');
    expect(html).toContain('placeholder="Nome ou CNPJ"');
  });

  it("no celular, lista e ficha empilham; no computador, ficam lado a lado", () => {
    expect(render()).toContain('class="flex flex-col gap-5 lg:flex-row lg:items-start"');
  });

  it("no computador, a lista longa rola sozinha e fica à vista ao lado da ficha", () => {
    const lista = render().match(/<section aria-label="Lista de clientes e prospects" class="([^"]+)"/)?.[1] ?? "";
    expect(lista.split(" ")).toEqual(expect.arrayContaining(["lg:sticky", "lg:top-4", "lg:overflow-y-auto"]));
    expect(lista).toMatch(/lg:max-h-\[/);
  });

  it("a ficha abre em Locais, como no mockup", () => {
    expect(ABA_INICIAL).toBe("locais");
  });

  it("aba Locais: sigla, nome, endereço e as ações de cada local", () => {
    const html = render({ aba: "locais" });
    const lista = texts(html).slice(CABECALHO_E_LISTA.length + FICHA_ITAU.length);
    expect(lista).toEqual([
      "Novo local",
      "CEIC-OS",
      "CEIC – Torre Olavo Setubal",
      "Pça. Alfredo Egydio de Souza Aranha, 100 · Jabaquara",
      "Editar",
      "Desativar",
      "—",
      "Itaú Clube",
      "Inativo",
      "Editar",
      "Reativar",
    ]);
  });

  it("aba Contatos: agrupados por empresa, com o papel", () => {
    const lista = texts(render({ aba: "contatos" })).slice(CABECALHO_E_LISTA.length + FICHA_ITAU.length);
    expect(lista).toEqual([
      "2 pessoas · 2 empresas",
      "Novo contato",
      "Itaú Unibanco",
      "Cliente",
      "Renata Okubo",
      "Gestor do cliente",
      "renata@exemplo.com.br",
      "Editar",
      "Desativar",
      "Souza & Lopes",
      "Gerenciadora",
      "Camila Duarte",
      "Gerenciadora",
      "(11) 99999-0000",
      "Editar",
      "Desativar",
    ]);
  });

  it("aba Contratos: cada contrato com a vigência e a situação", () => {
    const lista = texts(render({ aba: "contratos" })).slice(CABECALHO_E_LISTA.length + FICHA_ITAU.length);
    expect(lista).toEqual(["Contrato Itaú", "01/07/2025 a 30/06/2027", "Vigente", "RFQ 2021", "01/07/2021 a 30/06/2023", "Encerrado"]);
  });

  it("prospect: selo Prospect, Sem contrato e a ação Marcar como cliente", () => {
    const sbf = CADASTROS.find((cadastro) => cadastro.id === "GRUPO-SBF")!;
    const ficha = texts(render({ selecionado: sbf, locais: [], contatos: [], responsavel: null })).slice(CABECALHO_E_LISTA.length);
    expect(ficha).toEqual([
      "GS",
      "Grupo SBF",
      "São Paulo/SP",
      "Prospect",
      "Sem contrato",
      "Editar",
      "Marcar como cliente",
      "Dados",
      "Locais",
      "0",
      "Contatos",
      "0",
      "Contratos",
      "0",
      "Código",
      "GRUPO-SBF",
      "Razão social",
      "—",
      "CNPJ",
      "—",
      "Cidade/UF",
      "São Paulo/SP",
      "Responsável",
      "—",
    ]);
  });

  const VAZIO: Partial<Record<FichaAba, string>> = { locais: "Nenhum local", contatos: "Nenhum contato", contratos: "Nenhum contrato" };

  it.each<FichaAba>(["locais", "contatos", "contratos"])("aba %s vazia diz que não há nada", (aba) => {
    const vertice = CADASTROS.find((cadastro) => cadastro.id === "VERTICE")!;
    const fim = texts(render({ selecionado: vertice, aba, locais: [], contatos: [] })).at(-1);
    expect(fim).toBe(VAZIO[aba]);
  });

  it("contratos ainda carregando: a tela não afirma Sem contrato", () => {
    const lista = texts(render({ contratos: "carregando" }));
    for (const rotulo of ["Sem contrato", "Contrato sem prazo", "Contrato até 30/06/2027"]) expect(lista).not.toContain(rotulo);
    expect(lista).toContain("São Paulo/SP");
    expect(texts(render({ contratos: "carregando", aba: "contratos" })).at(-1)).toBe("Carregando...");
  });

  it("erro ao ler contratos, locais ou contatos aparece como erro, não como vazio", () => {
    const comErro = texts(render({ contratos: "erro" }));
    expect(comErro).not.toContain("Sem contrato");
    expect(comErro).toContain("Erro ao ler contratos");
    expect(texts(render({ contratos: "erro", aba: "contratos" })).at(-1)).toBe("Não foi possível carregar.");
    expect(texts(render({ locais: "erro", aba: "locais" })).at(-1)).toBe("Não foi possível carregar.");
    expect(texts(render({ contatos: "erro", aba: "contatos" })).at(-1)).toBe("Não foi possível carregar.");
  });

  it("busca sem resultado e carregamento", () => {
    expect(texts(render({ busca: "zzz" })).slice(8, 9)).toEqual(["Nenhum resultado"]);
    expect(texts(render({ estado: "carregando", selecionado: null })).slice(8)).toEqual(["Carregando..."]);
    expect(texts(render({ estado: "erro", selecionado: null })).slice(8)).toEqual(["Não foi possível carregar o cadastro."]);
  });
});
