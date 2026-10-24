import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { baixasLidas, type BaixaDoFinanceiro } from "@/lib/financeiro/baixas";
import { emissoesLidas, type EmissaoDoFinanceiro } from "@/lib/financeiro/emissoes";
import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { textosDaTela, textosForaDaLista } from "@/test/textos";

import { EmissoesView, type EmissoesViewProps } from "./emissoes-view";

/**
 * Financeiro › Emissões (Fase 7, parte 7.4f): as NFS-e pedidas à Omie, das
 * que precisam de uma pessoa às em andamento e às concluídas. Só rótulos,
 * dados e ações; nenhuma ação principal (as ações são da linha); a
 * desistência pede confirmação na linha; e a identidade v3. Dados sintéticos.
 */

function emissao(numero: number, extra: Record<string, unknown>): EmissaoDoFinanceiro {
  const [lida] =
    emissoesLidas({
      emissoes: [
        {
          id: `nfe_${String(numero).padStart(20, "0")}`,
          customer_code: "ITAU",
          customer_name: "Itaú Unibanco",
          etapa: "na_fila",
          motivo_da_parada: null,
          mensagem: null,
          mensagens_da_prefeitura: [],
          demandas: [],
          armazenagem: [],
          total_cents: 100_000,
          vencimento: "2026-11-20",
          nfse: null,
          url_nfse: null,
          url_pdf: null,
          criada_em: "2026-10-23T12:00:00.000Z",
          edicao: 2,
          ...extra,
        },
      ],
    }) ?? [];
  if (!lida) throw new Error("emissão ilegível no teste");
  return lida;
}

const REJEITADA = emissao(1, {
  etapa: "rejeitada",
  demandas: ["10045", "10046"],
  armazenagem: ["ITAU__2026-09"],
  total_cents: 1_484_500,
  mensagem: "Código de serviço inválido.",
  mensagens_da_prefeitura: [{ codigo: "E10", descricao: "Código de serviço inválido.", correcao: "Revise o serviço na Omie." }],
});
const PARADA = emissao(2, {
  customer_code: "SAFRA",
  customer_name: "Banco Safra",
  etapa: "parada",
  motivo_da_parada: "cliente_nao_achado",
  mensagem: "Nenhum cliente ativo com o CNPJ 12.345.678/0001-90 na Omie.",
  demandas: ["10060"],
  total_cents: 50_000,
  vencimento: "2026-11-23",
});
const CANCELADA = emissao(3, { customer_name: "C6 Bank", etapa: "parada", motivo_da_parada: "cancelada_na_omie", mensagem: "A OS foi cancelada na Omie.", demandas: ["10070"] });
const NA_PREFEITURA = emissao(4, { customer_name: "BTG Pactual", etapa: "na_prefeitura", armazenagem: ["BTG__2026-09"], total_cents: 300_000 });
const AUTORIZADA = emissao(5, {
  customer_name: "XP",
  etapa: "autorizada",
  demandas: ["10080"],
  total_cents: 200_000,
  nfse: "00001234",
  url_nfse: "https://nfse.exemplo.gov.br/consulta?n=1234",
  url_pdf: "https://app.omie.com.br/nfse/1234.pdf",
});
const DESISTIDA = emissao(6, { customer_name: "Banco Inter", etapa: "desistida", demandas: ["10090"], total_cents: 40_000 });

const EMISSOES = [REJEITADA, PARADA, NA_PREFEITURA, AUTORIZADA, DESISTIDA];

function baixa(numero: number, extra: Record<string, unknown>): BaixaDoFinanceiro {
  const [lida] =
    baixasLidas({
      baixas: [
        {
          id: `bxa_${String(numero).padStart(24, "0")}`,
          pagamento_id: `pag_${String(numero).padStart(24, "0")}`,
          fatura_id: `fat_${String(numero).padStart(24, "0")}`,
          customer_code: "ITAU",
          customer_name: "Itaú Unibanco",
          nf_numero: "815",
          etapa: "na_fila",
          motivo_da_parada: null,
          mensagem: null,
          valor_cents: 500_000,
          recebido_em: "2026-10-22",
          criada_em: "2026-10-22T15:00:00.000Z",
          edicao: 3,
          ...extra,
        },
      ],
    }) ?? [];
  if (!lida) throw new Error("baixa ilegível no teste");
  return lida;
}

