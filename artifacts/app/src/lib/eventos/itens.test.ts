import { describe, expect, it } from "vitest";

import { edicao, edicaoDaNecton, produtosDaNecton } from "@/test/eventos-necton";

import {
  ITENS_A_VISTA,
  PAGINA_DO_VER_MAIS,
  categoriasDosItens,
  comQuantidade,
  descricaoDaFamilia,
  faltasDeSaldo,
  familiasDaEdicao,
  filtrarFamilias,
  fotoDoItem,
  itemDeEntrada,
  janelaDeFamilias,
  linhaDoFechamento,
  linhaDosItens,
  ordenarFamilias,
  resumoComValor,
  resumoDosItens,
  semFamilia,
  textoDasFaltas,
  textoDoMostrando,
  textoDoVerMais,
  valorDasPecas,
  type ItemLido,
} from "./itens";
import type { ItemView } from "./tipos";

/**
 * Os itens do evento na tela do portal (docs/mockups/EventosPortalNovo.dc.html
 * e EventosPortalItens.dc.html): a família com a quantidade de cada tamanho,
 * o resumo com o valor das peças, a janela do "Ver mais", a falta de saldo e
 * o item reduzido aos seis campos que o servidor aceita.
 */

const NECTON = edicaoDaNecton();
const PRODUTOS = produtosDaNecton();

function item(extra: Partial<ItemView>): ItemView {
  return {
    sku_code: "BTG-999999",
    client_item_code: null,
    product_name: "Produto",
    size: null,
    category: null,
    quantity: 1,
    foi: null,
    voltou: null,
    avariadas: null,
    nao_voltaram: null,
    observacao: null,
    ...extra,
  };
}

describe("as famílias", () => {
  it("familiasDaEdicao agrupa A.01.0809.002.P/M/G/GG numa família de 700 peças com 'A.01.0809.002 · 4 tamanhos', e MAT-021 fica só com o código", () => {
    const familias = familiasDaEdicao(NECTON.itens);
    expect(familias).toHaveLength(40);
    expect(familias[0]).toMatchObject({ nome: "Polo Masculino Piquet Arpoador", codigo: "A.01.0809.002", categoria: "Polo", pecas: 700 });
    expect(familias[0].tamanhos.map(({ tamanho, item: linha }) => [tamanho, linha.quantity])).toEqual([
      ["P", 120],
      ["M", 300],
      ["G", 200],
      ["GG", 80],
    ]);
    expect(descricaoDaFamilia(familias[0])).toBe("A.01.0809.002 · 4 tamanhos");
    const balcao = familias.find((familia) => familia.nome === "Balcão de Recepção")!;
    expect(descricaoDaFamilia(balcao)).toBe("MAT-021");
    expect(balcao.tamanhos.map((tamanho) => tamanho.tamanho)).toEqual([null]);
    const caneca = familias.find((familia) => familia.nome === "Caneca Necton")!;
    expect(descricaoDaFamilia(caneca)).toBe("B.0412.001");
    expect(caneca.tamanhos.map((tamanho) => tamanho.tamanho)).toEqual(["Único"]);
    const sacola = familias.find((familia) => familia.nome === "Sacola Quadrada BTG")!;
    expect(descricaoDaFamilia(sacola)).toBe("J.0149.003");
    expect(sacola.tamanhos.map((tamanho) => tamanho.tamanho)).toEqual(["N1"]);
  });

  it("categoriasDosItens conta os itens por tipo; filtrarFamilias pelo tipo e pela busca; ordenarFamilias como no Estoque e pelo nome", () => {
    expect(categoriasDosItens(NECTON.itens)).toEqual([
      { categoria: "Polo", itens: 28 },
      { categoria: "Camiseta", itens: 22 },
      { categoria: "Brindes", itens: 31 },
      { categoria: "Móveis", itens: 19 },
    ]);
    const familias = familiasDaEdicao(NECTON.itens);
    const polos = filtrarFamilias(familias, { busca: "", categoria: "Polo" });
    expect(polos.reduce((soma, familia) => soma + familia.tamanhos.length, 0)).toBe(28);
    expect(filtrarFamilias(familias, { busca: "caneca", categoria: null }).map((familia) => familia.nome)).toEqual(["Caneca Necton"]);
    expect(filtrarFamilias(familias, { busca: "a.01.0809", categoria: null }).map((familia) => familia.nome)).toEqual(["Polo Masculino Piquet Arpoador"]);
    expect(filtrarFamilias(familias, { busca: "balcao", categoria: null }).map((familia) => familia.nome)).toEqual(["Balcão de Recepção"]);

    const invertidos = [...PRODUTOS].reverse();
    expect(ordenarFamilias(familias, "estoque", invertidos)[0].nome).toBe("Pufe Redondo Modelo 07");
    expect(ordenarFamilias(familias, "estoque", PRODUTOS)[0].nome).toBe("Polo Masculino Piquet Arpoador");
    const porNome = ordenarFamilias(familias, "nome", PRODUTOS).map((familia) => familia.nome);
    expect(porNome.slice(0, 2)).toEqual(["Balcão de Recepção", "Caderno Necton Modelo 01"]);
  });
});

