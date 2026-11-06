/**
 * The shape of an upstream response, for the weekly canary: every path in a
 * JSON body with the types seen there, or for a text file, the record code
 * that starts each `#`-separated line (BSH's files). Values don't matter, so a
 * live answer can be checked against one recorded months before.
 */
export type Shape = Record<string, string>;

export function shapeOf(text: string): Shape {
  const shape: Record<string, Set<string>> = {};
  const add = (path: string, type: string) => (shape[path] ??= new Set()).add(type);
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    for (const line of text.split(/\r?\n/))
      if (line.includes("#")) add(line.split("#")[0]!, "line");
    return sorted(shape);
  }
  const walk = (value: unknown, path: string) => {
    if (Array.isArray(value)) {
      add(path, "array");
      for (const item of value) walk(item, `${path}[]`);
    } else if (value !== null && typeof value === "object") {
      add(path, "object");
      for (const [key, item] of Object.entries(value)) walk(item, `${path}.${key}`);
    } else add(path, value === null ? "null" : typeof value);
  };
  walk(json, "$");
  return sorted(shape);
}

/** Shapes of several answers as one, such as the pages of a series. */
export function merge(...shapes: Shape[]): Shape {
  const out: Record<string, Set<string>> = {};
  for (const shape of shapes)
    for (const [path, types] of Object.entries(shape))
      for (const type of types.split(" | ")) (out[path] ??= new Set()).add(type);
  return sorted(out);
}

/**
 * How `live` departs from `recorded`: a path that's gone, or a type the
 * recording never saw there. Paths only `live` has are left out, since an API
 * adding a field breaks nothing, and so is a null where the recording had a
 * value or an object, since a value can be missing any week, and a path the
 * recording saw only null at.
 */
export function drift(recorded: Shape, live: Shape): string[] {
  const out: string[] = [];
  for (const [path, types] of Object.entries(recorded)) {
    const now = live[path];
    if (!now) {
      if (!nulled(path, live)) out.push(`${path} is missing (was ${types})`);
    } else if (
      types !== "null" &&
      now.split(" | ").some((t) => t !== "null" && !types.split(" | ").includes(t))
    )
      out.push(`${path} is ${now} (was ${types})`);
  }
  return out;
}

/** Whether one of the objects or lists holding `path` is null in `live`. */
function nulled(path: string, live: Shape): boolean {
  // A text file's line codes have no holders, and stop at once.
  for (let p = path; p.startsWith("$") && p !== "$";) {
    p = p.endsWith("[]") ? p.slice(0, -2) : p.slice(0, p.lastIndexOf("."));
    if (live[p]?.split(" | ").includes("null")) return true;
  }
  return false;
}

/** Paths in order, each with its types in order, so a recording diffs cleanly. */
function sorted(shape: Record<string, Set<string>>): Shape {
  return Object.fromEntries(
    Object.keys(shape)
      .sort()
      .map((path) => [path, [...shape[path]!].sort().join(" | ")]),
  );
}
