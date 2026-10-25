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

  it("quem só consulta (o suporte) não vê Separado, Entregue, Tratar nem a ação da entrega", () => {
    expect(FONTE).toContain("const operador = canOperateWarehouse(user?.publicMetadata.role);");
    expect(FONTE.match(/onTreat=\{operador \? \(\) => setTreating\(order\) : undefined\}/g)).toHaveLength(2);
    expect(FONTE).toMatch(/operador \? \(\s*<Button[\s\S]*?Separado\s*<\/Button>\s*\) : undefined/);
    expect(FONTE).toMatch(/operador \? \(\s*<Button[\s\S]*?Entregue\s*<\/Button>\s*\) : undefined/);
    expect(FONTE).toMatch(/secondary: operador \? \(/);
  });

  it("o motivo da recusa tem rótulo", () => {
    expect(FONTE).toMatch(/<Label htmlFor="motivo-da-recusa">Motivo<\/Label>\s*<Textarea\s+id="motivo-da-recusa"/);
  });

  it("só a primeira linha da fila tem a ação principal", () => {
    expect(FONTE).toContain("const principal = chaveDaPrincipal(queue, decider);");
    for (const chave of ["approve:${request.id}", "pick:${order.key}", "deliver:${order.key}"]) {
      expect(FONTE).toContain(`variant={variante(\`${chave}\`)}`);
    }
  });
});
