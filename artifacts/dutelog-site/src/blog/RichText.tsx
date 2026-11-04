import { Fragment, type ReactNode } from "react";
import { safeImageSrc, safeLink, type RichNode } from "./model";

const containerTypes = new Set([
  "doc",
  "paragraph",
  "heading",
  "bulletList",
  "orderedList",
  "listItem",
  "blockquote",
]);
export function safeImageSource(value: unknown): string | undefined {
  return typeof value === "string" && safeImageSrc(value) ? value : undefined;
}

export function safeLinkHref(value: unknown): string | undefined {
  return typeof value === "string" && safeLink(value) ? value : undefined;
}

function childrenOf(node: RichNode): RichNode[] {
  return Array.isArray(node.content)
    ? node.content.filter((child) => child && typeof child.type === "string")
    : [];
}

function plainText(node: RichNode, depth = 0): string {
  if (depth > 20) return "";
  if (node.type === "text")
    return typeof node.text === "string" ? node.text : "";
  return childrenOf(node)
    .map((child) => plainText(child, depth + 1))
    .join("");
}

const headingId = (path: number[]) => `artigo-${path.join("-")}`;

export type RichHeading = { id: string; title: string; level: number };

export function richHeadings(document: RichNode): RichHeading[] {
  const result: RichHeading[] = [];
  let visited = 0;
  function visit(node: RichNode, path: number[]) {
    if (
      !node ||
      path.length > 20 ||
      ++visited > 5000 ||
      !containerTypes.has(node.type)
    )
      return;
    const level = node.attrs?.level;
    if (node.type === "heading" && (level === 2 || level === 3)) {
      result.push({ id: headingId(path), title: plainText(node), level });
    }
    childrenOf(node).forEach((child, index) => visit(child, [...path, index]));
  }
  if (document?.type === "doc") visit(document, []);
  return result;
}

export function RichText({ document }: { document: RichNode }) {
  let visited = 0;
  function renderNode(node: RichNode, path: number[]): ReactNode {
    if (!node || path.length > 20 || ++visited > 5000) return null;
    const key = path.join("-");
    if (node.type === "text") {
      let rendered: ReactNode = typeof node.text === "string" ? node.text : "";
      for (const mark of Array.isArray(node.marks)
        ? node.marks.slice(0, 12)
        : []) {
        if (
          !mark ||
          typeof mark !== "object" ||
          Array.isArray(mark) ||
          typeof mark.type !== "string"
        )
          continue;
        switch (mark.type) {
          case "bold":
            rendered = <strong>{rendered}</strong>;
            break;
          case "italic":
            rendered = <em>{rendered}</em>;
            break;
          case "strike":
            rendered = <s>{rendered}</s>;
            break;
          case "underline":
            rendered = <u>{rendered}</u>;
            break;
          case "code":
            rendered = <code>{rendered}</code>;
            break;
          case "link": {
            const href = safeLinkHref(mark.attrs?.href);
            if (href)
              rendered = (
                <a href={href} rel="noopener noreferrer">
                  {rendered}
                </a>
              );
            break;
          }
        }
      }
      return <Fragment key={key}>{rendered}</Fragment>;
    }
    if (node.type === "image") {
      const src = safeImageSource(node.attrs?.src);
      if (!src) return null;
      return (
        <figure key={key} className="article-rich-image">
          <img
            src={src}
            alt={typeof node.attrs?.alt === "string" ? node.attrs.alt : ""}
            loading="lazy"
            decoding="async"
          />
        </figure>
      );
    }
    if (node.type === "hardBreak") return <br key={key} />;
    if (node.type === "horizontalRule") return <hr key={key} />;
    if (!containerTypes.has(node.type)) return null;
    const children = childrenOf(node).map((child, index) =>
      renderNode(child, [...path, index]),
    );
    switch (node.type) {
      case "doc":
        return <Fragment key={key}>{children}</Fragment>;
      case "paragraph":
        return <p key={key}>{children}</p>;
      case "heading": {
        const id = headingId(path);
        if (node.attrs?.level === 2)
          return (
            <h2 key={key} id={id} tabIndex={-1}>
              {children}
            </h2>
          );
        if (node.attrs?.level === 3)
          return (
            <h3 key={key} id={id} tabIndex={-1}>
              {children}
            </h3>
          );
        return <p key={key}>{children}</p>;
      }
      case "bulletList":
        return <ul key={key}>{children}</ul>;
      case "orderedList": {
        const start = node.attrs?.start;
        return (
          <ol
            key={key}
            start={
              typeof start === "number" &&
              Number.isInteger(start) &&
              start >= 1 &&
              start <= 9999
                ? start
                : undefined
            }
          >
            {children}
          </ol>
        );
      }
      case "listItem":
        return <li key={key}>{children}</li>;
      case "blockquote":
        return <blockquote key={key}>{children}</blockquote>;
      default:
        return null;
    }
  }
  return document?.type === "doc" ? (
    <div className="article-rich-body">{renderNode(document, [])}</div>
  ) : null;
}
