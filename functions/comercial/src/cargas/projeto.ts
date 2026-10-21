import { relative, resolve, join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { COMERCIAL_AMBIENTES_LIBERADOS, comercialLiberado } from "../domain/liberacao.js";

/** Raiz do repositório (src/cargas e lib/cargas ficam à mesma distância). */
export const RAIZ_DO_REPOSITORIO_CARGAS = fileURLToPath(new URL("../../../../", import.meta.url));

const PASTAS_IGNORADAS = ["tmp", ".secrets"];

function dentro(pasta: string, caminho: string): boolean {
  const rel = relative(pasta, caminho);
  return rel === "" || (!rel.startsWith("..") && !rel.startsWith(sep) && !/^[A-Za-z]:/.test(rel));
}

/**
 * Onde a carga pode gravar: projeto com o Comercial liberado
 * (domain/liberacao.ts) ou projeto de emulador ("demo-") com o emulador
 * ligado. Devolve o motivo da recusa, ou null. Vale para as três cargas.
 */
export function podeGravarNoProjeto(projeto: string, env: Record<string, string | undefined>): string | null {
  // A tela e as callables do Comercial estão na produção. A importação em
  // massa não: ela espera um passo próprio, com dry-run e OK.
  if (projeto === "dute-prod" || projeto === "dute-btg") {
    return (
      `A carga em massa não grava no projeto ${projeto}. ` +
      "A tela e as callables podem atender; a importação espera um passo próprio, com dry-run e o OK do Leonardo."
    );
  }
  if (comercialLiberado(projeto)) return null;
  if (projeto.startsWith("demo-")) {
    return env.FIRESTORE_EMULATOR_HOST
      ? null
      : `O projeto ${projeto} é de emulador: rode com o emulador do Firestore ligado (FIRESTORE_EMULATOR_HOST).`;
  }
  return (
    `O Comercial não está liberado no projeto ${projeto} (liberado em: ${COMERCIAL_AMBIENTES_LIBERADOS.join(", ")}). ` +
    "A carga só grava onde as callables do Comercial atendem; a produção entra na parte 17, com o OK do Leonardo."
  );
}

/**
 * Arquivo de carga com dado sensível (preço, contrato) dentro do repositório
 * só em tmp/ ou .secrets/, que o git ignora. Devolve o motivo da recusa, ou null.
 */
export function problemaDoArquivoNoRepositorio(arquivo: string, raiz = RAIZ_DO_REPOSITORIO_CARGAS): string | null {
  const caminho = resolve(arquivo);
  const raizResolvida = resolve(raiz);
  if (dentro(raizResolvida, caminho) && !PASTAS_IGNORADAS.some((pasta) => dentro(join(raizResolvida, pasta), caminho))) {
    return `O arquivo ${caminho} está dentro do repositório fora de tmp/ e .secrets/: ele tem dado sensível e o git não o ignora. Guarde-o fora do repositório.`;
  }
  return null;
}
