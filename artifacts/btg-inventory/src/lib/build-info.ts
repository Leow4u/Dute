declare const __BUILD_COMMIT__: string | undefined;
declare const __BUILD_TIME__: string | undefined;

/** Versão deste build (definida no vite.config.ts a partir do git). */
export const BUILD_COMMIT =
  typeof __BUILD_COMMIT__ === "string" && __BUILD_COMMIT__ ? __BUILD_COMMIT__ : "desconhecida";

export const BUILD_TIME =
  typeof __BUILD_TIME__ === "string" && __BUILD_TIME__ ? __BUILD_TIME__ : null;
