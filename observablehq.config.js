// The public site for people using Stillwell's data; contributor docs stay in docs/.
const sources = await fetch("https://stillwell.openwaters.io/sources.json").then((r) => r.json());

export default {
  title: "Stillwell",
  root: "site",
  search: true,
  pages: [
    { name: "Query the store", path: "/query" },
    {
      name: "Sources",
      collapsible: true,
      open: false,
      pages: sources
        .map((s) => ({ name: s.name, path: `/source?id=${s.id}` }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    },
    {
      name: "Examples",
      pages: [{ name: "Rebuilding GESLA and TICON", path: "/examples/gesla-ticon" }],
    },
  ],
  footer:
    'Data from <a href="https://github.com/openwatersio/stillwell">Stillwell</a>, read live from the store. Each station credits its source.',
};
