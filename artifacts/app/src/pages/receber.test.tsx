import { readFileSync } from "node:fs";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { telaDoWmsNaV3 } from "@/lib/wms-v3";
import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { textosDaTela } from "@/test/textos";

import { NoticeCard } from "./receber";

/**
 * O Receber na v3 (parte 4.7e): só rótulos, dados e ações; uma ação
 * principal, a da primeira tarefa da fila; a chegada avulsa com os campos
 * ligados aos rótulos e sem explicação.
 */

const TELA = readFileSync(new URL("./receber.tsx", import.meta.url), "utf8");
const AVULSA = readFileSync(new URL("../features/warehouse-ops/receiving.tsx", import.meta.url), "utf8");

describe("Receber na v3", () => {
  it("a tela está na lista da v3", () => {
    expect(telaDoWmsNaV3("/wms/receber")).toBe(true);
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
    expect(TELA).toMatch(/<Button type="button" variant="outline" onClick=\{\(\) => setUnplannedOpen\(true\)\}>/);
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
