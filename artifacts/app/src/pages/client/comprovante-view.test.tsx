import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Router } from "wouter";

import { EMISSOR_DO_DOCUMENTO, cabecalhoDoEmissor } from "@/lib/comercial/emissor";
import { fichaDaLeitura } from "@/lib/operacao/ficha-da-os";
import { comprovanteDaOs } from "@/lib/portal/comprovante";
import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { textosDaTela } from "@/test/textos";

import { ComprovanteView, type EstadoDoComprovante } from "./comprovante-view";

/**
 * Portal › Minhas OS › Comprovante (parte 4.3d): a barra de cima fica fora do
 * PDF; o papel leva o feito, quem recebeu, a assinatura e as fotos do final.
 * Sem legenda, sem valor, nada interno, uma ação principal. Dados sintéticos.
 */

const ASSINATURA = "os/10045-01/assinatura/as_0123456789abcdef.png";
const FOTO = "os/10045-01/fotos/ft_f000000000000001.jpg";

const FICHA = fichaDaLeitura("10045-01", {
  demanda: "10045",
  customer_code: "ITAU",
  cliente_nome: "Itaú Unibanco",
  status: "revisada",
  edicao: 9,
  servicos: ["transporte"],
  janela: { data: "2026-10-22", inicio: "07:30", fim: "18:00" },
  locais: { origem: { nome: "Galpão 3", endereco: "Rua das Indústrias, 450" }, destino: { endereco: "Av. Faria Lima, 3500" } },
  equipe: [
    { colaborador_id: "c1", nome: "Ana Lima", papel: "lider" },
    { colaborador_id: "c2", nome: "João Pereira", papel: "motorista" },
  ],
  veiculos: [{ veiculo_id: "v1", placa: "DEF4G56", tipo: "caminhao" }],
  itens: [{ id: "ln_1", item: "Cadeira", unidade: "UN", planejado: "150", executado: "160" }],
  revisao: { instante: "2026-10-23T12:00:00.000Z", nota: "Conferido" },
  conclusao: {
    instante: "2026-10-22T19:30:00.000Z",
    canal: "celular",
    aceite: "assinatura",
    responsavel: { nome: "Renata Campos", cargo: "Facilities", documento: "12.345.678-9" },
    assinatura: ASSINATURA,
    diferencas: [],
    arquivos_do_final: ["ft_f000000000000001.jpg"],
  },
})!;
const COMPROVANTE = comprovanteDaOs(FICHA, "Itaú Unibanco");
const cabecalho = cabecalhoDoEmissor(EMISSOR_DO_DOCUMENTO);
const EMISSOR = [cabecalho.nome, cabecalho.linha].filter((linha): linha is string => Boolean(linha));
const URLS = { [ASSINATURA]: "https://exemplo.invalid/assinatura.png", [FOTO]: "https://exemplo.invalid/foto.jpg" };

function render(estado: EstadoDoComprovante = "pronto", comprovante = COMPROVANTE) {
  return renderToStaticMarkup(
    <Router ssrPath="/portal/servicos/comprovante">
      <ComprovanteView estado={estado} numero="10045-01" comprovante={comprovante} urls={URLS} onBaixar={() => undefined} />
    </Router>,
  );
}

const principais = (html: string) => (html.match(/<button[^>]*class="[^"]*bg-primary text-primary-foreground[^"]*"[^>]*>[\s\S]*?<\/button>/g) ?? []).map((botao) => textosDaTela(botao).join(" "));

describe("o comprovante da OS no portal", () => {
  it("a barra fora do PDF e o papel com o feito, quem recebeu e as fotos do final; nada interno, nenhum valor", () => {
    const html = render();
    expect(textosDaTela(html)).toEqual([
      "Minhas OS",
      "Comprovante da OS 10045-01",
      "Baixar PDF",
      ...EMISSOR,
      "Comprovante de execução",
      "OS 10045-01",
      "Transporte",
      "Concluída em 22/10/2026 às 16:30",
      "Cliente",
      "Itaú Unibanco",
      "Demanda",
      "10045",
      "Execução",
      "Data e janela",
      "22/10/2026 · 07:30–18:00",
      "Motorista e veículo",
      "João Pereira · DEF-4G56",
      "Origem",
      "Galpão 3 · Rua das Indústrias, 450",
      "Destino",
      "Av. Faria Lima, 3500",
      "Itens",
      "Item",
      "Unid.",
      "Feito",
      "Cadeira",
      "un",
      "160",
      "Recebimento",
      "Renata Campos",
      "Facilities · doc. 12.345.678-9",
      "Fotos do final",
      "app.dutelog.com.br",
      "OS 10045-01 · via do cliente",
    ]);
    expect(html).toMatch(/<img src="https:\/\/exemplo.invalid\/assinatura.png" alt="Assinatura de Renata Campos"/);
    expect(html).toMatch(/<img src="https:\/\/exemplo.invalid\/foto.jpg" alt="Foto do final 1"/);
    expect(html).not.toMatch(/Conferido|Ana Lima|Previsto|R\$|valor|preço/);
    // A barra não sai no PDF; o papel é a área impressa.
    expect(html).toMatch(/<div class="no-print [^"]*"><a [^>]*href="\/portal\/servicos\?os=10045-01"/);
    expect(html).toMatch(/<article aria-label="Comprovante da OS 10045-01" class="print-area /);
    expect(principais(html)).toEqual(["Baixar PDF"]);
  });

  it("carregando, sem comprovante e com erro, o PDF fica desligado", () => {
    expect(textosDaTela(render("carregando", null))).toContain("Carregando");
    expect(textosDaTela(render("sem_comprovante", null))).toContain("A OS 10045-01 ainda não tem comprovante.");
    expect(render("erro", null)).toMatch(/role="alert"[^>]*>Não foi possível carregar o comprovante\./);
    for (const estado of ["carregando", "sem_comprovante", "erro"] as const) expect(render(estado, null)).toMatch(/<button[^>]*disabled=""[^>]*>[\s\S]*?Baixar PDF/);
  });

  it("passa nas regras WCAG 2.1 A e AA do axe", async () => {
    expect(await violacoesDeAcessibilidade(render())).toEqual([]);
  });
});
