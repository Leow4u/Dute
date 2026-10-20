/*
 * Primeiro import da demo. Em inglês, troca o locale e liga o tradutor antes
 * de qualquer módulo do app criar seus formatadores (Intl.NumberFormat etc.
 * no topo do arquivo), para não sobrar data ou número no padrão brasileiro.
 */
import { isEnglish } from "./lang";
import { installEnglishLocale } from "./locale";
import { installTranslator } from "./translator";

if (isEnglish) {
  installEnglishLocale();
  installTranslator();
}
