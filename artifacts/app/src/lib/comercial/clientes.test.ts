import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { LEGACY_CUSTOMER_CODE } from "../operations";
import {
  PAPEIS_DO_CONTATO,
  UFS,
  avisoDaIdentidade,
  avisosDoFormulario,
  avisosOferecidos,
  cadastroDoDocumento,
  contarSegmentos,
  contatoDoDocumento,
  contratoDoDocumento,
  contratosDoCliente,
  contratoVigente,
  desdeQuando,
  empresasSugeridas,
  enderecoEmLinha,
  filtrarCadastros,
  formatarCnpj,
  formatarTelefone,
  formDaEdicao,
  formDoContato,
  formDoLocal,
  gruposDeContatos,
  iniciais,
  localDoDocumento,
  marcarAviso,
  nomesParecidos,
  payloadAtivoContato,
  payloadAtivoLocal,
  payloadContato,
  payloadEdicao,
  payloadLocal,
  payloadMarcarCliente,
  payloadNovoProspect,
  problemaDoCodigo,
  rotuloDoContrato,
  situacaoDoContrato,
  vigenciaDoContrato,
  type CadastroComercial,
  type ContatoResumo,
  type ContratoResumo,
  type LocalResumo,
} from "./clientes";

/** Cadastros como o Firestore entrega: o do WMS (sem stage) e os do Comercial. */
const DOCS: Array<[string, Record<string, unknown>]> = [
  ["BTG_Pactual", { code: LEGACY_CUSTOMER_CODE, name: LEGACY_CUSTOMER_CODE, legal_name: "Banco BTG Pactual S.A.", document: "12345678000195", sku_prefix: "BTG" }],
  [
    "ITAU-UNIBANCO",
    {
      code: "ITAU-UNIBANCO",
      customer_code: "ITAU-UNIBANCO",
      name: "Itaú Unibanco",
      legal_name: "Itaú Unibanco S.A.",
      document: "11222333000181",
      stage: "cliente",
      comercial: { cidade: "São Paulo", uf: "SP", responsavel_uid: "u-gui" },
    },
  ],
  ["BANCO-SAFRA", { code: "BANCO-SAFRA", customer_code: "BANCO-SAFRA", name: "Banco Safra", stage: "cliente" }],
  ["GRUPO-SBF", { code: "GRUPO-SBF", customer_code: "GRUPO-SBF", name: "Grupo SBF", stage: "prospect", comercial: { cidade: "São Paulo", uf: "SP" } }],
  ["VERTICE", { code: "VERTICE", customer_code: "VERTICE", name: "Vértice Engenharia", stage: "prospect", comercial: { cidade: "Barueri", uf: "SP" } }],
  ["ANTIGO", { code: "ANTIGO", customer_code: "ANTIGO", name: "Cliente Arquivado", stage: "prospect", archived: true }],
  ["PAUSADO", { code: "PAUSADO", name: "Arquivado pelo WMS", status: "archived" }],
];

const CADASTROS = DOCS.map(([id, data]) => cadastroDoDocumento(id, data)).filter(
  (cadastro): cadastro is CadastroComercial => cadastro !== null,
);

const nomes = (lista: CadastroComercial[]) => lista.map((cadastro) => cadastro.nome);

