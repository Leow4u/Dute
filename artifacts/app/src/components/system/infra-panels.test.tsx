import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { SystemInfra } from "@/lib/system-infra";
import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { textosDaTela } from "@/test/textos";

import { LatencyPanel } from "./infra-panels";

/** O quadro Latência do painel do sistema: o p50 e o p95 de 24 h por function. */

const infra = (latency: SystemInfra["latency"]): SystemInfra => ({
  checked_at: "2026-10-25T03:00:00Z",
  settings: { billing_table: null },
  errors: { status: "ok", total: 0, blocked: 0, services: 0, groups: [] },
  functions: {
    status: "ok",
    total: 1,
    ok: 1,
    sem_acesso: 0,
    nao_publicada: 0,
    codebases: ["default"],
    last_deploy_at: null,
    list: [{ name: "readShipmentInvoice", codebase: "default", service: "readshipmentinvoice", status: "ok", state: "ACTIVE", updated_at: null, fix: null }],
  },
  latency,
  billing: { status: "not_configured" },
});

describe("o quadro Latência", () => {
  it("cada function pelo nome do código, com o p50 e o p95, a mais lenta primeiro", async () => {
    const html = renderToStaticMarkup(
      <LatencyPanel
        infra={infra({ status: "ok", total: 2, services: [{ service: "readshipmentinvoice", p50_ms: 310, p95_ms: 2413 }, { service: "dute-app", p50_ms: 12, p95_ms: 48 }] })}
      />,
    );
    expect(textosDaTela(html)).toEqual(["Latência", "· últimas 24 h", "Function", "p50", "p95", "readShipmentInvoice", "310 ms", "2,4 s", "Site (dute-app)", "12 ms", "48 ms"]);
    expect(await violacoesDeAcessibilidade(html)).toEqual([]);
  });

  it("sem requisição, diz que não houve; sem permissão, mostra o motivo", () => {
    expect(textosDaTela(renderToStaticMarkup(<LatencyPanel infra={infra({ status: "ok", total: 0, services: [] })} />))).toContain("Nenhuma requisição nas últimas 24 h.");
    expect(renderToStaticMarkup(<LatencyPanel infra={infra({ status: "error", message: "Sem permissão para ler a latência no Cloud Monitoring." })} />)).toContain(
      "Sem permissão para ler a latência no Cloud Monitoring.",
    );
  });
});
