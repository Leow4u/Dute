import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { telaDoWmsNaV3 } from "@/lib/wms-v3";

/**
 * Pedidos na v3 (parte 4.7c): só rótulos, dados e ações. O diálogo e o
 * painel não explicam o que vai acontecer; o motivo da recusa tem rótulo.
 */

const FONTE = readFileSync(new URL("./pedidos.tsx", import.meta.url), "utf8");

describe("Pedidos na v3", () => {
  it("a tela está na lista da v3", () => {
    expect(telaDoWmsNaV3("/pedidos")).toBe(true);
  });

  it("sem legenda: nenhuma descrição de diálogo ou painel, dica de grupo ou exemplo no campo", () => {
    expect(FONTE).not.toMatch(/<(Dialog|Sheet)Description\b/);
    expect(FONTE).not.toMatch(/\bhint=/);
    expect(FONTE).not.toMatch(/\bplaceholder=/);
    expect(FONTE).not.toContain("Confira antes de aprovar");
  });

  it("o diálogo e o painel dizem que não têm descrição (sem aviso do Radix)", () => {
    expect(FONTE).toMatch(/<DialogContent [^>]*aria-describedby=\{undefined\}/);
    expect(FONTE).toMatch(/<SheetContent [^>]*aria-describedby=\{undefined\}/);
  });

  it("quem só consulta (o suporte) não vê Separar, Entregue, Tratar nem a ação da entrega", () => {
    expect(FONTE).toContain("const operador = canOperateWarehouse(user?.publicMetadata.role);");
    expect(FONTE.match(/onTreat=\{operador \? \(\) => setTreating\(order\) : undefined\}/g)).toHaveLength(2);
    expect(FONTE).toMatch(/operador \? \(\s*<Button asChild[\s\S]*?hrefDaBancada\(order\.key\)[\s\S]*?<\/Button>\s*\) : undefined/);
    expect(FONTE).toMatch(/operador \? \(\s*<Button[\s\S]*?Entregue\s*<\/Button>\s*\) : undefined/);
    expect(FONTE).toMatch(/secondary: operador \? \(/);
  });

  it("Cancelar pedido fica no ⋯ do pedido ainda no armazém, só para quem decide (pergunta 59)", () => {
    expect(FONTE).toContain("decider && pedidoCancelavel(order) ? (");
    expect(FONTE.match(/menu=\{menuDo\(order\)\}/g)).toHaveLength(2);
    expect(FONTE).toContain("aria-label={`Mais ações do pedido ${order.orderNumber}`}");
    expect(FONTE).toMatch(/disabled=\{!motivoValido\(cancelReason\) \|\| busy\}/);
  });

  it("Separar abre a bancada do pedido, e Continuar depois da primeira linha; a fila não conclui mais a separação (separação com caixas, parte 2)", () => {
    expect(FONTE).toContain('<Link href={hrefDaBancada(order.key)}>{separacaoComecou(order.pick, order.pick?.items ?? []) ? "Continuar" : "Separar"}</Link>');
    // O pedido por separar abre com os itens; o que já está em separação, fechado.
    expect(FONTE).toContain("defaultOpen={!separacaoComecou(order.pick, order.pick?.items ?? [])}");
    // O selo "em separação desde 12/11 · 2 de 5 itens" só no pedido ainda para separar.
    expect(FONTE).toContain('const selo = order.stage === "separar" ? seloDaSeparacao(order.pick, items) : null;');
    // O "Separado" de um passo só saiu: a separação e a embalagem concluem na bancada, numa chamada do servidor.
    expect(FONTE).not.toContain("picking_lines");
    expect(FONTE).not.toContain("packing_lines");
    expect(FONTE).not.toContain('kind: "pick"');
    expect(FONTE).not.toContain("Confirmar separação");
  });

  it("o motivo da recusa tem rótulo", () => {
    expect(FONTE).toMatch(/<Label htmlFor="motivo-da-recusa">Motivo<\/Label>\s*<Textarea\s+id="motivo-da-recusa"/);
  });

  it("a coordenação vê o Para quando que o cliente pediu em aprovar, separar e entregar", () => {
    expect(FONTE).toContain("detail={linhaDoParaQuando(request.due_at)}");
    expect(FONTE.match(/paraQuando=\{paraQuandoDoPedido\(order, requests\.data\?\.items\)\}/g)).toHaveLength(2);
    expect(FONTE).toContain("detail={paraQuando && detail ? <>{paraQuando} · {detail}</> : paraQuando ?? detail}");
  });

  it("a leitura que falhou vira o erro com Tentar de novo, não o vazio das filas (decisão 6 de 06/11/2026)", () => {
    expect(FONTE).toContain("const semLeitura = (ops.isError && !ops.data) || (decider && requests.isError && !requests.data);");
    // O erro vem antes das filas e de "Entregues": sem leitura, nenhum "Nenhum pedido para…".
    const erro = FONTE.indexOf(") : !lendo && semLeitura ? (");
    expect(erro).toBeGreaterThan(FONTE.indexOf("<BlocoSemConexao tentando={relendo}"));
    expect(FONTE.indexOf("<BlocoSemConexao tentando={relendo}")).toBeGreaterThan(-1);
    expect(erro).toBeLessThan(FONTE.indexOf(') : view === "delivered" ? ('));
    expect(FONTE).toContain("const relendo = ops.isFetching || requests.isFetching;");
    expect(FONTE).toMatch(/<ErroNaLeitura\s+mensagem="Não consegui carregar os pedidos\."\s+tentando=\{relendo\}\s+onTentar=\{refreshAll\}/);
  });

  it("sem rede, a lista lida fica com a hora, e sem nada lido vem o aviso, nunca o vazio (decisão 2 do celular)", () => {
    // Quem não decide não lê as solicitações: só o armazém entra na conta.
    expect(FONTE).toContain("const semRede = semConexaoNaLeitura(ops, ...(decider ? [requests] : []));");
    expect(FONTE).toContain("const leiturasDaLista = decider ? [ops, requests] : [ops];");
    // Na primeira leitura, a lista com a forma final, com as linhas-fantasma (parte 8); depois, o aviso, antes do erro
    // e das filas.
    // A leitura que falhou sem dado não espera a outra: o aviso entra na hora.
    expect(FONTE).toContain("const lendo = loading && !semLeitura;");
    expect(FONTE).toContain("{!lendo && semRede && semRede.lidaEm === null ? (");
    expect(FONTE.indexOf("semRede && semRede.lidaEm === null ? (")).toBeLessThan(FONTE.indexOf(") : !lendo && semLeitura ? ("));
    // A nova tentativa leva o foco à linha de estado quando o aviso sai.
    expect(FONTE).toMatch(/<BlocoSemConexao tentando=\{relendo\} onTentar=\{refreshAll\} focoAoSair=\{idDaLinha\} \/>/);
    expect(FONTE).toMatch(/<ErroNaLeitura\s+mensagem="Não consegui carregar os pedidos\."\s+tentando=\{relendo\}\s+onTentar=\{refreshAll\}\s+focoAoSair=\{idDaLinha\}/);
    // A lista lida, com a falta: a hora dela fica na linha de estado sob o título (parte 7b), não na faixa que empurra a lista.
    expect(FONTE).toContain('estado={<LinhaDeEstado id={idDaLinha} leitura={leiturasDaLista} objeto="pedidos" pedidaPelaPessoa={atualizarLista.voltando} resumo={resumo} />}');
    expect(FONTE).not.toContain("FaixaSemConexao");
    expect(FONTE).not.toContain("Carregando pedidos...");
  });

  it("só a primeira linha da fila tem a ação principal: a primeira na tela, que a nova primeira herda quando ela sai", () => {
    expect(FONTE).toContain("const principal = chaveDaPrincipal(naTela, decider);");
    expect(FONTE).toContain("approve: paraAprovar.chaves.map((id) => ({ id })),");
    expect(FONTE).toContain("pick: paraSeparar.chaves.map((key) => ({ key })),");
    expect(FONTE).toContain("deliver: paraEntregar.chaves.map((key) => ({ key })),");
    for (const chave of ["approve:${request.id}", "pick:${order.key}", "deliver:${order.key}"]) {
      expect(FONTE).toContain(`variant={variante(\`${chave}\`)}`);
    }
  });
});