describe("cadastro lido do Firestore", () => {
  it("arquivado (pelo Comercial ou pelo WMS) fica fora da tela", () => {
    expect(CADASTROS.map((cadastro) => cadastro.id)).toEqual(["BTG_Pactual", "ITAU-UNIBANCO", "BANCO-SAFRA", "GRUPO-SBF", "VERTICE"]);
  });

  it("cadastro do WMS sem stage é cliente, com o código antigo e o selo de armazenagem", () => {
    const btg = CADASTROS.find((cadastro) => cadastro.id === "BTG_Pactual")!;
    expect(btg).toMatchObject({ code: LEGACY_CUSTOMER_CODE, estagio: "cliente", armazenagem: true, cidade: null, uf: null });
  });

  it("armazenagem: quem tem sigla do SKU ou é a BTG, mesmo sem sigla", () => {
    expect(cadastroDoDocumento("x", { code: "X", name: "X", sku_prefix: "  " })?.armazenagem).toBe(false);
    expect(cadastroDoDocumento("x", { code: "X", name: "X", sku_prefix: "xpt" })?.armazenagem).toBe(true);
    expect(cadastroDoDocumento("b", { customer_code: LEGACY_CUSTOMER_CODE, name: "B" })?.armazenagem).toBe(true);
  });

  it("dados comerciais vêm do mapa comercial; o código, de customer_code e depois code", () => {
    const itau = CADASTROS.find((cadastro) => cadastro.id === "ITAU-UNIBANCO")!;
    expect(itau).toMatchObject({
      code: "ITAU-UNIBANCO",
      nome: "Itaú Unibanco",
      razaoSocial: "Itaú Unibanco S.A.",
      cnpj: "11222333000181",
      estagio: "cliente",
      armazenagem: false,
      cidade: "São Paulo",
      uf: "SP",
      responsavelUid: "u-gui",
    });
    expect(cadastroDoDocumento("só-id", { name: "Sem código" })?.code).toBe("só-id");
  });

  it("prospect desde: a troca de estágio e, sem ela, a criação", () => {
    expect(desdeQuando({ stage: "prospect", stage_changed_at: { toDate: () => new Date(2026, 9, 21) } })).toBe("10/2026");
    expect(desdeQuando({ stage: "prospect", created_at: new Date(2024, 0, 5) })).toBe("01/2024");
    expect(desdeQuando({ stage: "prospect", created_at: "2025-03-10T12:00:00.000Z" })).toBe("03/2025");
    expect(desdeQuando({ stage: "prospect" })).toBeNull();
  });

  it("cliente desde: só quando o Comercial marcou como cliente; a data do registro não é o início da relação", () => {
    expect(desdeQuando({ stage: "cliente", stage_changed_at: new Date(2026, 9, 21), created_at: new Date(2026, 8, 1) })).toBe("10/2026");
    // Cadastro do WMS (sem stage) ou cliente sem a troca registrada: o sistema não sabe desde quando.
    expect(desdeQuando({ created_at: new Date(2026, 9, 2) })).toBeNull();
    expect(desdeQuando({ stage: "cliente", created_at: new Date(2026, 9, 2) })).toBeNull();
  });
});

describe("segmentos e busca", () => {
  it("contagem de Todos, Clientes e Prospects, sem os arquivados", () => {
    expect(contarSegmentos(CADASTROS)).toEqual({ todos: 5, clientes: 3, prospects: 2 });
  });

  it("Todos: clientes e prospects em grupos, por nome", () => {
    const { clientes, prospects } = filtrarCadastros(CADASTROS, "todos", "");
    expect(nomes(clientes)).toEqual(["Banco Safra", LEGACY_CUSTOMER_CODE, "Itaú Unibanco"]);
    expect(nomes(prospects)).toEqual(["Grupo SBF", "Vértice Engenharia"]);
  });

  it("Clientes e Prospects mostram só o grupo deles", () => {
    expect(filtrarCadastros(CADASTROS, "clientes", "").prospects).toEqual([]);
    expect(nomes(filtrarCadastros(CADASTROS, "clientes", "").clientes)).toHaveLength(3);
    expect(filtrarCadastros(CADASTROS, "prospects", "").clientes).toEqual([]);
    expect(nomes(filtrarCadastros(CADASTROS, "prospects", "").prospects)).toEqual(["Grupo SBF", "Vértice Engenharia"]);
  });

  it("busca por nome sem acento nem maiúscula, e pela razão social", () => {
    expect(nomes(filtrarCadastros(CADASTROS, "todos", "itau").clientes)).toEqual(["Itaú Unibanco"]);
    expect(nomes(filtrarCadastros(CADASTROS, "todos", "  VERTICE ").prospects)).toEqual(["Vértice Engenharia"]);
    expect(nomes(filtrarCadastros(CADASTROS, "todos", "banco btg").clientes)).toEqual([LEGACY_CUSTOMER_CODE]);
  });

  it("busca pelo CNPJ com ou sem máscara; um algarismo só não busca CNPJ", () => {
    expect(nomes(filtrarCadastros(CADASTROS, "todos", "11.222.333").clientes)).toEqual(["Itaú Unibanco"]);
    expect(nomes(filtrarCadastros(CADASTROS, "todos", "12345678000195").clientes)).toEqual([LEGACY_CUSTOMER_CODE]);
    const um = filtrarCadastros(CADASTROS, "todos", "6");
    expect([...um.clientes, ...um.prospects]).toEqual([]);
  });

  it("a busca respeita o segmento e não mexe na contagem", () => {
    expect(filtrarCadastros(CADASTROS, "prospects", "itau")).toEqual({ clientes: [], prospects: [] });
    expect(contarSegmentos(CADASTROS).todos).toBe(5);
  });
});

