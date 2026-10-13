/*
 * Em inglês, números e datas saem no padrão americano. O app formata tudo
 * com Intl e toLocale*String("pt-BR"); aqui o "pt-BR" vira "en-US".
 */
type AnyFn = (...args: never[]) => unknown;

function mapLocale(locales: unknown) {
  if (locales === undefined) return "en-US";
  if (typeof locales === "string") return /^pt/i.test(locales) ? "en-US" : locales;
  if (Array.isArray(locales)) return locales.map((entry) => (typeof entry === "string" && /^pt/i.test(entry) ? "en-US" : entry));
  return locales;
}

function wrapConstructor<T extends abstract new (...args: never[]) => unknown>(name: keyof typeof Intl) {
  const Original = Intl[name] as unknown as T & { supportedLocalesOf?: AnyFn };
  if (!Original) return;
  const Wrapped = function (this: unknown, locales?: unknown, options?: unknown) {
    return new (Original as unknown as new (l: unknown, o: unknown) => unknown)(mapLocale(locales), options);
  } as unknown as T;
  Object.setPrototypeOf(Wrapped, Original);
  (Wrapped as unknown as { prototype: unknown }).prototype = (Original as unknown as { prototype: unknown }).prototype;
  (Intl as unknown as Record<string, unknown>)[name] = Wrapped;
}

function wrapMethod(target: object, name: string) {
  const original = (target as Record<string, AnyFn>)[name];
  (target as Record<string, unknown>)[name] = function (this: unknown, locales?: unknown, options?: unknown) {
    return (original as unknown as (this: unknown, l: unknown, o: unknown) => unknown).call(this, mapLocale(locales), options);
  };
}

export function installEnglishLocale() {
  for (const name of ["NumberFormat", "DateTimeFormat", "PluralRules", "RelativeTimeFormat", "ListFormat"] as const) wrapConstructor(name);
  wrapMethod(Number.prototype, "toLocaleString");
  wrapMethod(Date.prototype, "toLocaleString");
  wrapMethod(Date.prototype, "toLocaleDateString");
  wrapMethod(Date.prototype, "toLocaleTimeString");
  document.documentElement.lang = "en";
}
