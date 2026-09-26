# SEO

To evolve at every route added, not only at creation.

- **One single address per page, in English, under `/fr` as under `/en`.** The locale prefix carries the language, the path carries the page: `/fr/pricing`, `/en/pricing`. The former French paths (`/tarifs`, `/compte`, `/jouer`...) were indexed and shared: `next.config.ts` permanently redirects them, bare and under `/fr`, and this table does not get removed. The keys of `routing.pathnames` are now also the served paths, and the folders under `app/[locale]` carry the same names.
- `SITE_URL` conditions canonical, hreflang, OpenGraph, sitemap and robots. Without a `NEXT_PUBLIC_` prefix: it is only read server-side. Undefined, everything falls back to localhost.
- `src/lib/seo.ts` centralizes the origin, the OpenGraph locales, `urlFor()` and `alternatesFor()` (canonical, hreflang, x-default). `src/lib/page-metadata.ts` derives a content page's metadata from it.
- Every new public route gets added to `PATHS` in `src/app/sitemap.ts`.
- `x-default` points to the bare address of the page, which the proxy makes negotiate, to match the `Link` header it emits. The sitemap announces the same hreflang as the page, `x-default` included: it takes them from `alternatesFor` instead of recomposing them.
- JSON-LD in `src/components/seo/json-ld.tsx`: the site graph in the layout, the breadcrumb carried by `ProsePage` through its `href` prop. Only declare verifiable things there: neither aggregate rating, nor offer, nor invented release date.