describe("apresentação", () => {
  it("iniciais: primeira letra das duas primeiras palavras, sem conectivo", () => {
    expect(iniciais("Itaú Unibanco")).toBe("IU");
    expect(iniciais("Banco do Brasil")).toBe("BB");
    expect(iniciais("Andrade & Lemos Advocacia")).toBe("AL");
    expect(iniciais("Bradesco")).toBe("BR");
    expect(iniciais("Ômega")).toBe("OM");
    expect(iniciais("  ")).toBe("?");
  });

  it("CNPJ com máscara; texto que não é CNPJ fica como está", () => {
    expect(formatarCnpj("11222333000181")).toBe("11.222.333/0001-81");
    expect(formatarCnpj("11.222.333/0001-81")).toBe("11.222.333/0001-81");
    expect(formatarCnpj("12ABC34501DE35")).toBe("12.ABC.345/01DE-35");
    expect(formatarCnpj("123")).toBe("123");
    expect(formatarCnpj(null)).toBe("");
  });

  it("telefone gravado só com algarismos ganha máscara; outro formato fica como está", () => {
    expect(formatarTelefone("11999990000")).toBe("(11) 99999-0000");
    expect(formatarTelefone("1133334444")).toBe("(11) 3333-4444");
    expect(formatarTelefone("+5511999990000")).toBe("+5511999990000");
    expect(formatarTelefone(null)).toBe("");
  });

  it("endereço em uma linha, sem as partes vazias", () => {
    expect(
      enderecoEmLinha({ logradouro: "Av. Paulista", numero: "2100", complemento: "5º andar", bairro: "Bela Vista", cidade: "São Paulo", uf: "SP", cep: "01310-100" }),
    ).toBe("Av. Paulista, 2100, 5º andar · Bela Vista · São Paulo/SP · 01310-100");
    expect(enderecoEmLinha({ logradouro: "R. Funchal", numero: null, bairro: null, cidade: null, uf: "SP", cep: null })).toBe("R. Funchal · SP");
    expect(enderecoEmLinha(null)).toBe("");
  });
});

const CONTRATOS: ContratoResumo[] = [
  ["ct-itau-2021", { customer_code: "ITAU-UNIBANCO", nome: "RFQ 2021", vigente_de: "2021-07-01", vigente_ate: "2023-06-30", status: "encerrado" }],
  ["ct-itau", { customer_code: "ITAU-UNIBANCO", nome: "Contrato Itaú", numeros: [{ tipo: "contrato", numero: "CT-123" }], vigente_de: "2025-07-01", vigente_ate: "2027-06-30", status: "vigente" }],
  ["ct-btg", { customer_code: LEGACY_CUSTOMER_CODE, nome: "Armazenagem BTG", vigente_de: "2024-07-01", vigente_ate: null, status: "vigente" }],
  ["ct-safra", { customer_code: "BANCO-SAFRA", nome: "Safra", vigente_de: "2026-11-01", vigente_ate: "2027-10-31", status: "vigente" }],
  ["ct-vencido", { customer_code: "BANCO-SAFRA", nome: "Safra antigo", vigente_de: "2025-01-01", vigente_ate: "2026-10-01", status: "vigente" }],
]
  .map(([id, data]) => contratoDoDocumento(id as string, data as Record<string, unknown>))
  .filter((contrato): contrato is ContratoResumo => contrato !== null);

