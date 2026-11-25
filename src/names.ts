/** Comparing gauge names across sources, for matching a station to its other series. */

/** Words too common in gauge names to identify one, though they still separate two. */
const COMMON = new Set([
  "noord",
  "zuid",
  "oost",
  "west",
  "north",
  "south",
  "east",
  "haven",
  "hafen",
  "harbour",
  "harbor",
  "port",
  "platform",
  "buiten",
  "binnen",
  "sluis",
  "schleuse",
  "pegel",
]);

/** Short words that name no place, so a whole name of them identifies none. */
const MINOR = new Set(
  "the les des del der den das die los las san van ter syd sud sor ost est nor kai bro dam dok bay key fyr old new".split(
    " ",
  ),
);

function fold(name: string, ring = false): string {
  return (
    name
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      // Letters NFKD leaves whole, as in Måløy.
      .replace(/ø/g, "o")
      .replace(/æ/g, "ae")
      .replace(/ß/g, "ss")
      // With `ring`, "aa" is Å written without it, as in CMEMS's "Honningsvaag".
      .replace(/aa/g, ring ? "a" : "aa")
      .replace(/([aou])e/g, "$1")
  );
}

/**
 * Words two names share: as words, or inside a run-together name such as
 * CMEMS's "KielHoltenauTG". `identifying` counts those of four letters or more,
 * or short codes with a digit such as "A12", that aren't in `COMMON`. A name
 * whose every word is a word of the other, with no number among them and one
 * place name of three letters or more, also identifies, as "Hov" does in
 * "Hov Havn I" and "PORT_DU_JAI" in "PORT DU JAI", and `total` counts its
 * words. Each pair is read with "aa" as Å and as written, since Dutch writes
 * "Waal", and the better reading counts.
 */
export function nameScore(a: string, b: string): { identifying: number; total: number } {
  const [plain, ring] = [score(a, b, false), score(a, b, true)];
  return ring.identifying > plain.identifying ||
    (ring.identifying === plain.identifying && ring.total > plain.total)
    ? ring
    : plain;
}

function score(a: string, b: string, ring: boolean): { identifying: number; total: number } {
  const words = (s: string) =>
    fold(s, ring)
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length >= 4 || (w.length >= 2 && /\d/.test(w)));
  const compact = (s: string) => fold(s, ring).replace(/[^a-z0-9]/g, "");
  const ca = compact(a);
  const cb = compact(b);
  const shared = new Set([
    ...words(b).filter((w) => ca.includes(w)),
    ...words(a).filter((w) => cb.includes(w)),
    ...[...COMMON].filter((w) => ca.includes(w) && cb.includes(w)),
  ]);
  // CMEMS ends a run-together name with "TG", tide gauge, as in "NesTG".
  const all = (s: string) =>
    fold(s, ring)
      .replace(/(?<=[a-z])tg$/, "")
      .split(/[^a-z0-9]+/)
      .filter((w) => w && w !== "tg");
  const [wa, wb] = [all(a), all(b)];
  const within = (x: string[], y: string[]) =>
    // A number names a structure's gauge, as in "Dam 2", not a place.
    x.every((w) => /^[a-z]+$/.test(w) && y.includes(w)) &&
    x.some((w) => w.length >= 3 && !COMMON.has(w) && !MINOR.has(w));
  const whole = Math.max(within(wa, wb) ? wa.length : 0, within(wb, wa) ? wb.length : 0);
  return {
    identifying: Math.max([...shared].filter((w) => !COMMON.has(w)).length, Math.min(whole, 1)),
    total: Math.max(shared.size, whole),
  };
}

/** Whether the names share an identifying word. */
export function sharesWord(a: string, b: string): boolean {
  return nameScore(a, b).identifying > 0;
}
