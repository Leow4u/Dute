import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

import {
  COLUNAS_DA_REVISAO,
  ErroDeUso,
  RAIZ_DO_REPOSITORIO,
  comecoComum,
  contaDeTeste,
  csvDeRevisao,
  lerCodigos,
  lerFontes,
  lerOpcoes,
  main,
  montarEntradas,
  planejar,
  validarFontes,
  type CadastroExistente,
  type FontesOmie,
} from "./clientes-omie.js";
import { lerCsv } from "./csv.js";

/**
 * Carga dos clientes da Omie sem banco, com dado sintético: argumentos
 * (projeto obrigatório para gravar, arquivos fora do repositório), o que
 * entra (pessoa jurídica com a tag Cliente e as empresas do CRM; pessoa
 * física, conta de teste e fornecedor ficam fora), filiais num cadastro só
 * pela raiz do CNPJ, cliente ou prospect pela data da compra, o cadastro que
 * já existe só ganha omie_ids, e o CSV de revisão com a coluna de código.
 */

// --- Dado sintético -----------------------------------------------------------

/** Dígito verificador do CNPJ (o mesmo cálculo de customer-identity.ts). */
function dv(base: string): number {
  let peso = 2;
  let soma = 0;
  for (let index = base.length - 1; index >= 0; index -= 1) {
    soma += (base.charCodeAt(index) - 48) * peso;
    peso = peso === 9 ? 2 : peso + 1;
  }
  const resto = soma % 11;
  return resto < 2 ? 0 : 11 - resto;
}

/** CNPJ válido, com máscara, a partir da raiz e da ordem da filial. */
function cnpj(raiz: string, ordem = "0001"): string {
  const base = `${raiz}${ordem}`;
  const primeiro = dv(base);
  const numero = `${base}${primeiro}${dv(`${base}${primeiro}`)}`;
  return `${numero.slice(0, 2)}.${numero.slice(2, 5)}.${numero.slice(5, 8)}/${numero.slice(8, 12)}-${numero.slice(12)}`;
}

const semMascara = (valor: string) => valor.replace(/\D/g, "");

/** CPF de exemplo (válido no formato), só para provar que pessoa física fica fora. */
const CPF = "111.444.777-35";

function cliente(id: number, dados: Record<string, unknown>): Record<string, unknown> {
  return {
    codigo_cliente_omie: id,
    codigo_cliente_integracao: "",
    cnpj_cpf: "",
    pessoa_fisica: "N",
    razao_social: "",
    nome_fantasia: "",
    cidade: "SAO PAULO (SP)",
    estado: "SP",
    inativo: "N",
    tags: [{ tag: "Cliente" }],
    // O que nunca pode chegar ao cadastro nem ao relatório.
    email: "contato.sintetico@exemplo.com.br",
    telefone1_ddd: "11",
    telefone1_numero: "90000-1234",
    contato: "Pessoa Sintética de Contato",
    dadosBancarios: { agencia: "0001", conta_corrente: "12345-6", cChavePix: "pix-sintetico" },
    ...dados,
  };
}

function contaCrm(nCod: number, cNome: string, cDoc = ""): Record<string, unknown> {
  return {
    identificacao: { nCod, cNome, cNomeFantasia: "", cDoc, cObs: "Observação sintética que não pode ser gravada.", cCodInt: `CLI-${nCod}` },
    endereco: { cCidade: "Campinas", cUF: "SP" },
    telefone_email: { cEmail: "crm.sintetico@exemplo.com.br", cNumTel: "3000-0000", cDDDTel: "19" },
    tags: [],
    caracteristicas: [],
  };
}

function titulo(cliente: number, data: string, status = "RECEBIDO"): Record<string, unknown> {
  return {
    codigo_cliente_fornecedor: cliente,
    data_emissao: data,
    status_titulo: status,
    valor_documento: 1234.56,
    observacao: "Observação sintética do título.",
  };
}

const RAIZ_ALFA = "11111111";
const RAIZ_DELTA = "44444444";
const RAIZ_BETA = "55555555";
const RAIZ_BTG = "66666666";

