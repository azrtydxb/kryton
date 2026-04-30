// packages/core/scripts/lib/prisma-walker.ts
export interface PrismaModel {
  name: string;
  annotationBlock: string;
  fields: string[];
}

export function walkPrismaSchema(source: string): PrismaModel[] {
  const lines = source.split("\n");
  const models: PrismaModel[] = [];

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    // Buffer triple-slash comments preceding a model
    if (line.trim().startsWith("///")) {
      const annLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith("///")) {
        annLines.push(lines[i].trim());
        i++;
      }
      const next = lines[i]?.trim() ?? "";
      const m = next.match(/^model\s+(\w+)\s*\{/);
      if (m) {
        models.push(consumeModel(m[1], annLines.join("\n"), lines, i));
        // advance past the consumed model
        while (i < lines.length && !lines[i].trim().startsWith("}")) i++;
      }
      i++;
      continue;
    }
    const m = line.trim().match(/^model\s+(\w+)\s*\{/);
    if (m) {
      models.push(consumeModel(m[1], "", lines, i));
      while (i < lines.length && !lines[i].trim().startsWith("}")) i++;
    }
    i++;
  }

  return models;
}

function consumeModel(name: string, annotationBlock: string, lines: string[], startIndex: number): PrismaModel {
  const fields: string[] = [];
  let i = startIndex + 1;
  while (i < lines.length && !lines[i].trim().startsWith("}")) {
    const trimmed = lines[i].trim();
    if (trimmed && !trimmed.startsWith("//") && !trimmed.startsWith("@@")) {
      fields.push(lines[i]);
    }
    i++;
  }
  return { name, annotationBlock, fields };
}
