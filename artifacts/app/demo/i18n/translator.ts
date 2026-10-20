/*
 * Tradução da demo para inglês sem tocar no app: um observador troca, no
 * DOM, os textos em português pelos do dicionário (en.ts). O React só
 * escreve texto; quando ele reescreve em português, o observador traduz de
 * novo antes da tela ser pintada.
 */
import { EN_PHRASES } from "./en";
import { EN_RULES } from "./rules";

const ATTRIBUTES = ["placeholder", "aria-label", "title", "alt"] as const;

function translateCore(core: string): string | undefined {
  const exact = EN_PHRASES[core];
  if (exact !== undefined) return exact;
  for (const [pattern, replacement] of EN_RULES) {
    const match = core.match(pattern);
    if (match) return replacement(...match.slice(1));
  }
  // Partes separadas por " · " (status · cliente · quantidade) são traduzidas uma a uma.
  if (core.includes(" · ")) {
    const parts = core.split(" · ");
    const translated = parts.map((part) => translateCore(part.trim()) ?? part);
    if (translated.some((part, index) => part !== parts[index])) return translated.join(" · ");
  }
  return undefined;
}

export function translate(text: string): string {
  const core = text.trim();
  if (!core) return text;
  const next = translateCore(core);
  if (next === undefined || next === core) return text;
  const start = text.indexOf(core);
  return text.slice(0, start) + next + text.slice(start + core.length);
}

/** Texto montado no código da demo: traduz quando a demo está em inglês. */
export function t(text: string, english: boolean): string {
  return english ? translate(text) : text;
}

function skip(node: Node) {
  const parent = node.parentElement;
  return !parent || Boolean(parent.closest("textarea, script, style, [data-no-translate]"));
}

function translateTextNode(node: Text) {
  if (skip(node)) return;
  const value = node.nodeValue ?? "";
  const next = translate(value);
  if (next !== value) node.nodeValue = next;
}

function translateAttributes(element: Element) {
  for (const name of ATTRIBUTES) {
    const value = element.getAttribute(name);
    if (!value) continue;
    const next = translate(value);
    if (next !== value) element.setAttribute(name, next);
  }
}

function translateTree(root: Node) {
  if (root.nodeType === Node.TEXT_NODE) {
    translateTextNode(root as Text);
    return;
  }
  if (root.nodeType !== Node.ELEMENT_NODE) return;
  translateAttributes(root as Element);
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  let node = walker.nextNode();
  while (node) {
    if (node.nodeType === Node.TEXT_NODE) translateTextNode(node as Text);
    else translateAttributes(node as Element);
    node = walker.nextNode();
  }
}

export function installTranslator() {
  translateTree(document.body);
  document.title = translate(document.title);
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === "characterData") translateTextNode(mutation.target as Text);
      else if (mutation.type === "attributes") translateAttributes(mutation.target as Element);
      else mutation.addedNodes.forEach(translateTree);
    }
  });
  observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: [...ATTRIBUTES] });
}
