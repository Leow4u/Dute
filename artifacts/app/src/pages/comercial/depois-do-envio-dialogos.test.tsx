import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AcoesDepoisDoEnvio } from "@/components/comercial/acoes-depois-do-envio";
import { contatoDoDocumento, contratoDoDocumento, type ContratoResumo } from "@/lib/comercial/clientes";
import {
  MOTIVOS_DE_PERDA,
  formInicialDoDialogo,
  motivosDePerdaPermitidos,
  problemasDoDialogo,
  type AcaoDepoisDoEnvio,
  type FormDoDialogo,
} from "@/lib/comercial/depois-do-envio";

import { violacoesDeAcessibilidade } from "@/test/acessibilidade";

import { CamposDoContrato, CamposDoPeriodo, CorpoDoDialogo, tituloDoDialogo, valoresDoDialogo } from "./depois-do-envio-dialogos";

/**
 * Os diálogos das ações depois do envio (parte 12b), só a apresentação dos
 * campos: curtos, só o que a ação precisa, com o problema de cada campo ao
 * lado e sem legenda. O diálogo em si (portal) é do Radix; a validação é de
 * lib/comercial/depois-do-envio.ts.
 */

const CONTATOS = [
  contatoDoDocumento("ct_marina", { customer_code: "ITAU-UNIBANCO", nome: "Marina Teixeira", empresa: "Souza & Lopes" })!,
  contatoDoDocumento("ct_paula", { customer_code: "ITAU-UNIBANCO", nome: "Paula Nogueira", empresa: "Hass & Megale" })!,
];

const AGORA = new Date("2026-10-21T15:00:00.000Z");
const noop = () => undefined;

function form(acao: AcaoDepoisDoEnvio, parcial: Partial<FormDoDialogo> = {}, comprometida = false): FormDoDialogo {
  return { ...formInicialDoDialogo(acao, { agora: AGORA, contatoId: "ct_marina", contatos: CONTATOS, comprometida }), ...parcial };
}

function corpo(acao: AcaoDepoisDoEnvio, f: FormDoDialogo, extra: Partial<Parameters<typeof CorpoDoDialogo>[0]> = {}) {
  const campos = (
    {
      fechar: "resposta",
      validar: "resposta",
      recusar_aditivo: "resposta",
      perder: "perda",
      revisar: "revisao",
      registrar_execucao: "execucao",
      orcar_da_operacao: "contrato",
    } as Record<string, "resposta" | "perda" | "revisao" | "execucao" | "contrato" | "confirmar">
  )[acao] ?? "confirmar";
  return renderToStaticMarkup(
    <CorpoDoDialogo
      campos={campos}
      form={f}
      onForm={noop}
      problemas={{}}
      contatos={CONTATOS}
      motivosDePerda={motivosDePerdaPermitidos(false)}
      hoje="2026-10-21"
      desabilitado={false}
      {...extra}
    />,
  );
}

function texts(html: string) {
  return html
    .replace(/<span class="sr-only">[^<]*<\/span>/g, "")
    .split(/<[^>]+>/)
    .map((text) => text.replace(/&amp;/g, "&").trim())
    .filter(Boolean);
}

describe("diálogo da resposta do cliente (Fechado, Validado, Recusar aditivo)", () => {
  it("só pede quando, quem e o link; sem legenda", () => {
    const html = corpo("fechar", form("fechar"));
    expect(texts(html)).toEqual([
      "Respondido em",
      "Contato",
      "Escolher…",
      "Marina Teixeira · Souza & Lopes",
      "Paula Nogueira · Hass & Megale",
      "Link do e-mail",
    ]);
    expect(html).toContain('type="datetime-local"');
    expect(html).toContain('value="2026-10-21T12:00"');
    expect(html).toMatch(/<option value="ct_marina" selected="">Marina Teixeira/);
    expect(html).toContain('placeholder="https://"');
  });

  it("sem contatos cadastrados, o campo avisa e fica desligado", () => {
    const html = corpo("validar", form("validar", { contatoId: "" }), { contatos: [] });
    expect(texts(html)).toContain("Nenhum contato");
    expect(html).toMatch(/<select[^>]*disabled=""/);
  });

  it("mostra o problema de cada campo, com alerta, e marca o campo", () => {
    const f = form("fechar", { em: "", contatoId: "", link: "outlook" });
    const problemas = problemasDoDialogo("fechar", f, { agora: AGORA, hoje: "2026-10-21", envioEm: null, contatos: CONTATOS, comprometida: false });
    const html = corpo("fechar", f, { problemas });
    expect(texts(html)).toEqual(
      expect.arrayContaining(["Informe quando o cliente respondeu.", "Escolha o contato do cliente.", "Informe o link que começa com https://."]),
    );
    expect(html.match(/role="alert"/g)).toHaveLength(3);
    expect(html.match(/aria-invalid="true"/g)).toHaveLength(3);
  });

  it("ocupado desliga os campos", () => {
    expect(corpo("fechar", form("fechar"), { desabilitado: true }).match(/disabled=""/g)).toHaveLength(3);
  });

  it("os valores seguem para o pedido como o formulário tem", () => {
    expect(valoresDoDialogo(form("fechar", { link: "https://x.com" }))).toMatchObject({
      em: "2026-10-21T12:00",
      contatoId: "ct_marina",
      link: "https://x.com",
    });
  });
});

