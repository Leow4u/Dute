import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { normalizeQueues, type OpsAlert, type WarehouseTask } from "@/lib/warehouse-ops/model";
import { PutawayDetailSection, TaskDetailPanel } from "./task-detail";

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

function guardPanel(alerts: OpsAlert[]) {
  const queue = normalizeQueues({ putaway: { key: "putaway", name: "Guarda", tasks: [guardTask] } }).find(
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
});
