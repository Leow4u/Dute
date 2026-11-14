import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ProductLookupItem } from "./shared";
import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { textosDaTela } from "@/test/textos";
import {
  CatalogoIndisponivel,
  CatalogoVerificando,
  FamiliaNoCadastroCard,
  NewProductNotice,
  ProductIdentityCard,
  atributosDoProblema,
  campoDoProblemaDoNome,
  problemaDoNomeNoCadastro,
  seguirSugestao,
} from "./product-identity";

const product: ProductLookupItem = {
  id: "tricot-gg",
  skuCode: "BTG-000041",
  clientCode: "A.01.0536.004.GG",
  productName: "TRICOT MEIO ZÍPER CINZA GG",
  barcode: "7891000000011",
  brand: "TRICOT",
  size: "GG",
  color: "CINZA",
  photoUrl: "https://example.com/tricot.jpg",
  unitCost: 100,
  hasSku: true,
  source: {},
};

describe("identificação do cadastro encontrado", () => {
  it("exibe o cadastro completo, foto e variantes antes da seleção", () => {
    const html = renderToStaticMarkup(
      <ProductIdentityCard product={product} matchLabel="pelo código do cliente" onSelect={() => undefined} />,
    );
    for (const value of [product.productName, product.clientCode, product.skuCode, product.barcode, product.brand, product.size, product.color]) {
      expect(html).toContain(value);
    }
    expect(html).toContain('src="https://example.com/tricot.jpg"');
    expect(html).toContain("Cadastro encontrado pelo código do cliente");
    expect(html).toContain("Usar este cadastro");
    expect(html).not.toContain("truncate");
    expect(html).not.toContain("line-clamp");
    expect(html).not.toContain("Parecidos");
  });

  it("indica cadastro selecionado e impede a seleção repetida", () => {
    const html = renderToStaticMarkup(
      <ProductIdentityCard product={product} selected onSelect={() => undefined} />,
    );
    expect(html).toContain("Cadastro selecionado");
    expect(html).toMatch(/<button[^>]*disabled=""/);
    expect(html).not.toContain("Usar este cadastro");
  });

  it("identifica ausência de foto e atributos sem inventar dados", () => {
    const html = renderToStaticMarkup(
      <ProductIdentityCard product={{ ...product, photoUrl: "", size: "", color: "" }} onSelect={() => undefined} />,
    );
    expect(html).toContain("Sem foto");
    expect(html).toContain("Não informado");
    expect(html).not.toContain("<img");
  });
});

describe("identificação de produto novo", () => {
  it("permite confirmar um código não localizado sem oferecer outro produto", () => {
    const html = renderToStaticMarkup(
      <NewProductNotice confirmed={false} note="SKU gerado ao guardar a caixa." onToggle={() => undefined} />,
    );
    expect(html).toContain("Produto não localizado pelo código informado");
    expect(html).toContain("Cadastrar como novo");
    expect(html).not.toContain("Usar este cadastro");
    expect(html).not.toContain("Parecidos");
  });

  it("mostra a confirmação e permite rever a identificação", () => {
    const html = renderToStaticMarkup(
      <NewProductNotice confirmed note="SKU gerado ao guardar a caixa." onToggle={() => undefined} />,
    );
    expect(html).toContain("Produto novo confirmado");
    expect(html).toContain("Rever identificação");
    expect(html).toContain("SKU gerado ao guardar a caixa.");
    expect(html).not.toContain("Produto não localizado");
  });

  it("mostra o código sem SKU ativo e oferece o cadastro de novo", () => {
    const html = renderToStaticMarkup(
      <NewProductNotice
        confirmed={false}
        title="Código sem SKU"
        note="Este código não tem SKU ativo. Cadastre como novo. SKU gerado ao salvar."
        onToggle={() => undefined}
      />,
    );
    expect(html).toContain("Código sem SKU");
    expect(html).toContain("Este código não tem SKU ativo.");
    expect(html).toContain("Cadastrar como novo");
    expect(html).not.toContain("Produto não localizado pelo código informado");
  });

  it("preserva o bloqueio informado pela tela", () => {
    const html = renderToStaticMarkup(
      <NewProductNotice confirmed={false} disabled note="Cadastre a sigla do SKU." onToggle={() => undefined} />,
    );
    expect(html).toMatch(/<button[^>]*disabled=""/);
    expect(html).toContain("Cadastre a sigla do SKU.");
  });
});