function brutoSintetico() {
  return {
    clientes: [
      // Alfa: três CNPJs da mesma raiz; a matriz (0001) vem no meio do arquivo.
      // O nome fantasia de cada CNPJ é o do polo, inclusive o da matriz.
      cliente(101, { cnpj_cpf: cnpj(RAIZ_ALFA, "0002"), razao_social: "ALFA CONSTRUTORA LTDA", nome_fantasia: "ALFA FILIAL CAMPINAS" }),
      cliente(102, { cnpj_cpf: cnpj(RAIZ_ALFA, "0001"), razao_social: "ALFA CONSTRUTORA LTDA", nome_fantasia: "ALFA SEDE PAULISTA" }),
      cliente(103, {
        cnpj_cpf: cnpj(RAIZ_ALFA, "0003"),
        razao_social: "ALFA CONSTRUTORA LTDA",
        nome_fantasia: "ALFA RJ",
        tags: [{ tag: "Cliente" }, { tag: "Fornecedor" }],
      }),
      // Pessoa física: pela marca e pelo documento (marca errada na Omie).
      cliente(201, { cnpj_cpf: CPF, pessoa_fisica: "S", razao_social: "MARIA SINTETICA DA SILVA", nome_fantasia: "MARIA SINTETICA" }),
      cliente(202, { cnpj_cpf: CPF, pessoa_fisica: "N", razao_social: "JOSE SINTETICO", nome_fantasia: "JOSE SINTETICO" }),
      // Conta de teste.
      cliente(301, { cnpj_cpf: cnpj("33333333"), razao_social: "EMPRESA TESTE", nome_fantasia: "TESTE" }),
      // Fornecedor (sem a tag Cliente): fica fora, mas a compra pela raiz conta para o CRM.
      cliente(401, { cnpj_cpf: cnpj(RAIZ_DELTA, "0002"), razao_social: "DELTA COMERCIO LTDA", nome_fantasia: "DELTA", tags: [{ tag: "Fornecedor" }] }),
      cliente(501, { cnpj_cpf: cnpj(RAIZ_BETA), razao_social: "BETA SERVICOS S.A.", nome_fantasia: "BETA SERVICOS", cidade: "RIO DE JANEIRO (RJ)", estado: "RJ" }),
      // CNPJ com dígito errado.
      cliente(601, { cnpj_cpf: "12.345.678/0001-00", razao_social: "SEM DOCUMENTO LTDA", nome_fantasia: "SEM DOCUMENTO" }),
    ],
    crm: [
      contaCrm(9001, "Gama Engenharia"),
      contaCrm(9002, "testexyz"),
      contaCrm(9003, "Pessoa Sintética do CRM", CPF),
      contaCrm(9004, "Alfa Construtora Ltda", cnpj(RAIZ_ALFA, "0001")),
      contaCrm(9005, "Delta Comércio Ltda", cnpj(RAIZ_DELTA, "0001")),
    ],
    titulos: [
      // Compra na filial da Alfa, em 2024: a raiz toda é cliente, desde a
      // primeira compra, na matriz, em 2021.
      titulo(101, "15/03/2024"),
      titulo(102, "29/09/2021"),
      // Beta: a última compra válida é de 2023; a de 2025 foi cancelada.
      titulo(501, "31/12/2023"),
      titulo(501, "10/01/2025", "CANCELADO"),
      // Delta comprou como o CNPJ do fornecedor 401: a raiz é a chave.
      titulo(401, "10/05/2025", "A VENCER"),
      // Pessoa física e cadastro que não está no arquivo não contam.
      titulo(201, "01/02/2025"),
      titulo(999, "01/02/2025"),
    ],
  };
}

let pasta: string;
let arquivos: { clientes: string; crm: string; titulos: string };

function salvar(nome: string, json: unknown): string {
  const caminho = join(pasta, nome);
  writeFileSync(caminho, JSON.stringify(json), "utf8");
  return caminho;
}

/** Valida o dado sintético como a carga valida os arquivos. */
function fontesDe(bruto: { clientes: unknown; crm: unknown; titulos: unknown }): FontesOmie {
  const { fontes: lidas, problemas } = validarFontes(bruto);
  assert.deepEqual(problemas, []);
  assert.ok(lidas);
  return lidas;
}

function fontes(): FontesOmie {
  const { fontes: lidas, problemas } = lerFontes(arquivos);
  assert.deepEqual(problemas, []);
  assert.ok(lidas);
  return lidas;
}

before(() => {
  pasta = mkdtempSync(join(tmpdir(), "carga-clientes-omie-"));
  const bruto = brutoSintetico();
  arquivos = {
    clientes: salvar("clientes-completo.json", bruto.clientes),
    crm: salvar("crm-contas.json", bruto.crm),
    titulos: salvar("contas-receber-todas.json", bruto.titulos),
  };
});

after(() => {
  rmSync(pasta, { recursive: true, force: true });
});

function argumentos(...extra: string[]): string[] {
  return ["--clientes", arquivos.clientes, "--crm", arquivos.crm, "--titulos", arquivos.titulos, ...extra];
}

// --- Argumentos ------------------------------------------------------------------

