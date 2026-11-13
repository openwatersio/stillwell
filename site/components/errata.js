import { html } from "npm:htl";
import { md } from "./md.js";
import { gaugeLink } from "./store.js";

/** One erratum from errata.json, folded to its id and what the store does. */
export function erratum(e) {
  const n = e.stations?.length ?? 0;
  const where = n ? `${n} ${n === 1 ? "station" : "stations"}` : "source-wide";
  const when =
    e.since || e.until
      ? `, ${e.since?.slice(0, 10) ?? "…"} to ${e.until?.slice(0, 10) ?? "…"}`
      : "";
  return html`<details>
    <summary><strong>${e.id}</strong>: ${e.handling}, ${where}${when}</summary>
    ${md(e.error)}
    <p><strong>What the store does:</strong></p>
    ${md(e.response)}
    ${n ? html`<p>${e.stations.slice(0, 20).map((id, i) => html`${i ? ", " : ""}<a href=${gaugeLink(id)}>${id}</a>`)}${n > 20 ? `, and ${n - 20} more` : ""}</p>` : ""}
    ${e.url ? html`<p><a href=${e.url}>Evidence</a></p>` : ""}
  </details>`;
}
