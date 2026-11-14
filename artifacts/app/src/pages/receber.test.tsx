import { readFileSync } from "node:fs";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ReceivingTaskDetailCard } from "@/features/warehouse-ops/receiving";
import { normalizeQueues, somenteConsulta, type WarehouseTask } from "@/lib/warehouse-ops/model";
import { telaDoWmsNaV3 } from "@/lib/wms-v3";
import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { textosDaTela, textosForaDaLista } from "@/test/textos";

import { CancelledReceiptHistory, NoticeCard } from "./receber";

/**
 * O Receber na v3 (parte 4.7e): só rótulos, dados e ações; uma ação
 * principal, a da primeira tarefa da fila; a chegada avulsa com os campos
 * ligados aos rótulos e sem explicação.
 */

const TELA = readFileSync(new URL("./receber.tsx", import.meta.url), "utf8");
const AVULSA = readFileSync(new URL("../features/warehouse-ops/receiving.tsx", import.meta.url), "utf8");

describe("o caminho do Receber nas outras telas", () => {
  it("a Contagem e a devolução mandam para Estoque › Receber, não para o antigo Recebimento", () => {
    for (const arquivo of ["../features/warehouse-ops/inventory.tsx", "../features/warehouse-ops/exceptions.tsx"]) {
      const fonte = readFileSync(new URL(arquivo, import.meta.url), "utf8");
      expect(fonte, arquivo).not.toMatch(/WMS &gt; Recebimento|fluxo de Recebimento|por Recebimento\./);
      expect(fonte, arquivo).toContain("Estoque › Receber");
    }
  });
});