describe("argumentos da carga de clientes da Omie", () => {
  it("dry-run por padrão, sem projeto, com o relatório em tmp/comercial", () => {
    const opcoes = lerOpcoes(argumentos());
    assert.equal(opcoes.executar, false);
    assert.equal(opcoes.projeto, null);
    assert.equal(opcoes.codigos, null);
    assert.equal(opcoes.clientes, arquivos.clientes);
    assert.equal(opcoes.relatorioDir, join(RAIZ_DO_REPOSITORIO, "tmp", "comercial"));
  });

  it("--executar sem --projeto é recusado", () => {
    assert.throws(
      () => lerOpcoes(argumentos("--executar")),
      (error: unknown) => error instanceof ErroDeUso && /--projeto é obrigatório com --executar/.test(error.message),
    );
    assert.throws(() => lerOpcoes(argumentos("--executar", "--projeto=")), ErroDeUso);
    assert.throws(() => lerOpcoes(argumentos("--executar", "--projeto", "--executar")), ErroDeUso);
  });

  it("--executar só onde o Comercial está liberado, ou no emulador; ler a produção pode", () => {
    assert.throws(
      () => lerOpcoes(argumentos("--executar", "--projeto", "dute-prod")),
      (error: unknown) => error instanceof ErroDeUso && /não está liberado em dute-prod/.test(error.message),
    );
    assert.equal(lerOpcoes(argumentos("--executar", "--projeto", "dute-homolog")).executar, true);
    assert.equal(lerOpcoes(argumentos("--executar", "--projeto=demo-dute-comercial")).projeto, "demo-dute-comercial");
    assert.equal(lerOpcoes(argumentos("--projeto", "dute-prod")).executar, false);
  });

  it("os arquivos da Omie e o CSV revisado ficam fora do repositório, ou em tmp/", () => {
    const raiz = join(pasta, "repo");
    const dentro = (caminho: string) => ["--clientes", caminho, "--crm", arquivos.crm, "--titulos", arquivos.titulos];
    assert.throws(
      () => lerOpcoes(dentro(join(raiz, "docs", "clientes.json")), raiz),
      (error: unknown) => error instanceof ErroDeUso && /--clientes: .*fora do repositório/.test(error.message),
    );
    assert.throws(() => lerOpcoes([...argumentos(), "--codigos", join(raiz, "revisado.csv")], raiz), /--codigos: /);
    assert.equal(lerOpcoes(dentro(join(raiz, "tmp", "omie", "clientes.json")), raiz).clientes, join(raiz, "tmp", "omie", "clientes.json"));
    assert.ok(lerOpcoes([...argumentos(), "--codigos", join(raiz, "tmp", "comercial", "revisado.csv")], raiz));
  });

  it("os três arquivos são obrigatórios; argumento desconhecido é erro de uso", () => {
    assert.throws(() => lerOpcoes(["--clientes", arquivos.clientes, "--crm", arquivos.crm]), /--titulos é obrigatório/);
    assert.throws(() => lerOpcoes(argumentos("--contatos", "x.json")), /Argumento desconhecido: --contatos/);
    assert.throws(() => lerOpcoes([...argumentos(), "--crm", arquivos.crm]), /--crm repetido/);
  });
});

// --- O que entra -------------------------------------------------------------------

