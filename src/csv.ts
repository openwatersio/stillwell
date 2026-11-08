/** A CSV line's fields, with quoted fields unquoted and empty fields kept. */
export function csvFields(line: string): string[] {
  const fields = [""];
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (quoted && c === '"' && line[i + 1] === '"') {
      fields[fields.length - 1] += '"';
      i++;
    } else if (c === '"') quoted = !quoted;
    else if (c === "," && !quoted) fields.push("");
    else fields[fields.length - 1] += c;
  }
  return fields;
}