describe("o resumo e o valor", () => {
  it("resumoComValor: '100 itens · 2.000 peças · R$ 86.400,00 em peças'; sem produto com valor, só '100 itens · 2.000 peças'", () => {
    expect(resumoDosItens(NECTON.itens)).toBe("100 itens · 2.000 peças");
    expect(resumoDosItens([item({ quantity: 1 })])).toBe("1 item · 1 peça");
    expect(valorDasPecas(NECTON.itens, PRODUTOS)).toBeCloseTo(86_400, 6);
    expect(resumoComValor(NECTON.itens, PRODUTOS)).toBe("100 itens · 2.000 peças · R$ 86.400,00 em peças");
    expect(resumoComValor(NECTON.itens, PRODUTOS.map((produto) => ({ ...produto, value: 0 })))).toBe("100 itens · 2.000 peças");
    expect(resumoComValor(NECTON.itens, [])).toBe("100 itens · 2.000 peças");
  });

  it("fotoDoItem: a foto do produto do mesmo SKU, ou null", () => {
    const comFoto = PRODUTOS.map((produto, indice) => (indice === 0 ? { ...produto, photoUrl: "https://foto/polo-p.jpg" } : produto));
    expect(fotoDoItem(NECTON.itens[0], comFoto)).toBe("https://foto/polo-p.jpg");
    expect(fotoDoItem(NECTON.itens[1], comFoto)).toBeNull();
    expect(fotoDoItem(item({}), comFoto)).toBeNull();
  });
});

describe("a janela do Ver mais", () => {
  it("janelaDeFamilias(16) mostra famílias inteiras, 'Mostrando 16 de 100 itens' e 'Ver mais 30 itens'; a última página não tem próximos", () => {
    const familias = familiasDaEdicao(NECTON.itens);
    const primeira = janelaDeFamilias(familias, ITENS_A_VISTA);
    expect(primeira.familias).toHaveLength(9);
    expect(primeira.mostrando).toBe(16);
    expect(primeira.proximos).toBe(PAGINA_DO_VER_MAIS);
    expect(textoDoMostrando(primeira.mostrando, 100)).toBe("Mostrando 16 de 100 itens");
    expect(textoDoVerMais(primeira.proximos)).toBe("Ver mais 30 itens");
    const segunda = janelaDeFamilias(familias, ITENS_A_VISTA + PAGINA_DO_VER_MAIS);
    expect(segunda.mostrando).toBe(46);
    const ultima = janelaDeFamilias(familias, 100);
    expect(ultima).toMatchObject({ mostrando: 100, proximos: 0 });
    expect(janelaDeFamilias(familias, 80)).toMatchObject({ mostrando: 80, proximos: 20 });
    expect(janelaDeFamilias(familias, 76)).toMatchObject({ mostrando: 74, proximos: 26 });
    expect(textoDoVerMais(1)).toBe("Ver mais 1 item");
    // A família que sozinha passa do limite entra inteira: a janela nunca fica vazia.
    expect(janelaDeFamilias(familias, 2)).toMatchObject({ mostrando: 4 });
    expect(textoDoMostrando(1, 1)).toBe("Mostrando 1 de 1 item");
  });
});