describe("o que entra na carga", () => {
  it("pessoa física, conta de teste e fornecedor ficam fora; CNPJ inválido sai só com o id da Omie", () => {
    const montagem = montarEntradas(fontes());
    assert.deepEqual(
      montagem.entradas.map((entrada) => entrada.chave).sort(),
      ["cnpj-11111111", "cnpj-44444444", "cnpj-55555555", "crm-9001"],
    );
    assert.equal(montagem.fora.pessoa_fisica, 3, "201, 202 (CPF com a marca errada) e a conta 9003 do CRM");
    assert.equal(montagem.fora.teste, 2, "301 e a conta 9002 do CRM");
    assert.equal(montagem.fora.sem_tag_cliente, 1, "o fornecedor 401");
    assert.deepEqual(montagem.fora.documento_invalido, ["cliente:601"]);
    assert.equal(montagem.titulos_sem_cadastro, 1);
  });

  it("reconhece conta de teste pelo nome", () => {
    assert.equal(contaDeTeste("TESTE"), true);
    assert.equal(contaDeTeste("Empresa teste"), true);
    assert.equal(contaDeTeste("Testezinho Sintético Ltda"), true);
    assert.equal(contaDeTeste("Contestel Engenharia"), false);
    assert.equal(contaDeTeste("Celeste Serviços"), false);
  });

  it("filiais viram um cadastro só, pela raiz do CNPJ, com a razão social da matriz e os ids de todas", () => {
    const entradas = montarEntradas(fontes()).entradas;
    const alfa = entradas.find((entrada) => entrada.chave === "cnpj-11111111");
    assert.ok(alfa);
    // Com mais de um CNPJ, o nome fantasia é o do polo: o nome é a razão social.
    assert.equal(alfa.nome, "ALFA CONSTRUTORA LTDA");
    assert.equal(alfa.razao_social, "ALFA CONSTRUTORA LTDA");
    // Com um CNPJ só, o nome fantasia.
    assert.equal(entradas.find((entrada) => entrada.chave === "cnpj-55555555")?.nome, "BETA SERVICOS");
    assert.equal(alfa.cnpj, semMascara(cnpj(RAIZ_ALFA, "0001")));
    assert.equal(alfa.raiz, RAIZ_ALFA);
    assert.equal(alfa.filiais, 3);
    assert.deepEqual(alfa.omie_ids, ["cliente:101", "cliente:102", "cliente:103", "crm:9004"]);
    assert.equal(alfa.cidade, "SAO PAULO");
    assert.equal(alfa.uf, "SP");
  });

  it("grupo com o polo também na razão social: o nome e a razão social são o começo comum", () => {
    const [kappa] = montarEntradas(fontesDe({
      clientes: [
        cliente(901, { cnpj_cpf: cnpj("22222222", "0001"), razao_social: "KAPPA BANCO S.A. - SEDE", nome_fantasia: "KAPPA SEDE" }),
        cliente(902, { cnpj_cpf: cnpj("22222222", "0002"), razao_social: "KAPPA BANCO S.A. - POLO NORTE", nome_fantasia: "KAPPA POLO NORTE" }),
        cliente(903, { cnpj_cpf: cnpj("22222222", "0003"), razao_social: "Kappa Banco S.A. – Polo Sul", nome_fantasia: "KAPPA POLO SUL" }),
      ],
      crm: [],
      titulos: [],
    })).entradas;
    assert.equal(kappa.nome, "KAPPA BANCO S.A.");
    assert.equal(kappa.razao_social, "KAPPA BANCO S.A.");
    assert.equal(planejar([kappa], null, []).itens[0].customer_code, "KAPPA-BANCO");
    assert.equal(comecoComum(["OMEGA LTDA", "SIGMA LTDA"]), "", "sem começo comum, vale a razão social da matriz");
  });

  it("quem comprou desde 2024 (título não cancelado, pela raiz do CNPJ) é cliente; o resto, prospect", () => {
    const porChave = new Map(montarEntradas(fontes()).entradas.map((entrada) => [entrada.chave, entrada]));
    assert.equal(porChave.get("cnpj-11111111")?.estagio, "cliente", "compra na filial");
    assert.equal(porChave.get("cnpj-11111111")?.ultima_compra, "2024-03-15");
    assert.equal(porChave.get("cnpj-11111111")?.primeira_compra, "2021-09-29", "o cliente desde: a compra mais antiga da raiz");
    assert.equal(porChave.get("cnpj-44444444")?.estagio, "cliente", "compra no CNPJ do fornecedor, mesma raiz da conta do CRM");
    assert.equal(porChave.get("cnpj-55555555")?.estagio, "prospect", "última compra em 2023, a de 2025 cancelada");
    assert.equal(porChave.get("cnpj-55555555")?.ultima_compra, "2023-12-31");
    assert.equal(porChave.get("crm-9001")?.estagio, "prospect");
    assert.equal(porChave.get("crm-9001")?.cnpj, null);
  });

  it("arquivo fora do formato vira problema com o caminho, sem o valor", () => {
    const quebrado = salvar("clientes-quebrado.json", [{ codigo_cliente_omie: "abc", email: "x@y.z" }]);
    const datas = salvar("titulos-quebrado.json", [titulo(101, "2024-03-15")]);
    const { fontes: lidas, problemas } = lerFontes({ ...arquivos, clientes: quebrado, titulos: datas });
    assert.equal(lidas, null);
    assert.ok(problemas.some((problema) => /^clientes: 0\.codigo_cliente_omie: /.test(problema)), problemas.join(" | "));
    assert.ok(problemas.some((problema) => /^titulos: 0\.data_emissao: /.test(problema)), problemas.join(" | "));
    assert.ok(problemas.every((problema) => !problema.includes("x@y.z")));
  });
});

// --- Plano contra o cadastro ---------------------------------------------------------

function cadastro(id: string, data: Record<string, unknown>): CadastroExistente {
  return { id, data };
}

