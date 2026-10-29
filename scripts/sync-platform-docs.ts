// Copies docs/integrations/*.md to content/docs/platforms/<platform>.mdx.
// Adds frontmatter, an approvals table from docs/VERIFICATIONS.md, and escapes MDX characters.
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";

const SRC = "docs/integrations";
const OUT = "content/docs/platforms";
// Platform file name -> label that starts the row in the VERIFICATIONS status board.
const ROW: Record<string, string> = {
  bluesky: "Bluesky",
  facebook: "Facebook Pages",
  instagram: "Instagram",
  linkedin: "LinkedIn",
  pinterest: "Pinterest",
  threads: "Threads",
  tiktok: "TikTok",
  x: "X (Twitter)",
  youtube: "YouTube",
};

// Escape MDX-significant characters outside inline code and fenced code.
function escapeMdx(md: string): string {
  let fenced = false;
  return md
    .split("\n")
    .map((line) => {
      if (/^\s*```/.test(line)) {
        fenced = !fenced;
        return line;
      }
      if (fenced) return line;
      return line
        .split(/(`[^`]*`)/)
        .map((part, i) =>
          i % 2 === 1
            ? part
            : part
                .replaceAll("<", "&lt;")
                .replaceAll("{", "\\{")
                .replaceAll("}", "\\}"),
        )
        .join("");
    })
    .join("\n");
}

const cells = (line: string) =>
  line
    .split("|")
    .slice(1, -1)
    .map((c) => c.trim());

function approvalsTable(board: string, platform: string): string {
  const label = ROW[platform];
  const row = board
    .split("\n")
    .filter((l) => l.startsWith("|"))
    .map(cells)
    .find((c) => label !== undefined && c[0]?.startsWith(label));
  if (!row) return "Approval: not tracked yet\n";
  const [, need, status, works, blocked, timeline] = row;
  return [
    "| Approval needed | Status | Works before approval | Blocked before approval | Timeline |",
    "|---|---|---|---|---|",
    `| ${[need, status, works, blocked, timeline].join(" | ")} |`,
    "",
  ].join("\n");
}

function main() {
  const board = readFileSync("docs/VERIFICATIONS.md", "utf8");
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  writeFileSync(
    `${OUT}/meta.json`,
    `${JSON.stringify({ title: "Platforms", pages: ["mock", "..."] }, null, 2)}\n`,
  );
  for (const file of readdirSync(SRC).filter((f) => f.endsWith(".md"))) {
    const platform = file.slice(0, -3);
    const lines = readFileSync(`${SRC}/${file}`, "utf8").split("\n");
    const h1 = lines.findIndex((l) => l.startsWith("# "));
    const title = h1 >= 0 ? lines[h1].slice(2).trim() : platform;
    const body = lines.filter((_, i) => i !== h1).join("\n");
    const mdx = [
      "---",
      `title: ${JSON.stringify(title)}`,
      "---",
      "",
      approvalsTable(board, platform),
      escapeMdx(body).trimStart(),
    ].join("\n");
    writeFileSync(`${OUT}/${platform}.mdx`, mdx);
  }
}

main();
