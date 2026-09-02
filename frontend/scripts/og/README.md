# Social cards (og:image)

One template, one generated background per page. Cards are 1200×630 JPEG in
`public/og/`, picked by route in `src/pages/_app.tsx` (`ogImageForPath`).

## Regenerate

1. Backgrounds — `google/nano-banana-2` on Replicate via the helper in
   `~/dev/replicate/generate.py` (token from its `.env`). Every prompt uses the
   same prefix so the set stays consistent; only the motif changes:

   ```
   Abstract editorial illustration for a financial-infrastructure website. <MOTIF>,
   drawn in deep indigo-violet (#4B3ADF) and cool grey hairlines on a clean white
   paper ground. Precise, geometric, institutional, generous negative space, soft
   depth, subtle paper grain. Composition weighted to the RIGHT two-thirds; the
   LEFT third is almost empty white. No text, no letters, no numbers, no logos,
   no people.
   ```

   Motifs live in `prompts.json`. Output one 16:9 PNG per key into a `bg/` dir.

2. Cards — `node scripts/og/compose.js <bgDir> public/og public/xpr-glyph-black.png`
   (needs `playwright` resolvable, e.g. `NODE_PATH=<dir with playwright>`).
   Text per page is in `compose.js` (`PAGES`).
