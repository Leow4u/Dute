// @vitest-environment jsdom
import { act, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { textosDaTela } from "@/test/textos";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "./alert-dialog";
import { BotaoDeAcao } from "./botao-de-acao";
import { Dialog, DialogCancelar, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "./dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "./sheet";

/**
 * O diálogo em ação (carregamento v2, parte 13a; diagnóstico, necessidade 6):
 * enquanto a ação que o diálogo pediu grava, o Esc, o toque fora, o X e o
 * Cancelar não fecham; o Cancelar e o X ficam aria-disabled, nunca disabled;
 * o confirmar é o BotaoDeAcao, que nunca fecha sozinho; e o foco nunca cai no
 * body: durante a ação ele fica no botão tocado, e no fim volta ao controle
 * que abriu o diálogo ou, se ele saiu da tela, ao título da página.
 */

let raiz: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.appendChild(container);
  raiz = createRoot(container);
});

afterEach(() => {
  act(() => raiz?.unmount());
  vi.useRealTimers();
  vi.unstubAllGlobals();
  container?.remove();
  document.body.innerHTML = "";
  raiz = null;
  container = null;
});

async function montar(no: ReactNode) {
  await act(async () => raiz!.render(no));
  // O Radix escuta o toque fora num setTimeout depois de abrir.
  await act(async () => new Promise((pronto) => setTimeout(pronto, 0)));
}

/** O botão pelo rótulo: o texto inteiro, ou a camada atual do BotaoDeAcao. */
function botao(texto: string, dentro: ParentNode = document): HTMLButtonElement | undefined {
  return Array.from(dentro.querySelectorAll<HTMLButtonElement>("button")).find(
    (elemento) =>
      elemento.textContent?.trim() === texto ||
      elemento.querySelector(".botao-acao-camada[data-atual]")?.textContent?.trim() === texto,
  );
}

const dialogo = () => document.querySelector<HTMLElement>('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]');

async function esc() {
  await act(async () => {
    (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
  });
}

async function tocarFora() {
  await act(async () => {
    document.body.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, cancelable: true, button: 0 }));
  });
}

async function clicar(elemento: HTMLElement | undefined) {
  expect(elemento, "o botão está na tela").toBeTruthy();
  await act(async () => elemento!.click());
}

