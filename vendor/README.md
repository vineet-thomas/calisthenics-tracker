# Vendored third-party code

Served from this repo instead of a CDN, so a CDN outage or a tampered CDN file can't break sign-in
and sync, or run with access to the session. Do not edit these files.

## supabase-js 2.119.0 — `vendor/supabase-js-2.119.0/`

| | |
|---|---|
| File | `supabase.js` = `dist/umd/supabase.js` from the npm package, unmodified |
| Source | `npm pack @supabase/supabase-js@2.119.0` |
| npm integrity (tarball) | `sha512-MKP49G6bJbPhvsZDegZ/IXS/ITApPgplDCF5+F65KZ5kIArS5Y90WFxwvWYALx2bsxdrSuHvkCiXHYr3dU8+sw==` (matches the registry) |
| File sha384 | `sha384-uteMfOloLDGt042uDz+xHGF3ym63/WQ6rFq7murQRG8Ih7QrXGEGNtWd8688sb4O` |
| Licence | MIT — `LICENSE` copied from the package |

It is the version the old `cdn.jsdelivr.net/npm/@supabase/supabase-js@2` tag resolved to on 13 Nov 2026,
so vendoring changed no behaviour. (The CDN served its own auto-minified copy; this is the npm original.)

**To update:** in a PR of its own — `npm pack @supabase/supabase-js@<version>`, check the tarball's
sha512 against `npm view @supabase/supabase-js@<version> dist.integrity`, copy `dist/umd/supabase.js`
and `LICENSE` into a new `vendor/supabase-js-<version>/` folder, point the `<script>` tag at it, delete
the old folder, update this file, and run `node tests/run.js --realstack` (it uses the real client).

## Still on the CDN

`tesseract.js 5.1.1` (OCR on the Food page) stays on jsdelivr: its worker, WASM core and language data are
fetched at runtime anyway. The tag is pinned to the exact version with Subresource Integrity
(`integrity` + `crossorigin="anonymous"`), so a changed file is refused by the browser.