describe("Receber na v3", () => {
  it("a tela está na lista da v3", () => {
    expect(telaDoWmsNaV3("/wms/receber")).toBe(true);
  });

  it("os grupos são os de sempre: o cartão sem saltos de Pedidos (carregamento v2, parte 6c) não entra aqui sem querer", () => {
    expect(TELA).toContain("<QueueGroup");
    expect(TELA).not.toContain("semSaltos");
    expect(TELA).not.toContain("useListaSemSaltos");
  });

  it("sem legenda: sem a dica dos grupos, o vazio diz o dado e o rótulo do aviso não é vermelho", () => {
    expect(TELA).not.toMatch(/\bhint=/);
    expect(TELA).toContain('empty="Nenhuma chegada para conferir."');
    expect(TELA).toContain('empty="Nada para guardar."');
    expect(TELA).not.toMatch(/text-primary">Aviso de envio/);
  });

  it("uma ação principal: a da primeira tarefa; a chegada avulsa é secundária", () => {
    expect(TELA).toContain("const principal = tarefaPrincipal(board);");
    expect(TELA).toMatch(/principal === entry\.task\.id \? "default" : "outline"/);
    expect(TELA).toMatch(/<Button\s+type="button"\s+variant="outline"[\s\S]{0,400}?setUnplannedOpen\(true\)/);
  });


  it("a chegada por caixa recebida fica em Recebidas, por guardar, com as caixas guardadas, até a última guarda", () => {
    expect(TELA).toContain('<QueueGroup title="Recebidas, por guardar" count={lendo ? null : board.guardando.length} empty={null} carregando={fantasmas("guardando", 1)} cascata={paraConferir}>');
    expect(TELA).toContain("{caixasGuardadas(entry.task)}");
    expect(TELA).toContain("meta={guardandoRowMeta(entry.task)}");
    expect(TELA).toContain("board.check.length + board.guardando.length + board.store.length");
    // A guarda da caixa: o destino no título e o selo sem prateleira.
    expect(TELA).toContain("title={tituloDaGuarda(entry.task) ?? getTaskTitle(entry.task)}");
    expect(TELA).toMatch(/guardaSemPrateleira\(entry\.task\) \?[\s\S]{0,240}sem prateleira/);
  });

  it("Recebidos em dois grupos, Chegadas e Guardas, cada um com o vazio dizendo o dado (06/11/2026)", () => {
    expect(TELA).toContain('<QueueGroup title="Chegadas" count={lendo ? null : board.chegadas.length} empty="Nenhuma chegada recebida." barraDoTopo={barraDoTopo} carregando={fantasmas("chegadas", 0)}>');
    expect(TELA).toContain('<QueueGroup title="Guardas" count={lendo ? null : board.guardas.length} empty="Nenhuma guarda concluída." carregando={fantasmas("guardas", 1)} cascata={board.chegadas.length}>');
    expect(TELA).toContain("rowDone(entry, receivingRowMeta(entry.task))");
    expect(TELA).toContain("rowDone(entry, putawayRowMeta(entry.task))");
    expect(TELA).not.toContain("board.done");
  });

  it("a guarda da caixa abre a guarda da caixa inteira, não o avanço por linha (parte 5f)", () => {
    expect(TELA).toMatch(/if \(entry\.queue\.key === "putaway" && entry\.task\.box_code\) \{\s*return <GuardaDaCaixa key=\{entry\.task\.id\} entry=\{entry\} \/>;/);
  });

  it("a chegada avulsa pede por caixa com a liberação e o modelo do cliente, com o selo e sem o local da linha (parte 5g)", () => {
    expect(AVULSA).toContain("const conferenceMode = modoDaChegadaAvulsa(RECEBIMENTO_POR_CAIXA_LIBERADO, activeCustomer?.profile?.template);");
    expect(AVULSA).toContain("conference_mode: conferenceMode,");
    expect(AVULSA).toContain('location_id: conferenceMode ? "RECEBIMENTO" : line.location.trim() || "RECEBIMENTO",');
    expect(AVULSA).toMatch(/\{conferenceMode \? \(\s*<Badge[^>]*>\s*Conferência por caixa\s*<\/Badge>/);
    expect(AVULSA).toMatch(/\{conferenceMode \? null : \(\s*<label[^>]*>\s*<span>Local<\/span>/);
  });

  it("a chegada avulsa: o diálogo não explica, e o fornecedor e a NF têm rótulo ligado ao campo", () => {
    expect(AVULSA).not.toContain("Use quando o fornecedor entregou sem aviso");
    expect(AVULSA).toMatch(/<Label htmlFor="chegada-fornecedor">Fornecedor<\/Label>\s*<Input\s+id="chegada-fornecedor"/);
    expect(AVULSA).toMatch(/<Label htmlFor="chegada-documento">NF \/ pedido<\/Label>\s*<Input\s+id="chegada-documento"/);
  });

  it("o aviso de envio: o rótulo, o número com o fornecedor, a NF e as unidades e a situação; axe", async () => {
    const html = renderToStaticMarkup(
      <div className="v3">
        <NoticeCard notice={{ id: "req_1", customer_code: "BTG", number: "AV-0042", supplier: "Malharia Sul", invoice: "4521", units: 120 }} />
      </div>,
    );
    expect(textosDaTela(html)).toEqual(["Aviso de envio", "AV-0042 · Malharia Sul", "NF 4521 · 120 un.", "Aguardando aprovação da coordenação"]);
    expect(await violacoesDeAcessibilidade(html)).toEqual([]);
  });
});

function fichaDaChegada(chegada: WarehouseTask, consulta = false) {
  const queue = normalizeQueues({ receiving: { key: "receiving", name: "Recebimento", tasks: [chegada] } }).find(
    (entry) => entry.key === "receiving",
  )!;
  const entry = { task: queue.tasks[0]!, queue };
  return renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <div className="v3">
        <ReceivingTaskDetailCard entry={consulta ? somenteConsulta(entry) : entry} alerts={[]} onAdvance={() => undefined} onOpenException={() => undefined} />
      </div>
    </QueryClientProvider>,
  );
}

describe("concluir a chegada com divergência", () => {
  const chegada: WarehouseTask = {
    id: "receiving:inb_1",
    reference: "inb_creq_1",
    title: "NF 4521",
    status: "checking",
    can_advance: true,
    items: [
      { id: "l1", sku_code: "BTG-000001", expected_quantity: 10, received_qty: 8, conference_status: "short" },
      { id: "l2", sku_code: "BTG-000002", expected_quantity: 5, received_qty: 5, conference_status: "ok" },
    ],
  };

  it("em conferência com divergência, o campo da justificativa com o rótulo ligado, sem explicação", async () => {
    const html = fichaDaChegada(chegada);
    expect(html).toMatch(/<label[^>]*for="justificativa-receiving:inb_1"[^>]*>Justificativa da divergência<\/label><textarea[^>]*id="justificativa-receiving:inb_1"/);
    expect(await violacoesDeAcessibilidade(html)).toEqual([]);
  });

  it("sem divergência, ou antes da conferência, não pede a justificativa", () => {
    expect(fichaDaChegada({ ...chegada, items: [chegada.items![1]!] })).not.toContain("Justificativa da divergência");
    expect(fichaDaChegada({ ...chegada, status: "created" })).not.toContain("Justificativa da divergência");
  });
});

describe("o Receber para quem só consulta (o suporte)", () => {
  const chegada: WarehouseTask = {
    id: "receiving:inb_2",
    reference: "inb_creq_2",
    title: "NF 4522",
    status: "checking",
    can_advance: true,
    items: [{ id: "l1", sku_code: "BTG-000001", expected_quantity: 10, received_qty: 8, conference_status: "short" }],
  };

  it("a ficha mostra a chegada sem Concluir entrada, Divergência, Salvar conferência nem a justificativa", () => {
    // As ações são botões; "Divergências" e "Divergência física detectada" são dados da conferência.
    // O BotaoDeAcao (carregamento v2, parte 13c) põe o rótulo na camada atual: o fim da camada, não o do botão.
    const acoes = ["Concluir entrada</span>", "Divergência</span>", "Salvar conferência</span>", "Justificativa da divergência</label>"];
    const operador = fichaDaChegada(chegada);
    for (const acao of acoes) expect(operador).toContain(acao);
    const consulta = fichaDaChegada(chegada, true);
    expect(consulta).toContain("Conferência de recebimento");
    for (const acao of acoes) expect(consulta).not.toContain(acao);
  });

  it("a tela esconde a chegada avulsa, troca a ação da linha por Ver e não liga o aviso", () => {
    expect(TELA).toContain("const operador = canOperateWarehouse(user?.publicMetadata.role);");
    expect(TELA).toMatch(/\{operador \? \(\s*<Button\s+type="button"\s+variant="outline"[\s\S]{0,400}?setUnplannedOpen\(true\)/);
    expect(TELA).toContain('{operador ? label : "Ver"}');
    expect(TELA).toContain("entry={operador && !isCancelledReceipt(selected.task) ? selected : somenteConsulta(selected)}");
    expect(TELA).toContain("operador && noticeChoice?.editable");
  });
});

describe("a chegada recebida (a ficha depois da entrada)", () => {
  const recebida: WarehouseTask = {
    id: "receiving:inb_avulso_9",
    reference: "inb_avulso_9",
    title: "AVL-0D0E620B",
    status: "received",
    can_advance: false,
    quantity: 71,
    next_action: "Fluxo registrado. Acompanhar documentação e billing.",
    items: [
      { id: "l1", product_name: "POLO MASCULINO PIQUET PRETO GG", client_item_code: "A.01.0806.005.GG", expected_quantity: 30, received_qty: 30, conference_status: "ok", location: "RECEBIMENTO" },
      { id: "l2", product_name: "POLO MASCULINO PIQUET PRETO - XG", client_item_code: "A.01.0806.005.XG", expected_quantity: 41, received_qty: 41, conference_status: "ok", location: "RECEBIMENTO" },
    ],
  };

  it("sem o selo da fila em inglês, sem o próximo passo e sem campos: só o que foi contado", async () => {
    const html = fichaDaChegada(recebida);
    expect(html).not.toContain("Receiving");
    expect(html).not.toContain("Próximo passo");
    expect(html).not.toContain("Acompanhar documentação");
    expect(html).not.toContain("Salve a quantidade física");
    expect(html).not.toContain("<input");
    expect(html).not.toContain("<textarea");
    expect(html).toContain("recebida");
    expect(html).toContain("A.01.0806.005.GG · esperado 30 un.");
    expect(html).toMatch(/<dt[^>]*>Físico<\/dt><dd[^>]*>30 un\.<\/dd>/);
    expect(
      textosForaDaLista(html, [
        "recebida",
        "AVL-0D0E620B",
        "Referência",
        "inb_avulso_9",
        "Itens",
        "2 linha(s)",
        "Quantidade",
        "71 un.",
        "Prazo",
        "Sem prazo",
        "Conferência de recebimento",
        "Esperado",
        "Físico contado",
        "2 de 2 linha(s)",
        "Diferença",
        "sem diverg.",
        "Divergências",
        "0",
        "POLO MASCULINO PIQUET PRETO GG",
        "POLO MASCULINO PIQUET PRETO - XG",
        "OK físico",
        "A.01.0806.005.GG · esperado 30 un.",
        "A.01.0806.005.XG · esperado 41 un.",
        "Físico",
        "Local",
        "RECEBIMENTO",
        /^\d+ un\.$/,
      ]),
    ).toEqual([]);
    expect(await violacoesDeAcessibilidade(html)).toEqual([]);
  });

  it("a chegada aberta continua com os campos da conferência e o próximo passo", () => {
    const aberta = fichaDaChegada({ ...recebida, status: "checking", can_advance: true, next_action: undefined });
    expect(aberta).toContain('aria-label="Quantidade conferida"');
    expect(aberta).toContain("Próximo passo");
  });
});


describe("histórico de cancelamento", () => {
  it("mostra motivo, observação, original, ator e data sem ação operacional; textos e axe", async () => {
    const html = renderToStaticMarkup(<CancelledReceiptHistory task={{ id: "receiving:avulsa", status: "cancelled", cancellation_reason: "duplicate", cancellation_note: "Entrada repetida", cancelled_at: "2026-11-04T12:00:00Z", cancelled_by: { uid: "operador", role: "wms", name: "Guilherme" }, duplicate_of_receipt_id: "original", duplicate_of_receipt_number: "AVL-123" }} />);
    expect(textosDaTela(html)).toEqual(["Recebimento cancelado", "Duplicado", "Entrada repetida", "Cancelado em 04/11/2026, 12:00", "Por Guilherme", "Original: AVL-123"]);
    expect(await violacoesDeAcessibilidade(html)).toEqual([]);
  });
});

/** Sem rede (docs/plataforma/diagnostico-carregamento.md, decisão 2 do celular, de 06/11/2026). */
describe("Receber sem conexão", () => {
  it("a lista lida fica com a hora; sem nada lido, o aviso; a falta de conexão não troca a lista pelo erro", () => {
    expect(TELA).toContain("const semRede = semConexaoNaLeitura(ops, requestsNaTela);");
    // A lista lida, com a falta: a hora dela fica na linha de estado sob o título (parte 7b), não na faixa que empurra a lista.
    // A troca de cliente também é pedida pela pessoa: passados 5 s, "Atualizando…" (parte 10).
    expect(TELA).toContain('estado={<LinhaDeEstado id={idDaLinha} leitura={leiturasDaLista} objeto="chegadas" pedidaPelaPessoa={atualizarLista.voltando || trocandoDeCliente} resumo={resumo} />}');
    // A falha fica na tela durante a releitura automática (a junção das partes 9, 11 e 12).
    expect(TELA).toContain("const leiturasDaLista = [opsNaTela, requestsNaTela];");
    expect(TELA).not.toContain("FaixaSemConexao");
    expect(TELA).not.toContain("Carregando chegadas...");
    // Na primeira leitura, a lista com a forma final, com as linhas-fantasma (parte 8); depois, o aviso, antes do erro
    // e das filas.
    // Só a primeira leitura da tela, e a falha das filas não espera os avisos.
    // Com a lista dos clientes que falhou, a falha do cliente ativo, e não a espera (a junção das partes 10 e 13).
    expect(TELA).toContain("const lendo = !clienteFalhou && !listaJaLida && !opsNaTela.isError && (opsNaTela.isLoading || requestsNaTela.isLoading);");
    expect(TELA).toContain(": !lendo && semRede && semRede.lidaEm === null ? (");
    expect(TELA.indexOf("semRede && semRede.lidaEm === null ? (")).toBeLessThan(TELA.indexOf("<FalhaDasChegadas focoAoSair={idDaLinha}"));
    // Só a leitura sem nada lido troca a lista pelo aviso: a releitura que falha fica na linha de estado (parte 10).
    // Os avisos do cliente que não vieram (a troca que falhou) também (a revisão da parte 10), e a falha fica na
    // tela durante a releitura automática (a junção das partes 9, 11 e 12).
    expect(TELA).toContain("const falhaNaTela = !lendo && !semRede && ((Boolean(opsNaTela.error) && !opsNaTela.data) || avisos.falhou);");
    expect(TELA).toContain(") : falhaNaTela ? (");
    expect(TELA).toContain("Não consegui carregar as chegadas.");
  });
});
