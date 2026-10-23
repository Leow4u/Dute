type Registro = Record<string, unknown>;

/** O JSON com as chaves em ordem, em qualquer nível: o Firestore não devolve os mapas na ordem gravada. */
export function estavel(valor: unknown): string {
  if (Array.isArray(valor)) return `[${valor.map(estavel).join(",")}]`;
  if (valor && typeof valor === "object") {
    const registro = valor as Registro;
    return `{${Object.keys(registro)
      .sort()
      .map((chave) => `${JSON.stringify(chave)}:${estavel(registro[chave])}`)
      .join(",")}}`;
  }
  return JSON.stringify(valor ?? null);
}

/** O documento sem o instante do cálculo, para saber se o que ele guarda mudou. */
export function semInstante(dados: Registro): string {
  const { calculada_em: _instante, ...resto } = dados;
  return estavel(resto);
}