describe("o catálogo que ainda não chegou ou não veio (decisão 6 de 06/11/2026)", () => {
  it("verificando: a espera em bloco do carregamento v2, sem região viva solta (parte 13c)", async () => {
    // Antes de 300 ms nada aparece; depois, a caixa e "Verificando o catálogo…", com o anúncio pelo Anunciador.
    const html = renderToStaticMarkup(<CatalogoVerificando />);
    expect(html).toContain("data-carregando-na-regiao");
    expect(html).not.toContain('role="status"');
    expect(html).not.toContain("aria-live");
    expect(await violacoesDeAcessibilidade(html)).toEqual([]);
  });

  it("não veio: a falha e a nova tentativa, sem oferecer cadastro novo", async () => {
    const leitura = { error: new Error("HTTP 500"), refetch: async () => undefined as never };
    const html = renderToStaticMarkup(<CatalogoIndisponivel leitura={leitura} />);
    expect(textosDaTela(html)).toEqual(["Não consegui carregar o catálogo.", "Tentar de novo"]);
    expect(html).toContain('role="alert"');
    expect(html).not.toContain("Cadastrar como novo");
    expect(await violacoesDeAcessibilidade(html)).toEqual([]);
  });

  it("a mensagem da tela que cadastra produto novo diz que o cadastro novo ficou bloqueado", () => {
    const leitura = { error: new Error("HTTP 500"), refetch: async () => undefined as never };
    const html = renderToStaticMarkup(
      <CatalogoIndisponivel leitura={leitura} mensagem="Não consegui carregar o catálogo. O cadastro de produto novo foi bloqueado para evitar duplicidade." />,
    );
    expect(textosDaTela(html)[0]).toBe("Não consegui carregar o catálogo. O cadastro de produto novo foi bloqueado para evitar duplicidade.");
  });
});

describe("o cartão da família no cadastro (docs/mockups/NomeWmsContagem.dc.html)", () => {
  const familia = {
    id: "familia-novo",
    familia: "A.02.0809.002",
    nome: "Polo Feminino Piquet Arpoador",
    tamanhos: ["P", "M", "G"],
    tamanho: "GG",
    fotoUrl: "https://example.com/arpoador.jpg",
    onToggle: () => undefined,
  };

  it("a família, os tamanhos do cadastro e o controle de cadastrar o tamanho novo, sem legenda", async () => {
    const html = renderToStaticMarkup(<FamiliaNoCadastroCard {...familia} confirmed={false} />);
    expect(textosDaTela(html)).toEqual([
      "Família A.02.0809.002 · 3 tamanhos no cadastro",
      "Polo Feminino Piquet Arpoador · P, M e G · tamanho GG novo",
      "Cadastrar o tamanho GG como novo",
    ]);
    expect(html).toContain('role="status"');
    expect(html).toContain('src="https://example.com/arpoador.jpg"');
    expect(html).toMatch(/<button[^>]*role="checkbox"[^>]*aria-checked="false"[^>]*id="familia-novo"/);
    expect(html).toContain('for="familia-novo"');
    expect(await violacoesDeAcessibilidade(html)).toEqual([]);
  });

  it("marcado, sem foto e com um tamanho só", async () => {
    const html = renderToStaticMarkup(<FamiliaNoCadastroCard {...familia} tamanhos={["P"]} fotoUrl="" confirmed />);
    expect(textosDaTela(html)).toEqual([
      "Família A.02.0809.002 · 1 tamanho no cadastro",
      "Polo Feminino Piquet Arpoador · P · tamanho GG novo",
      "Cadastrar o tamanho GG como novo",
    ]);
    expect(html).toContain('aria-checked="true"');
    expect(html).not.toContain("<img");
    expect(await violacoesDeAcessibilidade(html)).toEqual([]);
  });

  it("o bloqueio informado pela tela desliga o controle", () => {
    const html = renderToStaticMarkup(<FamiliaNoCadastroCard {...familia} confirmed={false} disabled note="Cadastre a sigla do SKU." />);
    expect(html).toMatch(/<button[^>]*role="checkbox"[^>]*disabled=""/);
    expect(textosDaTela(html)).toContain("Cadastre a sigla do SKU.");
  });
});

