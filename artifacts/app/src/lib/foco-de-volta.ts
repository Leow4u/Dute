import { CARREGANDO } from "@/lib/carregando/tempo";

/**
 * O foco que volta quando o diálogo fecha (carregamento v2, parte 13a; WCAG
 * 2.4.3): ao controle que abriu o diálogo e, se ele saiu da tela, ao lugar
 * certo dela (o vizinho dele ou o título). Nunca ao `body`, onde o Radix o deixa quando o gatilho sumiu (a
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
 * Os vizinhos do controle na ordem do Tab, lidos quando o diálogo abre: o
 * seguinte e o anterior, fora dos diálogos e dos menus. Quando o controle sai
 * da tela (a linha removida), o foco vai ao vizinho que ficou, perto de onde a
 * pessoa estava: o controle da linha seguinte ou, sem ela, o da anterior
 * (carregamento v2, momento 4). Quem está escondido agora (o menu aberto
 * esconde o resto da tela) é conferido só no fim.
 */
export function vizinhosDoFoco(alvo: HTMLElement): HTMLElement[] {
  // O controle dentro de outro diálogo (o "Ver pedido" do painel que dá lugar a outro) não tem vizinho na página.
  if (alvo.closest('[role="dialog"], [role="alertdialog"]')) return [];
  const documento = alvo.ownerDocument;
  const fila = Array.from(documento.querySelectorAll<HTMLElement>(FOCAVEL)).filter(
    (elemento) =>
      elemento === alvo ||
      (elemento.tabIndex >= 0 &&
        !(elemento as HTMLButtonElement).disabled &&
        !elemento.closest('[role="dialog"], [role="alertdialog"], [role="menu"], [inert], [hidden]')),
  );
  const lugar = fila.indexOf(alvo);
  if (lugar < 0) return [];
  return [fila[lugar + 1], fila[lugar - 1]].filter((elemento): elemento is HTMLElement => Boolean(elemento));
}

/**
 * O lugar certo da tela quando o gatilho saiu e não há vizinho: o título da
 * página (o `h1` da área principal). Sem título, a área principal.
 */
export function lugarPadraoDoFoco(documento: Document = document): HTMLElement | null {
  return (
    documento.querySelector<HTMLElement>("main h1") ??
    documento.querySelector<HTMLElement>("h1") ??
    documento.querySelector<HTMLElement>("main")
  );
}

/** Fora da vista: inteiro acima do topo ou abaixo do fim da janela. */
function foraDaVista(elemento: HTMLElement): boolean {
  const caixa = elemento.getBoundingClientRect();
  const janela = elemento.ownerDocument.defaultView;
  const altura = janela?.innerHeight ?? 0;
  return caixa.bottom < 0 || (altura > 0 && caixa.top > altura);
}

/**
 * Põe o foco no elemento; o que não é focável por natureza (o título) recebe
 * `tabindex="-1"`. Não rola a tela, salvo o que está fora da vista (o título
 * da lista longa e rolada): ele vem até a borda mais perto, para o foco
 * aparecer (WCAG 2.4.7).
 */
export function focarSemRolar(elemento: HTMLElement) {
  if (!elemento.matches(FOCAVEL)) {
    elemento.setAttribute("tabindex", "-1");
    elemento.setAttribute("data-foco-de-volta", "");
  }
  elemento.focus({ preventScroll: true });
  if (foraDaVista(elemento) && typeof elemento.scrollIntoView === "function") elemento.scrollIntoView({ block: "nearest" });
}

/**
 * O lugar do foco quando o aviso da falha sai da tela com ele (a nova
 * tentativa que deu certo; carregamento v2, parte 13e): o título da seção ou
 * do diálogo onde o aviso morava e, sem ele, o título da página. Dentro do
 * diálogo, nunca fora dele.
 */
export function lugarDaSecao(elemento: HTMLElement): HTMLElement | null {
  const caixa = elemento.closest<HTMLElement>('[role="dialog"], [role="alertdialog"], section, [role="region"]');
  const titulo = caixa?.querySelector<HTMLElement>("h1, h2, h3, h4, h5, h6");
  if (titulo) return titulo;
  if (caixa?.matches('[role="dialog"], [role="alertdialog"]')) return caixa;
  return lugarPadraoDoFoco(elemento.ownerDocument);
}

/**
 * O foco se perdeu com a saída de quem o tinha: está no `body`, num elemento
 * que já saiu da tela ou no próprio diálogo onde ele estava (`dentroDe`, o
 * lugar de quem saiu): o Radix põe o foco no diálogo quando o elemento focado
 * sai, para ele não escapar, e o lugar certo ainda é o que quem saiu pediu
 * (revisão da parte 13i).
 */
export function focoPerdido(documento: Document, dentroDe?: Element | null): boolean {
  const ativo = documento.activeElement;
  if (!ativo || ativo === documento.body || !ativo.isConnected) return true;
  return Boolean(dentroDe?.isConnected && ativo !== dentroDe && ativo.matches('[role="dialog"], [role="alertdialog"]') && ativo.contains(dentroDe));
}