const BAIXA_PARADA = baixa(1, { etapa: "parada", motivo_da_parada: "titulo_liquidado", mensagem: "O título da OS já está recebido na Omie, sem o recebimento da Dute." });
const BAIXA_NA_FILA = baixa(2, { customer_name: "Banco Safra", nf_numero: "816", valor_cents: 50_000, recebido_em: "2026-10-23" });

const noop = () => undefined;

function props(extra: Partial<EmissoesViewProps> = {}): EmissoesViewProps {
  return {
    estado: "pronto",
    emissoes: EMISSOES,
    baixas: [],
    desistindo: null,
    dispensando: null,
    ocupado: false,
    aviso: null,
    falha: null,
    acoes: { pedir: noop, confirmarDesistencia: noop, desistirDeDesistir: noop, pedirNaBaixa: noop, confirmarDispensa: noop, desistirDeDispensar: noop },
    ...extra,
  };
}

function render(extra: Partial<EmissoesViewProps> = {}): string {
  return renderToStaticMarkup(<EmissoesView {...props(extra)} />);
}

const PRINCIPAL = /<button[^>]*class="[^"]*bg-primary text-primary-foreground[^"]*"[^>]*>[\s\S]*?<\/button>/g;

function secao(html: string, titulo: string): string {
  const id = /<h2 id="([^"]+)"[^>]*>([^<]*)<\/h2>/g;
  for (const [, chave, texto] of html.matchAll(id)) {
    if (texto.trim() !== titulo) continue;
    const inicio = html.lastIndexOf("<section", html.indexOf(`aria-labelledby="${chave}"`));
    return html.slice(inicio, html.indexOf("</section>", inicio));
  }
  throw new Error(`sem a seção ${titulo}`);
}