describe("plano contra o cadastro", () => {
  it("sem cadastro, cria cada um com o código sugerido e o estágio da compra, cliente desde a primeira compra", () => {
    const { itens, operacoes } = planejar(montarEntradas(fontes()).entradas, null, []);
    const alfa = itens.find((item) => item.chave === "cnpj-11111111");
    assert.equal(alfa?.acao, "criar");
    assert.equal(alfa?.customer_code, "ALFA-CONSTRUTORA");
    assert.equal(alfa?.estagio, "cliente");
    const criar = operacoes.find((operacao) => operacao.tipo === "criar" && operacao.item.chave === "cnpj-11111111");
    assert.ok(criar && criar.tipo === "criar");
    assert.equal(criar.estagio, "cliente");
    assert.equal(criar.documentId, "ALFA-CONSTRUTORA");
    assert.equal(criar.cliente_desde, "2021-09-29");
    const beta = operacoes.find((operacao) => operacao.tipo === "criar" && operacao.item.chave === "cnpj-55555555");
    assert.ok(beta && beta.tipo === "criar");
    assert.equal(beta.estagio, "prospect");
    assert.equal(beta.cliente_desde, null, "o prospect não é cliente desde a compra de 2023");
    assert.deepEqual(criar.dados, {
      code: "ALFA-CONSTRUTORA",
      name: "ALFA CONSTRUTORA LTDA",
      legal_name: "ALFA CONSTRUTORA LTDA",
      document: semMascara(cnpj(RAIZ_ALFA, "0001")),
      origem: "omie",
      comercial: {
        responsavel_uid: null,
        cidade: "SAO PAULO",
        uf: "SP",
        omie_ids: ["cliente:101", "cliente:102", "cliente:103", "crm:9004"],
      },
    });
  });

  it("o cadastro que já existe (outro pela raiz; a BTG, pelo código revisado) só ganha omie_ids", () => {
    // Na Omie, a BTG se chama "BANCO BTG PACTUAL": o código sugerido não é o dela.
    const btg = montarEntradas(fontesDe({
      clientes: [cliente(701, { cnpj_cpf: cnpj(RAIZ_BTG), razao_social: "BANCO BTG PACTUAL S.A.", nome_fantasia: "BANCO BTG PACTUAL S.A." })],
      crm: [],
      titulos: [titulo(701, "01/08/2026")],
    })).entradas;
    const alfa = montarEntradas(fontes()).entradas.filter((entrada) => entrada.chave === "cnpj-11111111");
    const existentes = [
      // A BTG como o WMS grava: sem CNPJ.
      cadastro("BTG_Pactual", { code: "BTG Pactual", customer_code: "BTG Pactual", name: "BTG Pactual", sku_prefix: "BTG" }),
      cadastro("ALFA", {
        code: "ALFA",
        customer_code: "ALFA",
        name: "Alfa",
        document: semMascara(cnpj(RAIZ_ALFA, "0009")),
        stage: "prospect",
        comercial: { responsavel_uid: "com-1", cidade: null, uf: null, omie_ids: ["cliente:102"] },
      }),
    ];

    // Sem revisão, a BTG parece o cadastro sem CNPJ "BTG Pactual": fica a
    // conferir, em vez de criar uma segunda BTG.
    const semRevisao = planejar([...btg, ...alfa], null, existentes);
    const parecida = semRevisao.itens.find((item) => item.chave === `cnpj-${RAIZ_BTG}`);
    assert.equal(parecida?.acao, "a_conferir");
    assert.match(parecida?.problemas[0] ?? "", /Parece ser o cadastro BTG Pactual \(código "BTG Pactual"\)/);
    assert.ok(semRevisao.operacoes.every((operacao) => operacao.tipo === "vincular"), "nada é criado");

    // Com o código dela na revisão, como o WMS gravou ou no formato do Comercial, a BTG é ligada.
    for (const codigo of ["BTG PACTUAL", "BTG-PACTUAL"]) {
      const { itens, operacoes } = planejar([...btg, ...alfa], new Map([[`cnpj-${RAIZ_BTG}`, codigo]]), existentes);
      const itemBtg = itens.find((item) => item.chave === `cnpj-${RAIZ_BTG}`);
      assert.equal(itemBtg?.acao, "vincular", codigo);
      assert.equal(itemBtg?.customer_id, "BTG_Pactual");
      assert.equal(itemBtg?.customer_code, "BTG Pactual");
      assert.equal(itemBtg?.estagio, "cliente");
      assert.equal(operacoes.length, 2);
    }
    const { itens, operacoes } = planejar([...btg, ...alfa], new Map([[`cnpj-${RAIZ_BTG}`, "BTG-PACTUAL"]]), existentes);

    const itemAlfa = itens.find((item) => item.chave === "cnpj-11111111");
    assert.equal(itemAlfa?.acao, "vincular");
    assert.equal(itemAlfa?.customer_code, "ALFA");
    assert.equal(itemAlfa?.estagio, "prospect", "o estágio do cadastro não muda");
    assert.ok(itemAlfa?.avisos.some((aviso) => /marque como cliente/.test(aviso)), itemAlfa?.avisos.join(" | "));

    assert.equal(operacoes.length, 2);
    assert.ok(operacoes.every((operacao) => operacao.tipo === "vincular"));
    const vinculoAlfa = operacoes.find((operacao) => operacao.tipo === "vincular" && operacao.customer_id === "ALFA");
    assert.ok(vinculoAlfa && vinculoAlfa.tipo === "vincular");
    assert.deepEqual(vinculoAlfa.antes, ["cliente:102"]);
    assert.deepEqual(vinculoAlfa.depois, ["cliente:101", "cliente:102", "cliente:103", "crm:9004"]);
  });

  it("cadastro que já tem todos os ids fica sem mudança", () => {
    const alfa = montarEntradas(fontes()).entradas.filter((entrada) => entrada.chave === "cnpj-11111111");
    const existente = cadastro("ALFA", {
      code: "ALFA",
      document: semMascara(cnpj(RAIZ_ALFA)),
      comercial: { omie_ids: ["cliente:101", "cliente:102", "cliente:103", "crm:9004"] },
    });
    const { itens, operacoes } = planejar(alfa, null, [existente]);
    assert.equal(itens[0].acao, "sem_mudanca");
    assert.deepEqual(operacoes, []);
  });

  it("código de outro cadastro com outra raiz, ou cadastro arquivado, fica a conferir", () => {
    const beta = montarEntradas(fontes()).entradas.filter((entrada) => entrada.chave === "cnpj-55555555");
    const outro = planejar(beta, null, [cadastro("BETA-SERVICOS", { code: "BETA-SERVICOS", document: semMascara(cnpj("77777777")) })]);
    assert.equal(outro.itens[0].acao, "a_conferir");
    assert.match(outro.itens[0].problemas[0], /já é do cadastro .*outra raiz/);
    assert.deepEqual(outro.operacoes, []);

    const arquivado = planejar(beta, null, [cadastro("BETA", { code: "BETA", document: semMascara(cnpj(RAIZ_BETA)), archived: true })]);
    assert.equal(arquivado.itens[0].acao, "a_conferir");
    assert.match(arquivado.itens[0].problemas[0], /arquivado/);
  });

  function omegaESigma() {
    return montarEntradas(fontesDe({
      clientes: [
        cliente(801, { cnpj_cpf: cnpj("88888888"), razao_social: "OMEGA LTDA", nome_fantasia: "OMEGA" }),
        cliente(802, { cnpj_cpf: cnpj("99999999"), razao_social: "OMEGA S.A.", nome_fantasia: "OMEGA" }),
        cliente(803, { cnpj_cpf: cnpj("12121212"), razao_social: "SIGMA LTDA", nome_fantasia: "SIGMA" }),
      ],
      crm: [contaCrm(9100, "Sigma")],
      titulos: [],
    })).entradas;
  }

  it("conta do CRM sem CNPJ com o código de uma empresa da carga entra junto; duas raízes com o mesmo código ficam a conferir", () => {
    const entradas = omegaESigma();

    const plano = planejar(entradas, new Map([["crm-9100", "SIGMA"]]), []);
    const porChave = new Map(plano.itens.map((item) => [item.chave, item]));
    assert.equal(porChave.get("cnpj-12121212")?.acao, "criar");
    assert.equal(porChave.get("crm-9100")?.acao, "juntar");
    assert.equal(porChave.get("crm-9100")?.junto_com, "cnpj-12121212");
    const sigma = plano.operacoes.find((operacao) => operacao.tipo === "criar" && operacao.dados.code === "SIGMA");
    assert.ok(sigma && sigma.tipo === "criar");
    assert.deepEqual(sigma.dados.comercial.omie_ids, ["cliente:803", "crm:9100"]);
    assert.equal(porChave.get("cnpj-88888888")?.acao, "a_conferir");
    assert.equal(porChave.get("cnpj-99999999")?.acao, "a_conferir");
    assert.match(porChave.get("cnpj-99999999")?.problemas[0] ?? "", /--codigos/);

    // Com o código revisado no CSV, cada raiz vira um cadastro.
    const revisado = planejar(entradas, new Map([["cnpj-99999999", "OMEGA-SA"]]), []);
    const codigos = revisado.operacoes.flatMap((operacao) => (operacao.tipo === "criar" ? [operacao.dados.code] : [])).sort();
    assert.deepEqual(codigos, ["OMEGA", "OMEGA-SA", "SIGMA"]);
  });

  it("duas raízes com o mesmo código não vão para o mesmo cadastro existente sem CNPJ, nem entre execuções", () => {
    const omega = omegaESigma().filter((entrada) => entrada.chave.startsWith("cnpj-") && entrada.chave !== "cnpj-12121212");
    const semCnpj = { code: "OMEGA", customer_code: "OMEGA", name: "Omega" };

    const plano = planejar(omega, null, [cadastro("OMEGA", semCnpj)]);
    for (const item of plano.itens) {
      assert.equal(item.acao, "a_conferir", item.chave);
      assert.match(item.problemas[0], /O código OMEGA levaria 2 raízes de CNPJ ao cadastro Omega/);
    }
    assert.deepEqual(plano.operacoes, []);

    // O cadastro já ligado a uma raiz (numa carga anterior) não recebe a outra pelo código.
    const ligado = cadastro("OMEGA", { ...semCnpj, comercial: { omie_ids: ["cliente:801"] } });
    const depois = planejar(omega, null, [ligado]);
    const porChave = new Map(depois.itens.map((item) => [item.chave, item]));
    assert.equal(porChave.get("cnpj-88888888")?.acao, "sem_mudanca");
    assert.equal(porChave.get("cnpj-99999999")?.acao, "a_conferir");
    assert.match(porChave.get("cnpj-99999999")?.problemas[0] ?? "", /levaria 2 raízes/);
    assert.deepEqual(depois.operacoes, []);
  });

  it("conta do CRM sem CNPJ fica fora sem código na revisão; com código, entra", () => {
    const entradas = montarEntradas(fontes()).entradas;

    // Pode ser uma pessoa (LGPD): sem revisão, nada é gravado.
    const semRevisao = planejar(entradas, null, []);
    const gama = semRevisao.itens.find((item) => item.chave === "crm-9001");
    assert.equal(gama?.acao, "fora");
    assert.equal(gama?.codigo_sugerido, "GAMA-ENGENHARIA");
    assert.ok(gama?.avisos.some((aviso) => /Conta do CRM sem CNPJ: só entra com um código/.test(aviso)), gama?.avisos.join(" | "));
    assert.ok(semRevisao.operacoes.every((operacao) => operacao.item.chave !== "crm-9001"));
    // Nem pelo código sugerido, que é o de um cadastro existente.
    const comCadastro = planejar(entradas, null, [cadastro("GAMA-ENGENHARIA", { code: "GAMA-ENGENHARIA", name: "Gama" })]);
    assert.equal(comCadastro.itens.find((item) => item.chave === "crm-9001")?.acao, "fora");

    // Com o código escrito na revisão, entra como prospect sem CNPJ.
    const comCodigo = planejar(entradas, new Map([["crm-9001", "GAMA"]]), []);
    const criar = comCodigo.operacoes.find((operacao) => operacao.item.chave === "crm-9001");
    assert.ok(criar && criar.tipo === "criar");
    assert.equal(criar.dados.code, "GAMA");
    assert.equal(criar.dados.document, null);
    assert.equal(criar.estagio, "prospect");

    // A que já foi ligada numa carga anterior segue sem revisão.
    const ligada = planejar(entradas, null, [cadastro("GAMA", { code: "GAMA", comercial: { omie_ids: ["crm:9001"] } })]);
    assert.equal(ligada.itens.find((item) => item.chave === "crm-9001")?.acao, "sem_mudanca");
  });
});