describe("contratos do cliente", () => {
  const HOJE = "2026-10-21";

  it("vigente: status vigente e hoje dentro da vigência (sem fim, vale até ser encerrado)", () => {
    expect(contratoVigente(CONTRATOS, "ITAU-UNIBANCO", HOJE)?.id).toBe("ct-itau");
    expect(contratoVigente(CONTRATOS, LEGACY_CUSTOMER_CODE, HOJE)?.id).toBe("ct-btg");
  });

  it("contrato que ainda não começou ou que já venceu não é vigente", () => {
    expect(contratoVigente(CONTRATOS, "BANCO-SAFRA", HOJE)).toBeNull();
    expect(contratoVigente(CONTRATOS, "GRUPO-SBF", HOJE)).toBeNull();
  });

  it("rótulo da lista: o fim da vigência, sem prazo ou Sem contrato", () => {
    expect(rotuloDoContrato(contratoVigente(CONTRATOS, "ITAU-UNIBANCO", HOJE))).toBe("Contrato até 30/06/2027");
    expect(rotuloDoContrato(contratoVigente(CONTRATOS, LEGACY_CUSTOMER_CODE, HOJE))).toBe("Contrato sem prazo");
    expect(rotuloDoContrato(null)).toBe("Sem contrato");
  });

  it("aba Contratos: todos os do cliente, o mais novo primeiro, com a vigência", () => {
    const itau = contratosDoCliente(CONTRATOS, "ITAU-UNIBANCO");
    expect(itau.map((contrato) => contrato.id)).toEqual(["ct-itau", "ct-itau-2021"]);
    expect(itau.map(vigenciaDoContrato)).toEqual(["01/07/2025 a 30/06/2027", "01/07/2021 a 30/06/2023"]);
    expect(vigenciaDoContrato(contratosDoCliente(CONTRATOS, LEGACY_CUSTOMER_CODE)[0])).toBe("Desde 01/07/2024");
    expect(itau[0].numeros).toEqual(["CT-123"]);
  });

  it("situação de hoje: vigente, a iniciar, vencido ou encerrado", () => {
    const situacao = (id: string) => situacaoDoContrato(CONTRATOS.find((contrato) => contrato.id === id)!, HOJE);
    expect(["ct-itau", "ct-btg", "ct-safra", "ct-vencido", "ct-itau-2021"].map(situacao)).toEqual([
      "Vigente",
      "Vigente",
      "A iniciar",
      "Vencido",
      "Encerrado",
    ]);
  });

  it("documento sem cliente ou sem início de vigência não entra", () => {
    expect(contratoDoDocumento("x", { nome: "Sem cliente", vigente_de: "2025-01-01", status: "vigente" })).toBeNull();
    expect(contratoDoDocumento("x", { customer_code: "X", status: "vigente" })).toBeNull();
  });
});

