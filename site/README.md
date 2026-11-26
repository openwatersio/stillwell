# Site

`site/` is the site for people using the data, an [Astro](https://astro.build) project with its own `package.json`. Its docs are Markdown in `site/src/content/docs/docs/`. The queries shown with their results run against the public store when the site builds, and the schema tables come from the store's `datapackage.json`, so a build fails where one of those queries breaks or a live file's columns differ from its definition. The code on the Tools and Notebooks pages doesn't run. Each source gets a page, in `site/src/pages/`. Station pages build only for the sources `STATIONS` names, or for every source with `STATIONS=all`, since all of them come to about 1.3 GB, more than GitHub Pages serves.

```bash
cd site && npm ci
npm run dev                    # preview with live reload
STATIONS=rws npm run dev       # with these sources' station pages
npm run build                  # as the Site workflow deploys it, without station pages
STATIONS=bsh,marine-institute npm run build   # as it builds a pull request
```

The Site workflow builds it on pull requests that touch `site/`, a source's README, which its source page shows, or a report's script, with two sources' station pages. Pushes to `main` build and deploy it, without station pages, to GitHub Pages at <https://openwatersio.github.io/stillwell/>, and so does a daily run, which is when a change to the store's files reaches it, since the build reads the published store. Only `main` deploys, and the repository's Pages source is GitHub Actions. Pages serves it under `/stillwell`, the `base` in [`site/astro.config.mjs`](astro.config.mjs): links in the docs' Markdown get it at build time, and links in code go through `sitePath()` in [`site/src/lib/paths.ts`](src/lib/paths.ts). The workflow fails a build where a root path in the built HTML lacks it or has it twice; paths built in scripts aren't checked.

The pages under `/reports/` are for planning which sources and stations to add, and the docs don't link them. Each shows a report the repository's scripts write to `reports/` at the repository's root: `npm run ticon:inventory` the TICON inventory, from a slackwater-database checkout, and `npm run gesla:coverage` the GESLA coverage, from the store. The Site workflow runs both before every build, so the pages follow the store day by day. A report that fails, or a step it needs, fails the build and nothing deploys until one passes, so the deployed site keeps the last good reports. Run the scripts from the repository's root before `npm run build` to see the pages locally.
