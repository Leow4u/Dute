import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { normalizeQueues, type OpsAlert, type WarehouseTask } from "@/lib/warehouse-ops/model";
import { textosForaDaLista } from "@/test/textos";
import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { GuardaEncerrada, PutawayDetailSection, TaskDetailPanel, passoDaGuarda } from "./task-detail";

const guardTask: WarehouseTask = {
  id: "putaway:put_1",
  reference: "put_1",
  title: "Guardar Display de mesa A5",
  sku_code: "TT-0019",
  customer: "TikTok",
  status: "planned",
  quantity: 50,
  source_location_id: "RECEBIMENTO",
  can_advance: true,
  items: [{ id: "pi_1", sku_code: "TT-0019", quantity: 50 }],
};

function guardPanel(alerts: OpsAlert[], task: WarehouseTask = guardTask) {
  const queue = normalizeQueues({ putaway: { key: "putaway", name: "Guarda", tasks: [task] } }).find(
    (entry) => entry.key === "putaway",
  )!;
  return renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <TaskDetailPanel
        entry={{ task: queue.tasks[0]!, queue }}
        alerts={alerts}
        lineConfirmations={{}}
        onLineConfirmationChange={() => undefined}
        onAdvance={() => undefined}
        onOpenException={() => undefined}
      />
    </QueryClientProvider>,
  );
}

describe("ficha da guarda", () => {
  it("as evidências recolhidas mostram o alerta da tarefa ou da fila", () => {
    const fromQueue = guardPanel([
      { id: "al_1", title: "Poltrona rosa para revisar", queue: "receiving", task_id: "receiving:inb_1" },
      { id: "al_2", title: "Moletom P abaixo do mínimo", severity: "info", queue: "putaway" },
    ]);
    expect(fromQueue).toContain("Moletom P abaixo do mínimo");
    expect(fromQueue).not.toContain("Sem alerta direto");

    const fromTask = guardPanel([{ id: "al_3", title: "Caixa avariada", task_id: "putaway:put_1" }]);
    expect(fromTask).toContain("Caixa avariada");
    expect(fromTask).not.toContain("Sem alerta direto");

    const other = guardPanel([{ id: "al_1", title: "Poltrona rosa para revisar", queue: "receiving" }]);
    expect(other).toContain("Sem alerta direto");
    expect(other).not.toContain("Poltrona rosa para revisar");
  });

  it("o campo de posição mostra o que o operador digitou, mesmo sem destino resolvido", () => {
    const markup = renderToStaticMarkup(
      <PutawayDetailSection
        task={guardTask}
        operation={{ source_location_id: "RECEBIMENTO", destination_location_id: "", location_id: "" }}
        query="A-0"
        positions={[{ code: "A-01", aisle: "A", shelf: 1, customer_code: "TikTok", status: "active" }]}
        positionsStatus="ready"
        customerCode="TikTok"
        onOperationChange={() => undefined}
        onQueryChange={() => undefined}
      />,
    );
    expect(markup).toContain('value="A-0"');
    expect(markup).toContain("A-01");
  });

  it("a quantidade não passa da tarefa: o + para nela (decisão 23)", () => {
    const render = (quantity: number) =>
      renderToStaticMarkup(
        <PutawayDetailSection
          task={guardTask}
          operation={{ source_location_id: "RECEBIMENTO", destination_location_id: "A-01", location_id: "A-01", quantity }}
          query=""
          positions={[]}
          positionsStatus="ready"
          customerCode="TikTok"
          onOperationChange={() => undefined}
          onQueryChange={() => undefined}
        />,
      );
    const mais = (markup: string) => markup.match(/<button[^>]*>\+<\/button>/)?.[0] ?? "";
    expect(mais(render(50))).toContain('disabled=""');
    expect(mais(render(49))).not.toContain('disabled=""');
  });

  it("o + e o − andam de uma em uma unidade sem passar da tarefa, também com quantidade fracionada", () => {
    expect([passoDaGuarda(49, 50, 1), passoDaGuarda(50, 50, 1), passoDaGuarda(50, 50, -1), passoDaGuarda(1, 50, -1)]).toEqual([50, 50, 49, 1]);
    // Tarefa de 1,5: o − vai a 1 e o + volta a 1,5, não a 2.
    expect([passoDaGuarda(1.5, 1.5, -1), passoDaGuarda(1, 1.5, 1)]).toEqual([1, 1.5]);
    // Tarefa de 0,5: o − não sobe acima dela.
    expect(passoDaGuarda(0.5, 0.5, -1)).toBe(0.5);
    expect(passoDaGuarda(2.6, 2.6, -1)).toBe(1.6);
    // Tarefa sem quantidade: sem teto.
    expect(passoDaGuarda(3, 0, 1)).toBe(4);
  });

  it("a guarda concluída mostra onde ficou, sem o seletor de posição nem a quantidade editável", () => {
    const concluida = { ...guardTask, status: "completed", can_advance: false, destination_location_id: "B-02" };
    const markup = guardPanel([], concluida);
    expect(markup).toContain("Guardada em");
    expect(markup).toContain("B-02");
    expect(markup).not.toContain("Bipe ou busque a prateleira");
    expect(markup).not.toMatch(/<button[^>]*>\+<\/button>/);
    // A guarda aberta continua com o seletor.
    expect(guardPanel([])).toContain("Bipe ou busque a prateleira");
  });

  it("a guarda encerrada só tem rótulos e dados, e passa no axe", async () => {
    const concluida = renderToStaticMarkup(
      <GuardaEncerrada task={{ ...guardTask, status: "completed", destination_location_id: "B-02" }} />,
    );
    const cancelada = renderToStaticMarkup(<GuardaEncerrada task={{ ...guardTask, status: "cancelled" }} />);
    const permitidos = ["Guardada em", "B-02", "Quantidade", "50 un.", "Origem", "RECEBIMENTO", "Situação", "Guarda cancelada", "Ficou em"];
    expect(textosForaDaLista(concluida, permitidos)).toEqual([]);
    expect(textosForaDaLista(cancelada, permitidos)).toEqual([]);
    expect(cancelada).toContain("Guarda cancelada");
    expect(await violacoesDeAcessibilidade(concluida)).toEqual([]);
  });
});