describe("diálogo de Perdido", () => {
  it("motivo e nota; antes do fechamento escolhe entre os seis", () => {
    const html = corpo("perder", form("perder"));
    expect(texts(html)).toEqual(["Motivo", "Escolher…", ...MOTIVOS_DE_PERDA.map((motivo) => motivo.rotulo), "Nota"]);
  });

  it("depois do fechamento só tem o cancelamento pelo cliente, já escolhido, sem a opção vazia", () => {
    const html = corpo("perder", form("perder", {}, true), { motivosDePerda: motivosDePerdaPermitidos(true) });
    expect(texts(html)).toEqual(["Motivo", "Cancelado pelo cliente", "Nota"]);
    expect(html).toMatch(/<option value="cancelado_cliente" selected="">/);
  });

  it("outro sem nota mostra o que falta", () => {
    const f = form("perder", { motivo: "outro" });
    const problemas = problemasDoDialogo("perder", f, { agora: AGORA, hoje: "2026-10-21", envioEm: null, contatos: CONTATOS, comprometida: false });
    expect(texts(corpo("perder", f, { problemas }))).toContain("Conte o motivo na nota.");
  });
});

describe("diálogo de Revisar e de Registrar execução", () => {
  it("Revisar: só o motivo, pedido do cliente ou correção", () => {
    expect(texts(corpo("revisar", form("revisar")))).toEqual(["Motivo", "Escolher…", "Pedido do cliente", "Correção"]);
  });

  it("Registrar execução: De e Até, limitados a hoje, com o problema ao lado", () => {
    const html = corpo("registrar_execucao", form("registrar_execucao", { de: "2026-10-20", ate: "2026-10-18" }), {
      problemas: { ate: "O fim vem antes do início." },
    });
    expect(texts(html)).toEqual(["De", "Até", "O fim vem antes do início."]);
    expect(html).toContain('max="2026-10-21"');
    expect(html).toContain('min="2026-10-20"');
    expect(html.match(/type="date"/g)).toHaveLength(2);
  });

  it("o período é o mesmo do Orçar execução da fila", () => {
    const html = renderToStaticMarkup(
      <CamposDoPeriodo prefixo="novo-execucao" de="" ate="" max="2026-10-21" problemas={{ de: "Informe o início." }} desabilitado={false} onDe={noop} onAte={noop} />,
    );
    expect(html).toContain('id="novo-execucao-de"');
    expect(texts(html)).toEqual(["De", "Informe o início.", "Até"]);
  });

  it("Aditivo, Orçar execução, Reabrir e Descartar RV não têm campo: só a confirmação", () => {
    for (const acao of ["aditivo", "orcar_execucao", "reabrir", "descartar_rv"] as const) {
      expect(corpo(acao, form(acao))).toBe("");
    }
  });

  it("o título diz a ação e o orçamento", () => {
    expect(tituloDoDialogo("fechar", "10045")).toBe("Fechado · 10045");
    expect(tituloDoDialogo("aditivo", "10045 – RV01")).toBe("Abrir aditivo · 10045 – RV01");
    expect(tituloDoDialogo("descartar_rv", "10045 – RV02")).toBe("Descartar RV · 10045 – RV02");
  });
});

