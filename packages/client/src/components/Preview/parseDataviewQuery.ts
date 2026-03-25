export interface DataviewQuery {
  type: 'list' | 'table';
  fromTag?: string;
  whereField?: string;
  whereValue?: string;
  sortField?: string;
  sortDir?: string;
}

export function parseDataviewQuery(query: string): DataviewQuery | null {
  const lines = query.trim().split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length === 0) return null;

  const typeLine = lines[0].toUpperCase();
  const type = typeLine === 'TABLE' ? 'table' : 'list';

  let fromTag: string | undefined;
  let whereField: string | undefined;
  let whereValue: string | undefined;
  let sortField: string | undefined;
  let sortDir: string | undefined;

  for (const line of lines.slice(1)) {
    const fromMatch = line.match(/^FROM\s+#(\S+)/i);
    if (fromMatch) fromTag = fromMatch[1];

    const whereMatch = line.match(/^WHERE\s+(\w+)\s*=\s*"([^"]+)"/i);
    if (whereMatch) {
      whereField = whereMatch[1];
      whereValue = whereMatch[2];
    }

    const sortMatch = line.match(/^SORT\s+(\S+)\s*(ASC|DESC)?/i);
    if (sortMatch) {
      sortField = sortMatch[1];
      sortDir = sortMatch[2]?.toUpperCase() || 'ASC';
    }
  }

  return { type, fromTag, whereField, whereValue, sortField, sortDir };
}