// --- CSV de revisão -----------------------------------------------------------------

describe("CSV de revisão", () => {
  it("uma linha por empresa, com nome, CNPJ, código sugerido, estágio e ação; sem pessoa física nem contato", () => {
    const { itens } = planejar(montarEntradas(fontes()).entradas, null, []);
    const texto = csvDeRevisao(itens);
    const [cabecalho, ...linhas] = lerCsv(texto.replace(/^﻿/, ""));
    assert.deepEqual(cabecalho.campos, [...COLUNAS_DA_REVISAO]);
    for (const coluna of ["chave", "nome", "cnpj", "primeira_compra", "codigo_sugerido", "codigo", "estagio", "acao"]) {
      assert.ok((COLUNAS_DA_REVISAO as readonly string[]).includes(coluna), coluna);
    }
    assert.equal(linhas.length, 4);
    const alfa = linhas.find((linha) => linha.campos[0] === "cnpj-11111111");
    assert.ok(alfa);
    const campo = (nome: string) => alfa.campos[COLUNAS_DA_REVISAO.indexOf(nome as (typeof COLUNAS_DA_REVISAO)[number])];
    assert.equal(campo("nome"), "ALFA CONSTRUTORA LTDA");
    assert.equal(campo("cnpj"), cnpj(RAIZ_ALFA, "0001"));
    assert.equal(campo("primeira_compra"), "2021-09-29");
    assert.equal(campo("codigo_sugerido"), "ALFA-CONSTRUTORA");
    assert.equal(campo("codigo"), "");
    assert.equal(campo("estagio"), "cliente");
    assert.equal(campo("acao"), "criar");
    for (const proibido of ["MARIA", "JOSE", "Pessoa Sint", CPF, semMascara(CPF), "contato.sintetico", "90000-1234", "Observação sintética", "pix-sintetico"]) {
      assert.equal(texto.includes(proibido), false, proibido);
    }
  });

  it("a coluna de código do CSV revisado volta com --codigos; \"-\" deixa a empresa de fora", () => {
    const entradas = montarEntradas(fontes()).entradas;
    const revisado = [
      "﻿chave;nome;Código;estagio",
      "cnpj-11111111;ALFA CONSTRUTORA LTDA;alfa;cliente",
      "crm-9001;Gama Engenharia;-;prospect",
      "cnpj-55555555;BETA SERVICOS;;prospect",
      "cnpj-00000000;NAO ESTA NA CARGA;ZETA;prospect",
    ].join("\r\n");
    const { codigos, nomes, problemas, avisos } = lerCodigos(Buffer.from(revisado, "utf8"), entradas);
    assert.deepEqual(problemas, []);
    assert.deepEqual([...codigos.entries()], [["cnpj-11111111", "ALFA"], ["crm-9001", "-"]]);
    assert.deepEqual([...nomes.entries()], [], "o nome igual ao da Omie não é revisão");
    assert.ok(avisos.some((aviso) => /cnpj-00000000/.test(aviso)));

    const { itens } = planejar(entradas, codigos, []);
    const porChave = new Map(itens.map((item) => [item.chave, item]));
    assert.equal(porChave.get("cnpj-11111111")?.customer_code, "ALFA");
    assert.equal(porChave.get("cnpj-11111111")?.codigo, "ALFA");
    assert.equal(porChave.get("crm-9001")?.acao, "fora");
    assert.equal(porChave.get("cnpj-55555555")?.customer_code, "BETA-SERVICOS");
  });

  it("a coluna nome do CSV revisado corrige o nome do cadastro novo; o do cadastro existente não muda", () => {
    const entradas = montarEntradas(fontes()).entradas;
    const revisado = [
      "chave;nome;codigo",
      "cnpj-11111111;  Alfa   Construtora ;",
      "cnpj-55555555;BETA SERVICOS;",
      "cnpj-44444444;X;",
    ].join("\r\n");
    const { codigos, nomes, problemas } = lerCodigos(Buffer.from(revisado, "utf8"), entradas);
    assert.deepEqual(problemas, ["--codigos: linha 4: o nome precisa ter de 2 a 120 caracteres."]);
    assert.deepEqual([...nomes.entries()], [["cnpj-11111111", "Alfa Construtora"]]);

    const { itens, operacoes } = planejar(entradas, codigos, [], nomes);
    const alfa = itens.find((item) => item.chave === "cnpj-11111111");
    assert.equal(alfa?.nome, "Alfa Construtora");
    assert.equal(alfa?.customer_code, "ALFA-CONSTRUTORA");
    assert.ok(alfa?.avisos.some((aviso) => aviso === "Nome revisado no CSV (na Omie: ALFA CONSTRUTORA LTDA)."), alfa?.avisos.join(" | "));
    const criar = operacoes.find((operacao) => operacao.item.chave === "cnpj-11111111");
    assert.ok(criar && criar.tipo === "criar");
    assert.equal(criar.dados.name, "Alfa Construtora");
    assert.equal(criar.dados.legal_name, "ALFA CONSTRUTORA LTDA", "a razão social continua a da Omie");

    // No cadastro que já existe, o nome do CSV não vale: só os ids mudam.
    const existente = cadastro("ALFA", { code: "ALFA", name: "Alfa", document: semMascara(cnpj(RAIZ_ALFA)) });
    const vinculo = planejar(entradas.filter((entrada) => entrada.chave === "cnpj-11111111"), null, [existente], nomes);
    assert.equal(vinculo.itens[0].acao, "vincular");
    assert.ok(vinculo.itens[0].avisos.some((aviso) => /o nome do CSV não vale para ele/.test(aviso)));
    assert.ok(vinculo.operacoes.every((operacao) => operacao.tipo === "vincular"));
  });

  it("CSV de códigos sem as colunas, com chave repetida ou com código inválido é recusado", () => {
    const entradas = montarEntradas(fontes()).entradas;
    assert.match(lerCodigos(Buffer.from("chave,codigo\ncnpj-11111111,ALFA", "utf8"), entradas).problemas[0], /colunas "chave" e "codigo"/);
    assert.match(
      lerCodigos(Buffer.from("chave;codigo\ncnpj-11111111;ALFA\ncnpj-11111111;ALFA2", "utf8"), entradas).problemas[0],
      /linha 3: a chave cnpj-11111111 aparece mais de uma vez/,
    );
    const { codigos } = lerCodigos(Buffer.from("chave;codigo\ncnpj-11111111;ALFA ÚNICA", "utf8"), entradas);
    const { itens } = planejar(entradas, codigos, []);
    const alfa = itens.find((item) => item.chave === "cnpj-11111111");
    assert.equal(alfa?.acao, "a_conferir");
    assert.match(alfa?.problemas[0] ?? "", /Código do cliente inválido/);
  });
});