describe("os botões das ações", () => {
  /** Os botões do fragmento que o componente devolve, na ordem. */
  function botoes(elemento: ReactElement) {
    const filhos = (elemento.props as { children?: unknown }).children;
    return (Array.isArray(filhos) ? filhos.flat() : [filhos]).filter(Boolean) as ReactElement<{ onClick: () => void }>[];
  }

  it("a principal vem primeiro e cada botão chama a ação dele", () => {
    const chamadas: string[] = [];
    const elemento = AcoesDepoisDoEnvio({
      acoes: { principal: "fechar", secundarias: ["revisar", "perder"] },
      onAcao: (acao) => chamadas.push(acao),
      ocupado: false,
    }) as ReactElement;
    const html = renderToStaticMarkup(elemento);
    expect(texts(html)).toEqual(["Fechado", "Revisar", "Perdido"]);
    // A principal só é destacada quando a tela não tem outra (a fila tem "Novo orçamento").
    expect(html).not.toContain("bg-primary");
    const destacada = AcoesDepoisDoEnvio({ acoes: { principal: "fechar", secundarias: [] }, onAcao: noop, ocupado: false, destaque: true });
    expect(renderToStaticMarkup(destacada as ReactElement)).toContain("bg-primary");
    for (const botao of botoes(elemento)) botao.props.onClick();
    expect(chamadas).toEqual(["fechar", "revisar", "perder"]);
  });

  it("ignora o que a tela mostra em outro lugar e some sem ações", () => {
    const so = AcoesDepoisDoEnvio({ acoes: { principal: null, secundarias: ["descartar_rv"] }, onAcao: noop, ocupado: false, ignorar: ["descartar_rv"] });
    expect(so).toBeNull();
    expect(AcoesDepoisDoEnvio({ acoes: { principal: null, secundarias: [] }, onAcao: noop, ocupado: false })).toBeNull();
  });

  it("ocupado trava todos", () => {
    const html = renderToStaticMarkup(
      AcoesDepoisDoEnvio({ acoes: { principal: "fechar", secundarias: ["revisar"] }, onAcao: noop, ocupado: true }) as ReactElement,
    );
    expect(html.match(/disabled=""/g)).toHaveLength(2);
  });
});

describe("diálogo do Orçar execução da direta da Operação (parte 3.10d)", () => {
  const CONTRATOS = [
    contratoDoDocumento("itau-2026", { customer_code: "ITAU-UNIBANCO", nome: "Contrato Itaú", vigente_de: "2025-07-01", vigente_ate: "2027-06-30" }) as ContratoResumo,
  ];
  const inicial = () =>
    formInicialDoDialogo("orcar_da_operacao", { agora: AGORA, contatoId: null, contatos: [], comprometida: false, contratoId: "itau-2026", contratos: CONTRATOS });

  it("o contrato do cliente, já com o vigente, e a tabela; sem legenda", async () => {
    const html = corpo("orcar_da_operacao", inicial(), { contratos: CONTRATOS });
    expect(texts(html)).toEqual(["Contrato", "Sem contrato", "Contrato Itaú · 01/07/2025 a 30/06/2027", "Tabela", "Comercial", "Noturna"]);
    expect(html).toMatch(/<option value="itau-2026" selected="">/);
    expect(html).toMatch(/aria-pressed="true"[^>]*>Comercial</);
    expect(await violacoesDeAcessibilidade(html)).toEqual([]);
  });

  it("o problema aparece ao lado do campo, e os valores seguem para o pedido", () => {
    const html = corpo("orcar_da_operacao", { ...inicial(), contratoId: "outro" }, { contratos: CONTRATOS, problemas: { contrato: "Escolha um contrato do cliente." } });
    expect(texts(html)).toContain("Escolha um contrato do cliente.");
    expect(html).toContain('aria-invalid="true"');
    expect(valoresDoDialogo({ ...inicial(), variante: "Noturna" })).toMatchObject({ contratoId: "itau-2026", variante: "Noturna" });
  });

  it("o mesmo campo do Novo orçamento: ocupado desliga o contrato e a tabela", () => {
    const html = renderToStaticMarkup(
      <CamposDoContrato prefixo="novo" contratoId="" variante="Noturna" contratos={CONTRATOS} desabilitado onContrato={noop} onVariante={noop} />,
    );
    expect(html).toContain('id="novo-contrato"');
    expect(html.match(/disabled=""/g)).toHaveLength(3);
    expect(tituloDoDialogo("orcar_da_operacao", "10301")).toBe("Orçar execução · 10301");
  });
});
