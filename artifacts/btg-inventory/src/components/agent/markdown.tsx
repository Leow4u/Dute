import { Fragment } from "react";

import { parseMarkdown, type Inline } from "@/lib/agent-chat";
import { cn } from "@/lib/utils";

function InlineText({ content }: { content: Inline[] }) {
  return (
    <>
      {content.map((part, index) => {
        if (part.kind === "bold") return <strong key={index} className="font-semibold">{part.text}</strong>;
        if (part.kind === "italic") return <em key={index}>{part.text}</em>;
        if (part.kind === "code") {
          return (
            <code key={index} className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-[0.85em]">
              {part.text}
            </code>
          );
        }
        return <Fragment key={index}>{part.text}</Fragment>;
      })}
    </>
  );
}

/** Respostas do Agent Dute: parágrafos, listas, tabelas e negrito. */
export function AgentMarkdown({ content, className }: { content: string; className?: string }) {
  const blocks = parseMarkdown(content);
  return (
    <div className={cn("space-y-3 text-base leading-7", className)}>
      {blocks.map((block, index) => {
        if (block.kind === "heading") {
          return (
            <p key={index} className="pt-1 font-semibold">
              <InlineText content={block.content} />
            </p>
          );
        }
        if (block.kind === "rule") return <hr key={index} className="border-border" />;
        if (block.kind === "list") {
          const List = block.ordered ? "ol" : "ul";
          return (
            <List key={index} className={cn("space-y-1 pl-5", block.ordered ? "list-decimal" : "list-disc marker:text-primary/60")}>
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex} className="pl-1">
                  <InlineText content={item} />
                </li>
              ))}
            </List>
          );
        }
        if (block.kind === "table") {
          return (
            <div key={index} className="overflow-x-auto rounded-xl border border-border">
              <table className="w-full border-collapse text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    {block.header.map((cell, cellIndex) => (
                      <th
                        key={cellIndex}
                        className={cn(
                          "whitespace-nowrap border-b border-border px-3 py-2 text-xs font-semibold text-muted-foreground",
                          block.align[cellIndex] === "right" ? "text-right" : "text-left",
                        )}
                      >
                        <InlineText content={cell} />
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {block.rows.map((row, rowIndex) => (
                    <tr key={rowIndex} className="border-b border-border/60 last:border-0">
                      {row.map((cell, cellIndex) => (
                        <td
                          key={cellIndex}
                          className={cn(
                            "px-3 py-2",
                            block.align[cellIndex] === "right" ? "text-right tabular-nums" : "text-left",
                          )}
                        >
                          <InlineText content={cell} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }
        return (
          <p key={index}>
            <InlineText content={block.content} />
          </p>
        );
      })}
    </div>
  );
}
