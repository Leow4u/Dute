import { CARREGANDO } from "@/lib/carregando/tempo";

/**
 * O foco que volta quando o diálogo fecha (carregamento v2, parte 13a; WCAG
 * 2.4.3): ao controle que abriu o diálogo e, se ele saiu da tela, ao lugar
 * certo dela. Nunca ao `body`, onde o Radix o deixa quando o gatilho sumiu (a
 * linha removida, o item do menu "⋯" que fechou) e de onde o Tab recomeça do
 * topo da página.
 */

/** Quem recebe foco sem `tabindex`. */
const FOCAVEL = 'a[href], button, input, select, textarea, summary, [tabindex], [contenteditable="true"]';

/**
 * O controle que abriu o diálogo, lido na abertura. O item do menu "⋯" sai da
 * tela quando o menu fecha: quem fica é o botão que abriu o menu (o
 * `aria-labelledby` do menu do Radix).
 */
export function abridorDoDialogo(ativo: Element | null = typeof document === "undefined" ? null : document.activeElement): HTMLElement | null {
  if (!(ativo instanceof HTMLElement) || ativo === ativo.ownerDocument.body) return null;
  const menu = ativo.closest('[role="menu"]');
  const rotulo = menu?.getAttribute("aria-labelledby");
  if (menu && rotulo) {
    const gatilho = ativo.ownerDocument.getElementById(rotulo);
    if (gatilho instanceof HTMLElement) return gatilho;
  }
  return ativo;
}

/** Ainda na tela e capaz de receber o foco: conectado, sem `disabled`, fora de `inert` e de `aria-hidden`. */
export function podeReceberFoco(elemento: HTMLElement | null | undefined): elemento is HTMLElement {
  if (!elemento || !elemento.isConnected) return false;
  if ((elemento as HTMLButtonElement).disabled) return false;
  if (elemento.closest("[inert], [aria-hidden='true'], [hidden]")) return false;
  return true;
}

/**
 * O lugar certo da tela quando o gatilho saiu: o título da página (o `h1` da
 * área principal), que recebe o foco sem rolar. Sem título, a área principal.
 */
export function lugarPadraoDoFoco(documento: Document = document): HTMLElement | null {
  return (
    documento.querySelector<HTMLElement>("main h1") ??
    documento.querySelector<HTMLElement>("h1") ??
    documento.querySelector<HTMLElement>("main")
  );
}

/** Põe o foco no elemento; o que não é focável por natureza (o título) recebe `tabindex="-1"`. Não rola a tela. */
export function focarSemRolar(elemento: HTMLElement) {
  if (!elemento.matches(FOCAVEL)) {
    elemento.setAttribute("tabindex", "-1");
    elemento.setAttribute("data-foco-de-volta", "");
  }
  elemento.focus({ preventScroll: true });
}

let vigiaAtual: (() => void) | null = null;

/**
 * Fica de olho no controle que recebeu o foco de volta: se ele sair da tela
 * com o foco (a linha que a releitura tirou depois do sucesso), o foco vai
 * para o lugar certo, e não fica no `body`. A vigia acaba quando o foco vai
 * para outro lugar, ou depois de `CARREGANDO.desisteMs`, o prazo da releitura.
 */
export function vigiarFocoDeVolta(alvo: HTMLElement, lugar?: () => HTMLElement | null | undefined) {
  vigiaAtual?.();
  const documento = alvo.ownerDocument;
  if (typeof MutationObserver === "undefined") return;
  const parar = () => {
    observador.disconnect();
    documento.removeEventListener("focusin", aoFocar, true);
    clearTimeout(prazo);
    if (vigiaAtual === parar) vigiaAtual = null;
  };
  const aoFocar = (evento: FocusEvent) => {
    if (evento.target !== alvo) parar();
  };
  const observador = new MutationObserver(() => {
    if (alvo.isConnected) return;
    const ativo = documento.activeElement;
    if (ativo && ativo !== documento.body) {
      parar();
      return;
    }
    parar();
    const destino = [lugar?.(), lugarPadraoDoFoco(documento)].find(podeReceberFoco);
    if (destino) focarSemRolar(destino);
  });
  observador.observe(documento.body, { childList: true, subtree: true });
  documento.addEventListener("focusin", aoFocar, true);
  const prazo = setTimeout(parar, CARREGANDO.desisteMs);
  vigiaAtual = parar;
}

/**
 * O fim do diálogo (o `onCloseAutoFocus` do Radix): se quem usa o diálogo não
 * levou o foco a outro lugar, ele volta ao controle que abriu; se esse saiu,
 * ao `lugar` pedido ou ao padrão. Depois, a vigia segura o caso em que o
 * controle sai logo depois (a linha removida pela releitura).
 */
export function devolverFocoAoFechar(evento: Event, abridor: HTMLElement | null, lugar?: () => HTMLElement | null | undefined) {
  if (evento.defaultPrevented || typeof document === "undefined") return;
  const destino = podeReceberFoco(abridor) ? abridor : [lugar?.(), lugarPadraoDoFoco()].find(podeReceberFoco);
  if (!destino) return;
  evento.preventDefault();
  if (destino === abridor) destino.focus({ preventScroll: true });
  else focarSemRolar(destino);
  vigiarFocoDeVolta(destino, lugar);
}
