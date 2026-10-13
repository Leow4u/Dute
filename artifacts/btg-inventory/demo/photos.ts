/* Fotos ilustrativas dos itens da demo: ícone do produto sobre fundo claro. */
import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  Aperture,
  Armchair,
  Coffee,
  CupSoda,
  Cylinder,
  FileText,
  Flag,
  Frame,
  Gift,
  LampFloor,
  Layers,
  LayoutPanelTop,
  Mic,
  Presentation,
  RectangleHorizontal,
  RectangleVertical,
  Shirt,
  ShoppingBag,
  Sofa,
  Sparkles,
  Speaker,
  Sticker,
  StickyNote,
  Store,
  Tent,
  Zap,
} from "lucide-react";

type IconProps = { size: number; color: string; strokeWidth: number; x: number; y: number };

export const ICONS = {
  aperture: Aperture,
  armchair: Armchair,
  coffee: Coffee,
  cup: CupSoda,
  cylinder: Cylinder,
  file: FileText,
  flag: Flag,
  frame: Frame,
  gift: Gift,
  lamp: LampFloor,
  layers: Layers,
  shelf: LayoutPanelTop,
  mic: Mic,
  presentation: Presentation,
  table: RectangleHorizontal,
  totem: RectangleVertical,
  shirt: Shirt,
  bag: ShoppingBag,
  sofa: Sofa,
  sparkles: Sparkles,
  speaker: Speaker,
  sticker: Sticker,
  note: StickyNote,
  store: Store,
  tent: Tent,
  zap: Zap,
} as const satisfies Record<string, unknown>;

export type IconName = keyof typeof ICONS;

/** Cor do traço pelo acabamento do item. */
const TONES: Record<string, string> = {
  rosa: "#E8174A",
  ciano: "#0BA7A3",
  preto: "#17171C",
  preta: "#17171C",
  branca: "#6B7280",
  branco: "#6B7280",
};

const cache = new Map<string, string>();

export function productPhoto(icon: IconName, finish = "") {
  const key = `${icon}:${finish}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const color = TONES[finish.toLowerCase()] ?? "#17171C";
  const Icon = ICONS[icon] as unknown as ComponentType<IconProps>;
  const glyph = renderToStaticMarkup(createElement(Icon, { size: 136, color, strokeWidth: 1.15, x: 92, y: 84 }));
  const svg = [
    '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="320" viewBox="0 0 320 320">',
    "<defs>",
    '<radialGradient id="a" cx="0.18" cy="0.12" r="0.75"><stop offset="0" stop-color="#25F4EE" stop-opacity="0.32"/><stop offset="1" stop-color="#25F4EE" stop-opacity="0"/></radialGradient>',
    '<radialGradient id="b" cx="0.9" cy="0.92" r="0.75"><stop offset="0" stop-color="#FE2C55" stop-opacity="0.26"/><stop offset="1" stop-color="#FE2C55" stop-opacity="0"/></radialGradient>',
    "</defs>",
    '<rect width="320" height="320" fill="#F4F4F6"/>',
    '<rect width="320" height="320" fill="url(#a)"/>',
    '<rect width="320" height="320" fill="url(#b)"/>',
    '<ellipse cx="160" cy="248" rx="86" ry="10" fill="#17171C" opacity="0.07"/>',
    glyph,
    "</svg>",
  ].join("");
  const url = `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
  cache.set(key, url);
  return url;
}
