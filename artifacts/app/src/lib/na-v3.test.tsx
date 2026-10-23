import { readFileSync } from "node:fs";

import { Boxes } from "lucide-react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Router } from "wouter";

import { ShellDoModulo } from "@/components/layout/shell-do-modulo";

import { useNaV3 } from "./na-v3";

/**
 * O que abre em portal numa tela da v3 (parte 4.7c): o shell diz se a tela
 * segue a v3, e o diálogo, o painel, o menu, a lista e o popover levam o
 * `.v3` junto.
 */

function Sonda() {
  return <span data-na-v3={String(useNaV3())} />;
}

function shell(conteudoV3: boolean) {
  return renderToStaticMarkup(
    <Router ssrPath="/pedidos">
      <ShellDoModulo ambiente="wms" atual={{ label: "Armazenagem", icon: Boxes }} opcoes={[]} items={[]} basePath="" online conteudoV3={conteudoV3} conta={() => null}>
        <Sonda />
      </ShellDoModulo>
    </Router>,
  );
}

describe("o .v3 nos portais da tela", () => {
  it("o shell diz à tela se ela segue a v3", () => {
    expect(shell(true)).toContain('data-na-v3="true"');
    expect(shell(false)).toContain('data-na-v3="false"');
    expect(renderToStaticMarkup(<Sonda />)).toContain('data-na-v3="false"');
  });

  it("o diálogo, o alerta, o painel, o menu, o popover e a lista levam o .v3 com a tela", () => {
    for (const arquivo of ["dialog", "alert-dialog", "sheet", "dropdown-menu", "popover", "select"]) {
      const fonte = readFileSync(new URL(`../components/ui/${arquivo}.tsx`, import.meta.url), "utf8");
      expect(fonte, arquivo).toContain("const naV3 = useNaV3();");
      expect(fonte, arquivo).toContain("naV3 && 'v3'");
    }
  });
});