// --- Dry-run sem projeto -----------------------------------------------------------

describe("dry-run sem projeto", () => {
  it("confere os arquivos e grava o relatório e o CSV de revisão em tmp/comercial", async () => {
    const relatorios = join(pasta, "relatorios-sem-projeto");
    const linhas: string[] = [];
    const resultado = await main([...argumentos(), "--relatorio-dir", relatorios], {
      agora: () => new Date("2026-10-21T12:00:00.000Z"),
      log: (linha) => linhas.push(linha),
    });
    assert.equal(resultado.codigo, 0, linhas.join("\n"));
    assert.equal(resultado.conteudo?.modo, "dry-run");
    assert.equal(resultado.conteudo?.comparado_com_o_banco, false);
    assert.equal(resultado.conteudo?.resumo.criar, 3);
    assert.equal(resultado.conteudo?.resumo.criar_cliente, 2);
    assert.equal(resultado.conteudo?.resumo.criar_prospect, 1);
    assert.equal(resultado.conteudo?.resumo.fora_crm_sem_cnpj, 1, "a conta do CRM sem CNPJ, sem código na revisão");
    assert.equal(resultado.conteudo?.resumo.fora_pela_revisao, 0);
    assert.equal(resultado.conteudo?.resumo.fora_pessoa_fisica, 3);
    const gerados = readdirSync(relatorios).sort();
    assert.deepEqual(gerados, [
      "clientes-omie-dry-run-sem-projeto-2026-10-21T12-00-00-000Z.csv",
      "clientes-omie-dry-run-sem-projeto-2026-10-21T12-00-00-000Z.json",
    ]);
    const relatorio = readFileSync(join(relatorios, gerados[1]), "utf8");
    for (const proibido of ["MARIA", "JOSE", CPF, semMascara(CPF), "contato.sintetico", "90000-1234", "Observação sintética", "1234.56"]) {
      assert.equal(relatorio.includes(proibido), false, proibido);
    }
    assert.ok(linhas.some((linha) => /sem --projeto/.test(linha)));
  });

  it("--executar sem --projeto sai com código 2, sem ler arquivo nem gravar relatório", async () => {
    const relatorios = join(pasta, "relatorios-recusado");
    const resultado = await main([...argumentos("--executar"), "--relatorio-dir", relatorios], { log: () => undefined });
    assert.equal(resultado.codigo, 2);
    assert.equal(resultado.relatorio, null);
    assert.throws(() => readdirSync(relatorios));
  });
});