/**
 * O foco que estava dentro de `elemento` quando ele sai da tela não fica no
 * `body` (WCAG 2.4.3): depois do commit, se o foco caiu, ele vai ao `destino`
 * (lido agora, com o elemento ainda na tela) ou, se o destino também saiu, ao
 * título da página. Para chamar no fim do `useLayoutEffect`, que roda antes
 * de o elemento sair.
 */
export function segurarOFocoQueSai(
  elemento: HTMLElement,
  destino: HTMLElement | null | (() => HTMLElement | null | undefined) = lugarDaSecao(elemento),
) {
  const documento = elemento.ownerDocument;
  if (!elemento.contains(documento.activeElement)) return;
  const lugar = elemento.parentElement;
  queueMicrotask(() => {
    if (!focoPerdido(documento, lugar)) return;
    // O destino que só entra na tela com a saída (o "Editar" que volta no lugar do formulário) é lido depois dela.
    const preferido = typeof destino === "function" ? destino() : destino;
    const alvo = [preferido, lugarPadraoDoFoco(documento)].find(podeReceberFoco);
    if (alvo) focarSemRolar(alvo);
  });
}

/** O primeiro lugar que ainda pode receber o foco: o pedido por quem usa, os vizinhos e o título. */
function destinoNoLugar(documento: Document, lugar?: () => HTMLElement | null | undefined, vizinhos: readonly HTMLElement[] = []) {
  return [lugar?.(), ...vizinhos, lugarPadraoDoFoco(documento)].find(podeReceberFoco);
}

let vigiaAtual: (() => void) | null = null;

/**
 * Fica de olho no controle que recebeu o foco de volta: se ele sair da tela
 * com o foco (a linha que a releitura tirou depois do sucesso), o foco vai
 * para o lugar certo, e não fica no `body`. A vigia acaba quando o foco sai
 * dele, para outro controle ou para um lugar sem foco (o clique no fundo da
 * página), ou depois de `CARREGANDO.desisteMs`, o prazo da releitura.
 */
export function vigiarFocoDeVolta(alvo: HTMLElement, lugar?: () => HTMLElement | null | undefined) {
  vigiaAtual?.();
  const documento = alvo.ownerDocument;
  if (typeof MutationObserver === "undefined") return;
  const vizinhos = vizinhosDoFoco(alvo);
  const parar = () => {
    observador.disconnect();
    documento.removeEventListener("focusin", aoFocar, true);
    alvo.removeEventListener("focusout", aoSair);
    clearTimeout(prazo);
    if (vigiaAtual === parar) vigiaAtual = null;
  };
  const aoFocar = (evento: FocusEvent) => {
    if (evento.target !== alvo) parar();
  };
  // O foco saiu do controle que continua na tela: a pessoa agiu, e a vigia
  // acaba. Na saída pela remoção (o Chrome avisa o blur antes de tirar o
  // controle), ele já não está na tela quando a conferência roda, e quem
  // cuida é o observador.
  const aoSair = () => {
    queueMicrotask(() => {
      if (alvo.isConnected) parar();
    });
  };
  const observador = new MutationObserver(() => {
    if (alvo.isConnected) return;
    const ativo = documento.activeElement;
    if (ativo && ativo !== documento.body) {
      parar();
      return;
    }
    parar();
    const destino = destinoNoLugar(documento, lugar, vizinhos);
    if (destino) focarSemRolar(destino);
  });
  observador.observe(documento.body, { childList: true, subtree: true });
  documento.addEventListener("focusin", aoFocar, true);
  alvo.addEventListener("focusout", aoSair);
  const prazo = setTimeout(parar, CARREGANDO.desisteMs);
  vigiaAtual = parar;
}

/**
 * O fim do diálogo (o `onCloseAutoFocus` do Radix): se quem usa o diálogo não
 * levou o foco a outro lugar, ele volta ao controle que abriu; se esse saiu,
 * ao `lugar` pedido, ao vizinho dele que ficou (lido na abertura) ou ao
 * título. Depois, a vigia segura o caso em que o controle sai logo depois (a
 * linha removida pela releitura).
 */
export function devolverFocoAoFechar(
  evento: Event,
  abridor: HTMLElement | null,
  lugar?: () => HTMLElement | null | undefined,
  vizinhos: readonly HTMLElement[] = [],
) {
  if (evento.defaultPrevented || typeof document === "undefined") return;
  const destino = podeReceberFoco(abridor) ? abridor : destinoNoLugar(document, lugar, vizinhos);
  if (!destino) return;
  evento.preventDefault();
  if (destino === abridor) destino.focus({ preventScroll: true });
  else focarSemRolar(destino);
  vigiarFocoDeVolta(destino, lugar);
}
