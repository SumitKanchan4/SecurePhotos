/**
 * Release notes in the update window (owner, 2026-11-24): the changelog's Markdown shown as
 * headings, bullet lists and bold text. Only those three; everything else is plain text. The
 * notes come over the internet, so they are never inserted as HTML: each piece becomes a React
 * text node. Links show as their text only (the window opens nothing).
 */
import React from "react";

export type NotesBlock = { kind: "heading"; text: string } | { kind: "list"; items: string[] } | { kind: "text"; text: string };

/** "[text](https://…)" → "text"; inline code ticks dropped. */
function plainInline(text: string): string {
  return text.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/`([^`]+)`/g, "$1").trim();
}

/** The notes as headings, lists and paragraphs. */
export function parseNotes(markdown: string): NotesBlock[] {
  const blocks: NotesBlock[] = [];
  let list: string[] | null = null;
  let para: string[] = [];
  const flushPara = () => {
    if (para.length) blocks.push({ kind: "text", text: plainInline(para.join(" ")) });
    para = [];
  };
  const flushList = () => {
    if (list?.length) blocks.push({ kind: "list", items: list });
    list = null;
  };
  for (const raw of markdown.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trim();
    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    const bullet = /^[-*]\s+(.*)$/.exec(line);
    if (!line) {
      flushPara();
      flushList();
    } else if (heading) {
      flushPara();
      flushList();
      blocks.push({ kind: "heading", text: plainInline(heading[1]) });
    } else if (bullet) {
      flushPara();
      (list ??= []).push(plainInline(bullet[1]));
    } else if (list && raw.startsWith("  ")) {
      list[list.length - 1] += ` ${plainInline(line)}`; // A wrapped bullet goes on.
    } else {
      flushList();
      para.push(line);
    }
  }
  flushPara();
  flushList();
  return blocks;
}

/** "**bold**" as <strong>, everything else as text. */
export function inlineBold(text: string): React.ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).filter(Boolean).map((part, i) =>
    part.startsWith("**") && part.endsWith("**") && part.length > 4 ? <strong key={i}>{part.slice(2, -2)}</strong> : <React.Fragment key={i}>{part}</React.Fragment>,
  );
}

export const ReleaseNotes: React.FC<{ markdown: string }> = ({ markdown }) => (
  <div className="update-notes">
    {parseNotes(markdown).map((block, i) =>
      block.kind === "heading" ? (
        <h4 key={i}>{inlineBold(block.text)}</h4>
      ) : block.kind === "list" ? (
        <ul key={i}>
          {block.items.map((item, j) => (
            <li key={j}>{inlineBold(item)}</li>
          ))}
        </ul>
      ) : (
        <p key={i}>{inlineBold(block.text)}</p>
      ),
    )}
  </div>
);