describe("contatos agrupados por empresa", () => {
  const contatos = [
    ["c1", { customer_code: "ITAU-UNIBANCO", nome: "Renata Okubo", papel: "gestor_cliente", empresa: null, email: "renata@itau.com.br" }],
    ["c2", { customer_code: "ITAU-UNIBANCO", nome: "Camila Duarte", papel: "gerenciadora", empresa: "Souza & Lopes", telefone: "11999990000" }],
    ["c3", { customer_code: "ITAU-UNIBANCO", nome: "Marcos Teixeira", papel: "financeiro", empresa: "Itaú Unibanco" }],
    ["c4", { customer_code: "ITAU-UNIBANCO", nome: "Otávio Nunes", papel: "gerenciadora", empresa: "MGE", ativo: false }],
    ["c5", { customer_code: "ITAU-UNIBANCO", nome: "Bianca Rocha", papel: "outro", empresa: "mge" }],
  ].map(([id, data]) => contatoDoDocumento(id as string, data as Record<string, unknown>)!);

  const ITAU = { nome: "Itaú Unibanco", razaoSocial: "Itaú Unibanco S.A." };
  const resumo = (lista: ContatoResumo[]) =>
    gruposDeContatos(lista, ITAU).map((grupo) => [grupo.empresa, grupo.tipo, grupo.pessoas.map((pessoa) => pessoa.nome)]);
  const contato = (id: string, data: Record<string, unknown>) =>
    contatoDoDocumento(id, { customer_code: "ITAU-UNIBANCO", ...data })!;

  it("a empresa do cliente primeiro (sem empresa conta como do cliente), depois as gerenciadoras por nome", () => {
    const grupos = gruposDeContatos(contatos, ITAU);
    expect(grupos.map((grupo) => [grupo.empresa, grupo.tipo, grupo.pessoas.map((pessoa) => pessoa.nome)])).toEqual([
      ["Itaú Unibanco", "Cliente", ["Marcos Teixeira", "Renata Okubo"]],
      ["MGE", "Gerenciadora", ["Bianca Rocha", "Otávio Nunes"]],
      ["Souza & Lopes", "Gerenciadora", ["Camila Duarte"]],
    ]);
  });

  it("empresa abreviada ou com a razão social é do cliente", () => {
    expect(
      resumo([
        contato("a", { nome: "Ana", papel: "gestor_cliente", empresa: "Itaú" }),
        contato("b", { nome: "Bruno", papel: "financeiro", empresa: "Itaú Unibanco S.A." }),
        contato("c", { nome: "Carla", papel: "gestor_cliente", empresa: null }),
      ]),
    ).toEqual([["Itaú Unibanco", "Cliente", ["Ana", "Bruno", "Carla"]]]);
  });

  it("contato com papel de gerenciadora nunca fica no grupo do cliente", () => {
    expect(
      resumo([
        contato("a", { nome: "Ana", papel: "gestor_cliente" }),
        contato("b", { nome: "Bruno", papel: "gerenciadora", empresa: null }),
      ]),
    ).toEqual([
      ["Itaú Unibanco", "Cliente", ["Ana"]],
      ["Sem empresa", "Gerenciadora", ["Bruno"]],
    ]);
  });

  it("a mesma gerenciadora escrita de jeitos diferentes fica num grupo só", () => {
    expect(
      resumo([
        contato("a", { nome: "Ana", papel: "gerenciadora", empresa: "Souza & Lopes" }),
        contato("b", { nome: "Bruno", papel: "gerenciadora", empresa: "Souza e Lopes" }),
        contato("c", { nome: "Carla", papel: "gerenciadora", empresa: "SOUZA & LOPES LTDA" }),
      ]),
    ).toEqual([["Souza & Lopes", "Gerenciadora", ["Ana", "Bruno", "Carla"]]]);
  });

  it("sugestões do campo Empresa: o cliente e as gerenciadoras de todos os clientes, sem repetir", () => {
    const todos = [
      contatoDoDocumento("x1", { customer_code: "BANCO-SAFRA", nome: "Davi", papel: "gestor_cliente", empresa: "Banco Safra" })!,
      contatoDoDocumento("x2", { customer_code: "BANCO-SAFRA", nome: "Eva", papel: "gerenciadora", empresa: "Souza e Lopes" })!,
      contatoDoDocumento("x3", { customer_code: "GRUPO-SBF", nome: "Fábio", papel: "gerenciadora", empresa: "MGE" })!,
      contatoDoDocumento("x4", { customer_code: "ITAU-UNIBANCO", nome: "Gil", papel: "gerenciadora", empresa: "Souza & Lopes" })!,
      contatoDoDocumento("x5", { customer_code: "ITAU-UNIBANCO", nome: "Hugo", papel: "financeiro", empresa: "Itaú" })!,
    ];
    const itau = CADASTROS.find((cadastro) => cadastro.id === "ITAU-UNIBANCO")!;
    expect(empresasSugeridas(todos, CADASTROS, itau)).toEqual(["Itaú Unibanco", "MGE", "Souza & Lopes"]);
  });

  it("papel com rótulo e o inativo marcado", () => {
    const otavio = contatos.find((contato) => contato.id === "c4")!;
    expect(otavio).toMatchObject({ ativo: false, papel: "gerenciadora", papelRotulo: "Gerenciadora" });
    expect(contatos.find((contato) => contato.id === "c1")).toMatchObject({ ativo: true, papelRotulo: "Gestor do cliente" });
  });

  it("local lido do Firestore, ativo por padrão", () => {
    expect(localDoDocumento("l1", { customer_code: "X", nome: "Sede", sigla: "SEDE", endereco: null })).toMatchObject({
      id: "l1",
      nome: "Sede",
      sigla: "SEDE",
      ativo: true,
      endereco: null,
    });
  });
});

describe("nome parecido antes de criar", () => {
  it("acha o mesmo nome sem acento, sem sufixo societário, contido ou com palavra própria em comum", () => {
    expect(nomes(nomesParecidos("itau", CADASTROS))).toEqual(["Itaú Unibanco"]);
    expect(nomes(nomesParecidos("Banco Safra S.A.", CADASTROS))).toEqual(["Banco Safra"]);
    expect(nomes(nomesParecidos("Itaú Seguros", CADASTROS))).toEqual(["Itaú Unibanco"]);
    expect(nomes(nomesParecidos("Grupo SBF Ltda", CADASTROS))).toEqual(["Grupo SBF"]);
  });

  it("palavra genérica não basta e nome curto demais não compara", () => {
    expect(nomesParecidos("Banco Inter", CADASTROS)).toEqual([]);
    expect(nomesParecidos("SB", CADASTROS)).toEqual([]);
    expect(nomesParecidos("", CADASTROS)).toEqual([]);
  });
});