/** Um diálogo de formulário como os da tela: o Cancelar, o confirmar que grava e quem fecha. */
function DialogoDoTeste({
  ocupado,
  aoMudar,
  aoConfirmar = () => {},
  semOnClickNoCancelar = false,
}: {
  ocupado: boolean;
  aoMudar: (aberto: boolean) => void;
  aoConfirmar?: () => void;
  semOnClickNoCancelar?: boolean;
}) {
  return (
    <Dialog open ocupado={ocupado} onOpenChange={aoMudar}>
      <DialogContent aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>Nova rua</DialogTitle>
        </DialogHeader>
        <DialogFooter>
          {semOnClickNoCancelar ? <DialogCancelar /> : <DialogCancelar onClick={() => aoMudar(false)} />}
          <BotaoDeAcao estado={ocupado ? "andamento" : "repouso"} rotulo="Cadastrar rua" andamento="Cadastrando…" onClick={aoConfirmar} />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

describe("o Dialog em ação", () => {
  it("com a ação gravando, o Esc, o toque fora, o X e o Cancelar não fecham", async () => {
    const aoMudar = vi.fn();
    await montar(<DialogoDoTeste ocupado aoMudar={aoMudar} />);
    await esc();
    await tocarFora();
    await clicar(botao("Fechar", dialogo()!));
    await clicar(botao("Cancelar", dialogo()!));
    expect(aoMudar).not.toHaveBeenCalled();
    expect(dialogo()).not.toBeNull();
  });

  it("o X e o Cancelar ficam aria-disabled, nunca disabled, e voltam quando a ação acaba", async () => {
    const aoMudar = vi.fn();
    await montar(<DialogoDoTeste ocupado aoMudar={aoMudar} />);
    for (const nome of ["Fechar", "Cancelar"]) {
      const elemento = botao(nome, dialogo()!)!;
      expect(elemento.getAttribute("aria-disabled"), nome).toBe("true");
      expect(elemento.disabled, nome).toBe(false);
    }
    expect(dialogo()!.hasAttribute("data-ocupado")).toBe(true);
    await montar(<DialogoDoTeste ocupado={false} aoMudar={aoMudar} />);
    for (const nome of ["Fechar", "Cancelar"]) expect(botao(nome, dialogo()!)!.hasAttribute("aria-disabled"), nome).toBe(false);
    expect(dialogo()!.hasAttribute("data-ocupado")).toBe(false);
  });

  it("parado, o Esc, o toque fora, o X e o Cancelar fecham", async () => {
    const aoMudar = vi.fn();
    await montar(<DialogoDoTeste ocupado={false} aoMudar={aoMudar} />);
    await esc();
    await tocarFora();
    await clicar(botao("Fechar", dialogo()!));
    await clicar(botao("Cancelar", dialogo()!));
    expect(aoMudar.mock.calls).toEqual([[false], [false], [false], [false]]);
  });

  it("o Cancelar sem onClick fecha pelo próprio diálogo, e não com a ação gravando", async () => {
    const aoMudar = vi.fn();
    await montar(<DialogoDoTeste ocupado semOnClickNoCancelar aoMudar={aoMudar} />);
    await clicar(botao("Cancelar", dialogo()!));
    expect(aoMudar).not.toHaveBeenCalled();
    await montar(<DialogoDoTeste ocupado={false} semOnClickNoCancelar aoMudar={aoMudar} />);
    await clicar(botao("Cancelar", dialogo()!));
    expect(aoMudar).toHaveBeenCalledWith(false);
  });

  it("o confirmar tocado segura o foco durante a ação: ele nunca cai no body", async () => {
    function Tela() {
      const [ocupado, setOcupado] = useState(false);
      return <DialogoDoTeste ocupado={ocupado} aoMudar={() => {}} aoConfirmar={() => setOcupado(true)} />;
    }
    await montar(<Tela />);
    const confirmar = botao("Cadastrar rua", dialogo()!)!;
    confirmar.focus();
    await clicar(confirmar);
    expect(document.activeElement).toBe(confirmar);
    expect(confirmar.disabled).toBe(false);
    expect(confirmar.getAttribute("aria-disabled")).toBe("true");
    // O Cancelar com o foco também o segura.
    const cancelar = botao("Cancelar", dialogo()!)!;
    cancelar.focus();
    await act(async () => {});
    expect(document.activeElement).toBe(cancelar);
  });

  it("no celular, o X tem 44 px e o rodapé fica preso embaixo, cobrindo até a borda", async () => {
    await montar(<DialogoDoTeste ocupado={false} aoMudar={() => {}} />);
    const x = botao("Fechar", dialogo()!)!;
    expect(x.className).toContain("max-md:size-11");
    const rodape = dialogo()!.querySelector("[data-rodape-do-dialogo]")!;
    for (const classe of ["max-md:sticky", "max-md:-bottom-6", "max-md:-mb-6", "max-md:pb-6", "max-md:bg-card", "max-md:[&_button]:min-h-11"]) {
      expect(rodape.className, classe).toContain(classe);
    }
    // O título não passa por baixo do X de 44 px.
    expect(dialogo()!.querySelector("h2")!.parentElement!.className).toContain("max-md:[&>h2]:px-7");
  });

  it("os textos do diálogo em ação são os rótulos, e passa no axe parado e gravando", async () => {
    await montar(<DialogoDoTeste ocupado aoMudar={() => {}} />);
    expect(textosDaTela(dialogo()!.outerHTML)).toEqual(["Nova rua", "Cancelar", "Cadastrar rua", "Cadastrando…", "Conferir", "Fechar"]);
    expect(await violacoesDeAcessibilidade(dialogo()!.outerHTML)).toEqual([]);
    await montar(<DialogoDoTeste ocupado={false} aoMudar={() => {}} />);
    expect(await violacoesDeAcessibilidade(dialogo()!.outerHTML)).toEqual([]);
  });
});

describe("o foco no fim", () => {
  function Pagina({ aberto, comGatilho, ocupado = false, onFechar }: { aberto: boolean; comGatilho: boolean; ocupado?: boolean; onFechar: () => void }) {
    return (
      <main>
        <h1>Posições</h1>
        {comGatilho ? <button type="button">Remover A-03</button> : null}
        <Dialog open={aberto} ocupado={ocupado} onOpenChange={(abrir) => (abrir ? undefined : onFechar())}>
          <DialogContent aria-describedby={undefined}>
            <DialogTitle>Remover a posição A-03?</DialogTitle>
            <DialogCancelar />
          </DialogContent>
        </Dialog>
      </main>
    );
  }

  async function fecharEsperar(no: ReactNode) {
    await montar(no);
    // O Radix devolve o foco num setTimeout depois de fechar.
    await act(async () => new Promise((pronto) => setTimeout(pronto, 10)));
  }

  it("volta ao controle que abriu o diálogo", async () => {
    await montar(<Pagina aberto={false} comGatilho onFechar={() => {}} />);
    const gatilho = botao("Remover A-03")!;
    gatilho.focus();
    await montar(<Pagina aberto comGatilho onFechar={() => {}} />);
    expect(dialogo()!.contains(document.activeElement)).toBe(true);
    await fecharEsperar(<Pagina aberto={false} comGatilho onFechar={() => {}} />);
    expect(document.activeElement).toBe(botao("Remover A-03"));
  });

  it("o gatilho que saiu da tela (a linha removida) leva o foco ao título da página, nunca ao body", async () => {
    await montar(<Pagina aberto={false} comGatilho onFechar={() => {}} />);
    botao("Remover A-03")!.focus();
    await montar(<Pagina aberto comGatilho onFechar={() => {}} />);
    await montar(<Pagina aberto comGatilho={false} onFechar={() => {}} />);
    await fecharEsperar(<Pagina aberto={false} comGatilho={false} onFechar={() => {}} />);
    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement?.tagName).toBe("H1");
    expect(document.activeElement?.getAttribute("tabindex")).toBe("-1");
  });

  it("o gatilho que sai logo depois do fim (a releitura tira a linha) também não deixa o foco no body", async () => {
    await montar(<Pagina aberto={false} comGatilho onFechar={() => {}} />);
    botao("Remover A-03")!.focus();
    await montar(<Pagina aberto comGatilho onFechar={() => {}} />);
    await fecharEsperar(<Pagina aberto={false} comGatilho onFechar={() => {}} />);
    expect(document.activeElement).toBe(botao("Remover A-03"));
    await montar(<Pagina aberto={false} comGatilho={false} onFechar={() => {}} />);
    await act(async () => {});
    expect(document.activeElement?.tagName).toBe("H1");
  });
});

describe("o painel (Sheet) em ação", () => {
  function Painel({ ocupado, aoMudar }: { ocupado: boolean; aoMudar: (aberto: boolean) => void }) {
    return (
      <Sheet open ocupado={ocupado} onOpenChange={aoMudar}>
        <SheetContent aria-describedby={undefined}>
          <SheetHeader>
            <SheetTitle>Seu pedido</SheetTitle>
          </SheetHeader>
        </SheetContent>
      </Sheet>
    );
  }

  it("com a ação gravando, o Esc, o toque fora e o X não fecham; o X fica aria-disabled e tem 44 px no celular", async () => {
    const aoMudar = vi.fn();
    await montar(<Painel ocupado aoMudar={aoMudar} />);
    await esc();
    await tocarFora();
    const x = botao("Fechar", dialogo()!)!;
    await clicar(x);
    expect(aoMudar).not.toHaveBeenCalled();
    expect(x.getAttribute("aria-disabled")).toBe("true");
    expect(x.disabled).toBe(false);
    expect(x.className).toContain("max-md:size-11");
    await montar(<Painel ocupado={false} aoMudar={aoMudar} />);
    await esc();
    expect(aoMudar).toHaveBeenCalledWith(false);
  });
});

describe("a confirmação (AlertDialog) em ação", () => {
  function Confirmar({ ocupado, aoMudar, aoConfirmar }: { ocupado: boolean; aoMudar: (aberto: boolean) => void; aoConfirmar: () => void }) {
    return (
      <AlertDialog open ocupado={ocupado} onOpenChange={aoMudar}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Arquivar BTG?</AlertDialogTitle>
            <AlertDialogDescription>O portal do cliente é desligado.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction estado={ocupado ? "andamento" : "repouso"} rotulo="Arquivar" andamento="Arquivando…" onClick={aoConfirmar} />
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    );
  }

  it("o confirmar chama a ação e não fecha: quem fecha é o sucesso", async () => {
    const aoMudar = vi.fn();
    const aoConfirmar = vi.fn();
    await montar(<Confirmar ocupado={false} aoMudar={aoMudar} aoConfirmar={aoConfirmar} />);
    await clicar(botao("Arquivar", dialogo()!));
    expect(aoConfirmar).toHaveBeenCalledTimes(1);
    expect(aoMudar).not.toHaveBeenCalled();
    expect(dialogo()).not.toBeNull();
  });

  it("com a ação gravando, o Esc e o Cancelar não fecham, o Cancelar fica aria-disabled e o confirmar não chama de novo", async () => {
    const aoMudar = vi.fn();
    const aoConfirmar = vi.fn();
    await montar(<Confirmar ocupado aoMudar={aoMudar} aoConfirmar={aoConfirmar} />);
    await esc();
    const cancelar = botao("Cancelar", dialogo()!)!;
    await clicar(cancelar);
    await clicar(dialogo()!.querySelector<HTMLButtonElement>(".botao-acao")!);
    expect(aoMudar).not.toHaveBeenCalled();
    expect(aoConfirmar).not.toHaveBeenCalled();
    expect(cancelar.getAttribute("aria-disabled")).toBe("true");
    expect(cancelar.disabled).toBe(false);
    const confirmar = dialogo()!.querySelector<HTMLButtonElement>(".botao-acao")!;
    expect(confirmar.getAttribute("aria-disabled")).toBe("true");
    expect(confirmar.disabled).toBe(false);
    expect(await violacoesDeAcessibilidade(dialogo()!.outerHTML)).toEqual([]);
  });

  it("parada, o Esc e o Cancelar fecham", async () => {
    const aoMudar = vi.fn();
    await montar(<Confirmar ocupado={false} aoMudar={aoMudar} aoConfirmar={() => {}} />);
    await esc();
    await clicar(botao("Cancelar", dialogo()!));
    expect(aoMudar.mock.calls).toEqual([[false], [false]]);
  });
});
