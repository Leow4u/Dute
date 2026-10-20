/*
 * Para quem é o arquivo. O build normal tem os dois perfis (portal e operação
 * Dutelog), para apresentar. O build "cliente" (vite --mode cliente) tem só o
 * portal: é o que vai por link para a empresa testar sozinha.
 */
declare const __DEMO_CLIENT_ONLY__: boolean | undefined;

export const CLIENT_ONLY = typeof __DEMO_CLIENT_ONLY__ !== "undefined" && __DEMO_CLIENT_ONLY__ === true;