describe("listas iguais às da callable", () => {
  const cadastro = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), "../../../../../functions/comercial/src/domain/cadastro.ts"),
    "utf8",
  );
  const lista = (name: string) => {
    const match = cadastro.match(new RegExp(`export const ${name} = \\[([^\\]]*)\\]`));
    if (!match) throw new Error(`${name} não encontrado`);
    return [...match[1].matchAll(/"([^"]+)"/g)].map((item) => item[1]);
  };

  it("UFs e papéis do contato", () => {
    expect([...UFS]).toEqual(lista("UFS"));
    expect([...PAPEIS_DO_CONTATO]).toEqual(lista("PAPEIS_CONTATO"));
  });
});

describe("chamadas das callables (functions/comercial, entrada .strict())", () => {
  const itau = CADASTROS.find((cadastro) => cadastro.id === "ITAU-UNIBANCO")!;
  const btg = CADASTROS.find((cadastro) => cadastro.id === "BTG_Pactual")!;
  const sbf = CADASTROS.find((cadastro) => cadastro.id === "GRUPO-SBF")!;

  it("código: vazio deixa o servidor sugerir; fora do formato é recusado antes", () => {
    expect(problemaDoCodigo("ITAU-UNIBANCO")).toBeNull();
    expect(problemaDoCodigo("")).toBeNull();
    expect(problemaDoCodigo("ITAÚ")).toMatch(/letras sem acento/);
    expect(problemaDoCodigo("-ITAU")).toMatch(/letras sem acento/);
  });

  it("novo prospect: só o que foi preenchido, cidade e UF no mapa comercial", () => {
    expect(
      payloadNovoProspect({ nome: " Grupo SBF ", codigo: "grupo-sbf", cnpj: "", cidade: "São Paulo", uf: "SP" }, "k1"),
    ).toEqual({
      action: "create",
      idempotency_key: "k1",
      name: "Grupo SBF",
      code: "GRUPO-SBF",
      comercial: { cidade: "São Paulo", uf: "SP" },
    });
    expect(payloadNovoProspect({ nome: "Vértice", codigo: "", cnpj: "11.222.333/0001-81", cidade: "", uf: "" }, "k2")).toEqual({
      action: "create",
      idempotency_key: "k2",
      name: "Vértice",
      document: "11.222.333/0001-81",
      comercial: { cidade: null, uf: null },
    });
  });

  it("edição manda só o que mudou desde a abertura: o resto o servidor mantém", () => {
    const aberto = formDaEdicao(itau);
    expect(aberto).toEqual({ nome: "Itaú Unibanco", razaoSocial: "Itaú Unibanco S.A.", cnpj: "11222333000181", cidade: "São Paulo", uf: "SP" });
    const base = { action: "update", idempotency_key: "k3", customer_code: "ITAU-UNIBANCO" };
    expect(payloadEdicao(itau, aberto, "k3")).toEqual(base);
    expect(payloadEdicao(itau, { ...aberto, cidade: "Osasco" }, "k3")).toEqual({ ...base, comercial: { cidade: "Osasco" } });
    expect(payloadEdicao(itau, { ...aberto, nome: "Itaú", razaoSocial: " " }, "k3")).toEqual({
      ...base,
      name: "Itaú",
      legal_name: null,
    });
    expect(payloadEdicao(itau, { ...aberto, cnpj: "11.222.333/0001-81 " }, "k3")).toEqual({ ...base, document: "11.222.333/0001-81" });
  });

  it("edição com armazenagem: só cidade e UF, mesmo que a identidade chegue mudada", () => {
    const form = { nome: "Outro", razaoSocial: "Outra S.A.", cnpj: "11222333000181", cidade: "Osasco", uf: "SP" };
    expect(payloadEdicao(btg, form, "k4")).toEqual({
      action: "update",
      idempotency_key: "k4",
      customer_code: LEGACY_CUSTOMER_CODE,
      comercial: { cidade: "Osasco", uf: "SP" },
    });
  });

  it("aviso da identidade com armazenagem: owner e admin vão a Configurações › Clientes; o comercial sabe quem edita", () => {
    for (const role of ["owner", "admin"]) {
      expect(avisoDaIdentidade(role)).toEqual({
        texto: "Nome, razão social e CNPJ deste cadastro se editam em",
        link: { href: "/configuracoes/clientes", rotulo: "Configurações › Clientes" },
      });
    }
    expect(avisoDaIdentidade("comercial")).toEqual({
      texto: "Nome, razão social e CNPJ deste cadastro só o owner ou o admin editam, em Configurações › Clientes.",
      link: null,
    });
  });

  it("marcar como cliente vai pelo código do cadastro", () => {
    expect(payloadMarcarCliente(sbf, "k5")).toEqual({ action: "mark_client", idempotency_key: "k5", customer_code: "GRUPO-SBF" });
  });

  it("local: endereço vazio vira null; alteração leva o id", () => {
    const vazio = { nome: "Sede", sigla: "", logradouro: "", numero: "", complemento: "", bairro: "", cidade: "", uf: "", cep: "" };
    expect(payloadLocal("GRUPO-SBF", vazio, "k6")).toEqual({
      idempotency_key: "k6",
      customer_code: "GRUPO-SBF",
      nome: "Sede",
      sigla: null,
      endereco: null,
    });
    expect(payloadLocal("GRUPO-SBF", { ...vazio, sigla: "sede", logradouro: "Av. Dra. Ruth Cardoso", numero: "7221", uf: "SP" }, "k7")).toEqual({
      idempotency_key: "k7",
      customer_code: "GRUPO-SBF",
      nome: "Sede",
      sigla: "SEDE",
      endereco: { logradouro: "Av. Dra. Ruth Cardoso", numero: "7221", complemento: null, bairro: null, cidade: null, uf: "SP", cep: null },
    });
  });

  it("alteração de local manda o id, o nome (obrigatório) e só o que mudou desde a abertura", () => {
    const sede: LocalResumo = {
      id: "loc_1",
      nome: "Sede",
      sigla: "SEDE",
      endereco: { logradouro: "Av. Dra. Ruth Cardoso", numero: "7221", complemento: null, bairro: "Pinheiros", cidade: "São Paulo", uf: "SP", cep: "05425-070" },
      ativo: true,
    };
    const aberto = formDoLocal(sede);
    const base = { idempotency_key: "k12", customer_code: "GRUPO-SBF", local_id: "loc_1", nome: "Sede" };
    expect(payloadLocal("GRUPO-SBF", aberto, "k12", sede)).toEqual(base);
    expect(payloadLocal("GRUPO-SBF", { ...aberto, numero: "7221A", sigla: "sp" }, "k12", sede)).toEqual({
      ...base,
      sigla: "SP",
      endereco: { numero: "7221A" },
    });
    const semEndereco = { ...aberto, logradouro: "", numero: "", bairro: "", cidade: "", uf: "", cep: "" };
    expect(payloadLocal("GRUPO-SBF", semEndereco, "k12", sede)).toEqual({ ...base, endereco: null });
  });

  it("contato: vazio vira null e o papel padrão é outro", () => {
    expect(payloadContato("ITAU-UNIBANCO", { nome: "Renata", empresa: "", papel: "", email: "", telefone: "", avisos: [] }, "k8")).toEqual({
      idempotency_key: "k8",
      customer_code: "ITAU-UNIBANCO",
      nome: "Renata",
      email: null,
      telefone: null,
      empresa: null,
      papel: "outro",
      avisos: [],
    });
    expect(
      payloadContato(
        "ITAU-UNIBANCO",
        { nome: "Camila", empresa: "Souza & Lopes", papel: "gerenciadora", email: "c@sl.com", telefone: "11 99999-0000", avisos: ["os_agendada"] },
        "k9",
      ),
    ).toEqual({
      idempotency_key: "k9",
      customer_code: "ITAU-UNIBANCO",
      nome: "Camila",
      email: "c@sl.com",
      telefone: "11 99999-0000",
      empresa: "Souza & Lopes",
      papel: "gerenciadora",
      avisos: ["os_agendada"],
    });
  });

  it("avisos por e-mail (parte 4.6b): nenhum sem e-mail; a NF só para o gestor e o financeiro do cliente", () => {
    const vazio = formDoContato(null);
    expect(avisosOferecidos(vazio)).toEqual([]);
    expect(avisosOferecidos({ email: "r@itau.com", papel: "gestor_cliente" })).toEqual(["os_agendada", "os_iniciada", "os_concluida", "nf_emitida", "pedido_do_portal"]);
    expect(avisosOferecidos({ email: "r@itau.com", papel: "financeiro" })).toContain("nf_emitida");
    for (const papel of ["gerenciadora", "outro", ""]) expect(avisosOferecidos({ email: "c@sl.com", papel })).not.toContain("nf_emitida");

    let form = marcarAviso({ ...vazio, nome: "Renata", email: "r@itau.com", papel: "gestor_cliente" }, "nf_emitida", true);
    form = marcarAviso(form, "os_agendada", true);
    expect(form.avisos).toEqual(["os_agendada", "nf_emitida"]);
    expect(marcarAviso(form, "nf_emitida", false).avisos).toEqual(["os_agendada"]);
    // O que deixou de valer sai ao salvar: sem e-mail, nenhum; como gerenciadora, sem a NF.
    expect(avisosDoFormulario({ ...form, email: "" })).toEqual([]);
    expect(avisosDoFormulario({ ...form, papel: "gerenciadora" })).toEqual(["os_agendada"]);
    expect(payloadContato("ITAU-UNIBANCO", { ...form, papel: "gerenciadora" }, "k14").avisos).toEqual(["os_agendada"]);
  });

  it("alteração de contato manda os avisos só quando mudam", () => {
    const renata = contatoDoDocumento("ct_2", { customer_code: "ITAU-UNIBANCO", nome: "Renata", email: "r@itau.com", papel: "gestor_cliente", avisos: ["nf_emitida", "os_agendada", "x"] })!;
    expect(renata.avisos).toEqual(["os_agendada", "nf_emitida"]);
    const aberto = formDoContato(renata);
    const base = { idempotency_key: "k15", customer_code: "ITAU-UNIBANCO", contato_id: "ct_2", nome: "Renata" };
    expect(payloadContato("ITAU-UNIBANCO", aberto, "k15", renata)).toEqual(base);
    expect(payloadContato("ITAU-UNIBANCO", marcarAviso(aberto, "os_concluida", true), "k15", renata)).toEqual({ ...base, avisos: ["os_agendada", "os_concluida", "nf_emitida"] });
    expect(payloadContato("ITAU-UNIBANCO", { ...aberto, papel: "gerenciadora" }, "k15", renata)).toEqual({ ...base, papel: "gerenciadora", avisos: ["os_agendada"] });
    expect(payloadContato("ITAU-UNIBANCO", { ...aberto, email: "" }, "k15", renata)).toEqual({ ...base, email: null, avisos: [] });
    expect(contatoDoDocumento("ct_3", { nome: "Sem avisos" })!.avisos).toEqual([]);
  });

  it("alteração de contato manda o id, o nome (obrigatório) e só o que mudou desde a abertura", () => {
    const camila = contatoDoDocumento("ct_1", {
      customer_code: "ITAU-UNIBANCO",
      nome: "Camila",
      email: "c@sl.com",
      telefone: "11999990000",
      empresa: "Souza & Lopes",
      papel: "gerenciadora",
    })!;
    const aberto = formDoContato(camila);
    const base = { idempotency_key: "k13", customer_code: "ITAU-UNIBANCO", contato_id: "ct_1", nome: "Camila" };
    expect(payloadContato("ITAU-UNIBANCO", aberto, "k13", camila)).toEqual(base);
    expect(payloadContato("ITAU-UNIBANCO", { ...aberto, email: "", papel: "financeiro" }, "k13", camila)).toEqual({
      ...base,
      email: null,
      papel: "financeiro",
    });
  });

  it("desativar e reativar mandam o nome atual (obrigatório na callable) e o novo estado", () => {
    expect(payloadAtivoLocal("GRUPO-SBF", { id: "loc_1", nome: "Sede" }, false, "k10")).toEqual({
      idempotency_key: "k10",
      customer_code: "GRUPO-SBF",
      local_id: "loc_1",
      nome: "Sede",
      ativo: false,
    });
    expect(payloadAtivoContato("GRUPO-SBF", { id: "ct_1", nome: "Aline" }, true, "k11")).toEqual({
      idempotency_key: "k11",
      customer_code: "GRUPO-SBF",
      contato_id: "ct_1",
      nome: "Aline",
      ativo: true,
    });
  });
});