describe("mudar os itens", () => {
  it("comQuantidade com 0 tira o item; semFamilia tira os quatro tamanhos", () => {
    const gg = NECTON.itens[3];
    expect(gg.client_item_code).toBe("A.01.0809.002.GG");
    const menos = comQuantidade(NECTON.itens, gg.sku_code, 0);
    expect(menos).toHaveLength(99);
    expect(menos.some((linha) => linha.sku_code === gg.sku_code)).toBe(false);
    const mais = comQuantidade(NECTON.itens, gg.sku_code, 95);
    expect(mais[3].quantity).toBe(95);
    expect(mais).toHaveLength(100);
    const [polo] = familiasDaEdicao(NECTON.itens);
    expect(semFamilia(NECTON.itens, polo)).toHaveLength(96);
    expect(familiasDaEdicao(semFamilia(NECTON.itens, polo))[0].nome).toBe("Polo Feminina Piquet Azul Marinho");
  });

  it("itemDeEntrada: o item lido, com foi, voltou, avariadas, nao_voltaram e observacao (nulos ou não), sai só com sku_code, client_item_code, product_name, size, category e quantity; o da tela sem size sai com size null, e nenhuma chave fica undefined", () => {
    const lido: ItemLido = item({ sku_code: "BTG-000004", client_item_code: "A.01.0809.002.GG", product_name: "Polo", size: "GG", category: "Polo", quantity: 80, foi: 78, observacao: "x" });
    expect(itemDeEntrada(lido)).toEqual({ sku_code: "BTG-000004", client_item_code: "A.01.0809.002.GG", product_name: "Polo", size: "GG", category: "Polo", quantity: 80 });
    const daTela: ItemLido = { sku_code: "BTG-000010", product_name: "Caneca", quantity: 3 };
    const entrada = itemDeEntrada(daTela);
    expect(entrada).toEqual({ sku_code: "BTG-000010", client_item_code: null, product_name: "Caneca", size: null, category: null, quantity: 3 });
    expect(Object.keys(entrada).sort()).toEqual(["category", "client_item_code", "product_name", "quantity", "size", "sku_code"]);
    expect(Object.values(entrada)).not.toContain(undefined);
  });
});