describe("o que a tela preenche sozinha", () => {
  it("entra no campo vazio e acompanha o código letra a letra", () => {
    expect(seguirSugestao("", "", "G")).toEqual({ valor: "G", posto: "G" });
    expect(seguirSugestao("G", "G", "GG")).toEqual({ valor: "GG", posto: "GG" });
    expect(seguirSugestao("GG", "GG", "")).toEqual({ valor: "", posto: "" });
  });

  it("o que a pessoa digitou fica", () => {
    expect(seguirSugestao("EG", "", "XG")).toEqual({ valor: "EG", posto: "" });
    expect(seguirSugestao("EG", "XG", "GG")).toEqual({ valor: "EG", posto: "" });
  });
});

describe("a recusa do nome no Catálogo", () => {
  const codigo = "A.01.0806.005.XG";

  it("o produto novo é conferido: o nome com o tamanho vai para o campo do nome", () => {
    expect(problemaDoNomeNoCadastro({ produto: "Polo Masculino Piquet Preto XG", cod_cliente: codigo, tamanho: "XG" })).toEqual({
      campo: "produto",
      problema: {
        tipo: "tamanho_no_nome",
        mensagem: "O tamanho XG fica no campo Tamanho. O nome é o mesmo em todos os tamanhos de A.01.0806.005.",
      },
    });
    expect(problemaDoNomeNoCadastro({ produto: "Polo Masculino Piquet Preto", cod_cliente: codigo, tamanho: "XG" })).toBeNull();
  });

  it("o Tamanho que contradiz o código vai para o campo Tamanho", () => {
    expect(problemaDoNomeNoCadastro({ produto: "Polo Masculino Piquet Preto", cod_cliente: codigo, tamanho: "G" })?.campo).toBe("tamanho");
  });

  it("na edição, só quando o nome ou o tamanho mudam", () => {
    const antes = { produto: "Polo masculino piquet preto - XG", tamanho: "XG" };
    expect(problemaDoNomeNoCadastro({ ...antes, cod_cliente: codigo }, antes)).toBeNull();
    expect(problemaDoNomeNoCadastro({ ...antes, produto: " Polo masculino piquet preto - XG ", cod_cliente: codigo }, antes)).toBeNull();
    expect(problemaDoNomeNoCadastro({ ...antes, produto: "Polo Masculino Piquet Preto XG", cod_cliente: codigo }, antes)?.problema.tipo).toBe("tamanho_no_nome");
    expect(problemaDoNomeNoCadastro({ produto: "Polo Masculino Piquet Preto", tamanho: "GG", cod_cliente: codigo }, { produto: "Polo Masculino Piquet Preto", tamanho: "XG" })?.campo).toBe("tamanho");
    expect(problemaDoNomeNoCadastro({ produto: "Polo masculino", tamanho: "", cod_cliente: codigo }, { produto: "Polo masculino", tamanho: null })).toBeNull();
    // Preencher o Tamanho de um cadastro antigo com o tamanho no nome não trava pelo nome (fica para o passo 3).
    const antigo = { produto: "Polo masculino piquet preto - XG", tamanho: "" };
    expect(problemaDoNomeNoCadastro({ ...antigo, tamanho: "XG", cod_cliente: codigo }, antigo)).toBeNull();
  });

  it("o campo da mensagem e os atributos do campo inválido", () => {
    expect(campoDoProblemaDoNome({ tipo: "campo_com_outro_tamanho" })).toBe("tamanho");
    expect(campoDoProblemaDoNome({ tipo: "so_o_tamanho" })).toBe("nome");
    expect(campoDoProblemaDoNome({ tipo: "nome_com_outro_tamanho" })).toBe("nome");
    expect(atributosDoProblema({ mensagem: "x" }, "produto")).toEqual({ "aria-invalid": true, "aria-describedby": "produto-problema" });
    expect(atributosDoProblema(null, "produto")).toEqual({});
  });
});
