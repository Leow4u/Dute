/* Idioma da demo, escolhido na tela de entrada e guardado no navegador. */
export type Lang = "pt" | "en";

const KEY = "dute.demo.lang";

function read(): Lang {
  try {
    return window.localStorage.getItem(KEY) === "en" ? "en" : "pt";
  } catch {
    return "pt";
  }
}

export const LANG: Lang = typeof window === "undefined" ? "pt" : read();
export const isEnglish = LANG === "en";

export function setLang(lang: Lang) {
  try {
    window.localStorage.setItem(KEY, lang);
  } catch {
    // Sem storage: vale só nesta visita.
  }
}

/** Texto nos dois idiomas, para o que a demo monta no código (dados, respostas do agente). */
export function pick<T>(pt: T, en: T): T {
  return isEnglish ? en : pt;
}