describe("as linhas do cartão", () => {
  it("linhaDosItens: coleta antes do retorno, 'voltaram 63' depois; só a coleta e o vazio; linhaDoFechamento só com fechado_cents", () => {
    expect(linhaDosItens(NECTON)).toBe("100 itens do estoque · 2.000 peças · coleta no cliente: 2.190 produtos");
    const itensDaFeira = Array.from({ length: 18 }, (_, indice) =>
      item({ sku_code: `BTG-1${String(indice).padStart(5, "0")}`, quantity: indice < 10 ? 4 : 3, foi: indice < 10 ? 4 : 3, voltou: indice === 0 ? 3 : indice < 10 ? 4 : 3 }),
    );
    const feira = edicao({ status: "fechado", itens: itensDaFeira, fotos: Array.from({ length: 31 }, (_, indice) => foto(indice)) });
    expect(linhaDosItens(feira)).toBe("18 itens do estoque · 64 peças · voltaram 63");
    expect(linhaDosItens(edicao({ status: "no_evento", itens: itensDaFeira }))).toBe("18 itens do estoque · 64 peças");
    expect(linhaDosItens(edicao({ coleta: { onde: null, quantidade: 2190, voltou: null, distribuidos: null } }))).toBe("Coleta no cliente: 2.190 produtos");
    expect(linhaDosItens(edicao({}))).toBeNull();

    expect(linhaDoFechamento(feira, { id: feira.id, valor_declarado_cents: null, fechado_cents: 1_240_000 })).toBe("Preço fechado R$ 12.400,00 · 31 fotos");
    expect(linhaDoFechamento(edicao({ fotos: [foto(1)] }), { id: "x", valor_declarado_cents: null, fechado_cents: 715_000 })).toBe("Preço fechado R$ 7.150,00 · 1 foto");
    expect(linhaDoFechamento(edicao({}), { id: "x", valor_declarado_cents: null, fechado_cents: 715_000 })).toBe("Preço fechado R$ 7.150,00");
    expect(linhaDoFechamento(feira, { id: feira.id, valor_declarado_cents: 10_000_000, fechado_cents: null })).toBeNull();
    expect(linhaDoFechamento(feira, null)).toBeNull();
  });
});

describe("a falta de saldo", () => {
  it("faltasDeSaldo: o GG de 120 com 80 livres falta 40, e o item cujo SKU não está em produtos falta inteiro (disponível 0, falta igual à quantidade no evento); textoDasFaltas dá só as três primeiras, com 'no evento X, disponível Y', '1 item' no singular e null sem falta", () => {
    expect(faltasDeSaldo(NECTON.itens, PRODUTOS)).toEqual([]);
    expect(textoDasFaltas([])).toBeNull();
    const gg = NECTON.itens[3];
    const itens = [
      ...comQuantidade(NECTON.itens, gg.sku_code, 120),
      item({ sku_code: "BTG-ARQUIVADO", product_name: "Caneca Térmica", quantity: 50 }),
    ];
    const produtos = PRODUTOS.map((produto) => (produto.sku === gg.sku_code ? { ...produto, available: 80 } : produto));
    const faltas = faltasDeSaldo(itens, produtos);
    expect(faltas.map(({ item: linha, disponivel, falta }) => [linha.sku_code, disponivel, falta])).toEqual([
      [gg.sku_code, 80, 40],
      ["BTG-ARQUIVADO", 0, 50],
    ]);
    expect(textoDasFaltas(faltas)).toBe(
      "Falta saldo em 2 itens: Polo Masculino Piquet Arpoador · GG (no evento 120, disponível 80), Caneca Térmica (no evento 50, disponível 0)",
    );
    expect(textoDasFaltas(faltas.slice(0, 1))).toBe("Falta saldo em 1 item: Polo Masculino Piquet Arpoador · GG (no evento 120, disponível 80)");
    const muitas = faltasDeSaldo(NECTON.itens.slice(0, 5), []);
    expect(muitas).toHaveLength(5);
    expect(textoDasFaltas(muitas)).toBe(
      "Falta saldo em 5 itens: Polo Masculino Piquet Arpoador · P (no evento 120, disponível 0), Polo Masculino Piquet Arpoador · M (no evento 300, disponível 0), Polo Masculino Piquet Arpoador · G (no evento 200, disponível 0)",
    );
    // O saldo livre é o do SKU, somado entre os produtos dele (a conta do servidor).
    const emDois = [...produtos.filter((produto) => produto.sku !== gg.sku_code), { ...produtos[3], available: 60 }, { ...produtos[3], available: 70 }];
    expect(faltasDeSaldo(itens.slice(0, 100), emDois)).toEqual([]);
  });
});

function foto(indice: number) {
  return { id: `ft_${indice}`, caminho: `eventos/BTG/ced/fotos/ft_${indice}.jpg`, momento_id: null, legenda: null, instante: null, registrado_por: null, registrado_em: null };
}
