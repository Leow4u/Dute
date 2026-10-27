// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";

import { PasswordInput } from "./password-input";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

it("mostra e oculta a senha sem alterar o valor nem enviar o formulário", async () => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  let envios = 0;
  try {
    await act(async () => root.render(
      <form onSubmit={(event) => { event.preventDefault(); envios++; }}>
        <label htmlFor="senha">Senha</label>
        <PasswordInput id="senha" name="senha" defaultValue="Senha-de-teste!" autoComplete="current-password" required />
        <button type="submit">Entrar</button>
      </form>,
    ));
    const input = container.querySelector("input")!;
    expect(input.type).toBe("password");
    const mostrar = container.querySelector<HTMLButtonElement>('button[aria-label="Mostrar senha"]');
    expect(mostrar).not.toBeNull();
    await act(async () => mostrar!.click());
    expect(input.type).toBe("text");
    expect(input.value).toBe("Senha-de-teste!");
    expect(input.autocomplete).toBe("current-password");
    const ocultar = container.querySelector<HTMLButtonElement>('button[aria-label="Ocultar senha"]');
    expect(ocultar).not.toBeNull();
    await act(async () => ocultar!.click());
    expect(input.type).toBe("password");
    expect(input.value).toBe("Senha-de-teste!");
    expect(envios).toBe(0);
    for (let i = 0; i < 4; i++) {
      await act(async () => mostrar!.click());
      expect(input.type).toBe(i % 2 === 0 ? "text" : "password");
      expect(input.value).toBe("Senha-de-teste!");
    }
    expect(envios).toBe(0);
    await act(async () => container.querySelector<HTMLButtonElement>('button[type="submit"]')!.click());
    expect(envios).toBe(1);
    expect(new FormData(container.querySelector("form")!).get("senha")).toBe("Senha-de-teste!");
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
