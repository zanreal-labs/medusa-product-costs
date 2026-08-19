# docs/

The published documentation for `@zanreal/medusa-product-costs`.

These pages are the source of what renders at
<https://zanreal.com/docs/oss/medusa-product-costs>. The marketing site clones
this repository at build time and copies this directory into its own content
tree, so a change merged here is what the site ships on its next deploy. Nothing
is maintained by hand on the other side.

## Layout

| File | Purpose |
| --- | --- |
| `index.en.mdx`, `index.pl.mdx` | Overview: what the plugin is, the rule everything follows, how a host installs it. |
| `costs.en.mdx`, `costs.pl.mdx` | The three tables, why the SKU owns the row, the append-only history, and the variant link. |
| `economics.en.mdx`, `economics.pl.mdx` | The four derived figures, what each needs, and why nothing is rounded twice. |
| `import.en.mdx`, `import.pl.mdx` | The CSV importer: the file it accepts, what it sniffs, and what it refuses to guess. |
| `settings.en.mdx`, `settings.pl.mdx` | Both module options, the persisted singleton, the admin surfaces, and every route. |
| `meta.json`, `meta.pl.json` | Sidebar title, description and page order, per locale. |

This `README.md` is deliberately **not** copied by the sync. It explains the
directory to someone browsing GitHub; it is not a page on the site.

## Conventions

- **Every page exists in both locales**, suffixed `.en.mdx` and `.pl.mdx`.
- **Each locale is written from the code, not translated from the other.** The
  two versions make the same argument and are expected to differ in examples and
  emphasis.
- **Cross-links between pages are relative** and point at the file, for example
  `[Settings](./settings.en.mdx)`. That resolves when browsing this directory on
  GitHub, and the site's sync rewrites it to a site route on the way in. The
  locale is taken from the link target, so `./settings.pl.mdx` lands on the
  Polish page.
- **No em or en dashes.** Use a spaced hyphen for a parenthetical.