describe("Financeiro › Emissões", () => {
  it("as que precisam de você, as em andamento e as concluídas, sem legenda", () => {
    const html = render();
    expect(textosDaTela(html)).toEqual([
      "Emissões",
      "Precisam de você",
      "2",
      "Itaú Unibanco",
      "Demandas 10045 e 10046 · Armazenagem 09/2026",
      "Vence em 20/11/2026",
      "Código de serviço inválido. Revise o serviço na Omie.",
      "R$ 14.845,00",
      "Rejeitada",
      "Tentar de novo",
      "Desistir",
      "Banco Safra",
      "Demanda 10060",
      "Vence em 23/11/2026",
      "Cliente não achado na Omie",
      "Nenhum cliente ativo com o CNPJ 12.345.678/0001-90 na Omie.",
      "R$ 500,00",
      "Parada",
      "Em andamento",
      "1",
      "BTG Pactual",
      "Armazenagem 09/2026",
      "R$ 3.000,00",
      "Na prefeitura",
      "Concluídas",
      "XP · NFS-e 1234",
      "Demanda 10080",
      "R$ 2.000,00",
      "Autorizada",
      "Abrir a NFS-e",
      "Banco Inter",
      "Demanda 10090",
      "R$ 400,00",
      "Desistida",
    ]);
    const permitidos = [
      /^(Emissões|Precisam de você|Em andamento|Concluídas)$/,
      /^\d+$/,
      /^(Itaú Unibanco|Banco Safra|BTG Pactual|Banco Inter|C6 Bank)$/,
      /^XP · NFS-e \d+$/,
      /^(Demandas? [\d, e]+|Armazenagem \d{2}\/\d{4})( · Armazenagem \d{2}\/\d{4})?$/,
      /^Vence em \d{2}\/\d{2}\/\d{4}$/,
      /^R\$ [\d.]+,\d{2}$/,
      /^(Na fila|OS incluída|Na prefeitura|Autorizada|Rejeitada|Reenviando|Cancelando na Omie|Parada|Desistida)$/,
      // O que a prefeitura e a Omie disseram: dado da emissão, não legenda.
      "Código de serviço inválido. Revise o serviço na Omie.",
      "Cliente não achado na Omie",
      "Nenhum cliente ativo com o CNPJ 12.345.678/0001-90 na Omie.",
      /^(Tentar de novo|Desistir|Abrir a NFS-e)$/,
    ];
    expect(textosForaDaLista(html, permitidos)).toEqual([]);
    // Cada seção conta as dela.
    expect(textosDaTela(secao(html, "Precisam de você")).slice(0, 2)).toEqual(["Precisam de você", "2"]);
    expect(textosDaTela(secao(html, "Concluídas")).slice(0, 2)).toEqual(["Concluídas", "2"]);
  });

  it("identidade v3 e nenhuma ação principal: as ações são da linha, com o cliente no nome acessível", () => {
    const html = render();
    expect(html).toMatch(/^<div class="v3 /);
    expect(html.match(PRINCIPAL) ?? []).toHaveLength(0);
    const precisam = secao(html, "Precisam de você");
    expect(precisam).toContain('aria-label="Tentar de novo, Itaú Unibanco"');
    expect(precisam).toContain('aria-label="Desistir, Banco Safra"');
    // As em andamento e as concluídas não têm ação: a rotina anda sozinha.
    expect(textosDaTela(secao(html, "Em andamento"))).not.toContain("Tentar de novo");
    expect(textosDaTela(secao(html, "Concluídas"))).not.toContain("Desistir");
    // A NFS-e autorizada abre o PDF da Omie em outra aba.
    expect(html).toMatch(/<a[^>]*href="https:\/\/app\.omie\.com\.br\/nfse\/1234\.pdf"[^>]*target="_blank"[^>]*rel="noreferrer"/);
  });

  it("a OS cancelada na Omie só se desiste; a autorizada sem PDF não tem link", () => {
    const html = render({ emissoes: [CANCELADA, { ...AUTORIZADA, urlPdf: null }] });
    const textos = textosDaTela(html);
    expect(textos).toEqual(expect.arrayContaining(["OS cancelada na Omie", "A OS foi cancelada na Omie.", "Desistir"]));
    expect(textos).not.toContain("Tentar de novo");
    expect(textos).not.toContain("Abrir a NFS-e");
    // Sem as em andamento, a seção não aparece.
    expect(textos).not.toContain("Em andamento");
  });

  it("a rejeitada sem mensagem da prefeitura mostra a mensagem da emissão", () => {
    const html = render({ emissoes: [{ ...REJEITADA, mensagens: [], mensagem: "A prefeitura recusou a NFS-e." }] });
    expect(textosDaTela(html)).toContain("A prefeitura recusou a NFS-e.");
  });

  it("desistir pede a confirmação na linha; as outras linhas seguem com as ações delas", () => {
    const html = render({ desistindo: PARADA.id });
    const precisam = secao(html, "Precisam de você");
    expect(textosDaTela(precisam)).toEqual(expect.arrayContaining(["Confirmar desistência", "Voltar", "Tentar de novo", "Desistir"]));
    expect(precisam).not.toContain('aria-label="Desistir, Banco Safra"');
    expect(precisam).toContain('aria-label="Desistir, Itaú Unibanco"');
    // A confirmação é a única ação vermelha da tela.
    expect(html.match(/border-destructive\/40/g) ?? []).toHaveLength(1);
    expect(html.match(PRINCIPAL) ?? []).toHaveLength(0);
    // Ocupada, nenhuma ação da tela responde.
    const ocupada = render({ desistindo: PARADA.id, ocupado: true });
    expect((ocupada.match(/<button[^>]*>/g) ?? []).every((botao) => /disabled=""/.test(botao))).toBe(true);
  });

  it("o aviso e a falha da ação; carregando, erro e vazio dizem o que é", () => {
    expect(render({ aviso: "Banco Safra: emissão retomada" })).toMatch(/<p role="status"[^>]*>Banco Safra: emissão retomada<\/p>/);
    expect(render({ falha: "A emissão mudou. Abra de novo." })).toMatch(/<p role="alert"[^>]*>A emissão mudou\. Abra de novo\.<\/p>/);
    expect(textosDaTela(render({ estado: "carregando", emissoes: [] }))).toEqual(["Emissões", "Carregando..."]);
    expect(textosDaTela(render({ estado: "erro", emissoes: [] }))).toEqual(["Emissões", "Não foi possível carregar as emissões."]);
    expect(textosDaTela(render({ emissoes: [] }))).toEqual(["Emissões", "Nenhuma emissão"]);
  });

  it("as baixas abertas na Omie, a parada primeiro, com o motivo e a mensagem, logo depois das emissões que precisam de você", () => {
    const html = render({ emissoes: [REJEITADA, NA_PREFEITURA], baixas: [BAIXA_NA_FILA, BAIXA_PARADA] });
    const secaoDasBaixas = secao(html, "Baixas na Omie");
    expect(textosDaTela(secaoDasBaixas)).toEqual([
      "Baixas na Omie",
      "2",
      "Itaú Unibanco · NF 815",
      "Recebido em 22/10/2026",
      "Título já recebido na Omie",
      "O título da OS já está recebido na Omie, sem o recebimento da Dute.",
      "R$ 5.000,00",
      "Parada",
      "Tentar de novo",
      "Dispensar",
      "Banco Safra · NF 816",
      "Recebido em 23/10/2026",
      "R$ 500,00",
      "Na fila",
    ]);
    // A ordem das seções: as emissões que precisam de você, as baixas, as em andamento.
    const titulos = [...html.matchAll(/<h2 id="[^"]+"[^>]*>([^<]*)<\/h2>/g)].map((match) => match[1].trim());
    expect(titulos).toEqual(["Precisam de você", "Baixas na Omie", "Em andamento"]);
    expect(
      textosForaDaLista(secaoDasBaixas, [
        "Baixas na Omie",
        /^\d+$/,
        /^(Itaú Unibanco|Banco Safra) · NF \d+$/,
        /^Recebido em \d{2}\/\d{2}\/\d{4}$/,
        /^R\$ [\d.]+,\d{2}$/,
        /^(Na fila|Lançada|Cancelando na Omie|Cancelada|Parada|Dispensada)$/,
        // O motivo e o que a Omie disse: dado da baixa, não legenda.
        "Título já recebido na Omie",
        "O título da OS já está recebido na Omie, sem o recebimento da Dute.",
        /^(Tentar de novo|Dispensar)$/,
      ]),
    ).toEqual([]);
    expect(secaoDasBaixas).toContain('aria-label="Tentar de novo, Itaú Unibanco · NF 815"');
    expect(secaoDasBaixas).toContain('aria-label="Dispensar, Itaú Unibanco · NF 815"');
    expect(html.match(PRINCIPAL) ?? []).toHaveLength(0);
    // Só as baixas, sem emissão: a tela não diz que está vazia.
    const soBaixas = textosDaTela(render({ emissoes: [], baixas: [BAIXA_NA_FILA] }));
    expect(soBaixas).toContain("Baixas na Omie");
    expect(soBaixas).not.toContain("Nenhuma emissão");
  });

  it("dispensar a baixa pede a confirmação na linha", () => {
    const html = render({ emissoes: [], baixas: [BAIXA_PARADA], dispensando: BAIXA_PARADA.id });
    const textos = textosDaTela(html);
    expect(textos).toEqual(expect.arrayContaining(["Confirmar dispensa", "Voltar"]));
    expect(textos).not.toContain("Dispensar");
    expect(html.match(/border-destructive\/40/g) ?? []).toHaveLength(1);
  });

  it("sem violação de acessibilidade (WCAG 2.1 A e AA), com a lista, com a confirmação aberta e vazia", async () => {
    expect(await violacoesDeAcessibilidade(render({ baixas: [BAIXA_PARADA, BAIXA_NA_FILA] }))).toEqual([]);
    expect(await violacoesDeAcessibilidade(render({ baixas: [BAIXA_PARADA], dispensando: BAIXA_PARADA.id }))).toEqual([]);
    expect(await violacoesDeAcessibilidade(render())).toEqual([]);
    expect(await violacoesDeAcessibilidade(render({ desistindo: PARADA.id, aviso: "Itaú Unibanco: emissão retomada" }))).toEqual([]);
    expect(await violacoesDeAcessibilidade(render({ emissoes: [], falha: "Não foi possível mudar a emissão." }))).toEqual([]);
  });
});
