---
name: blockart
description: Block Art fulfilment — the XPR atom emblem, every trait derived from the block the buyer paid in
---

## Block Art

Block Art is a fixed-price listing on the services market. A buyer pays, and gets
a 2048px render of the XPR Network atom emblem whose every visual trait is
derived from **the block their payment confirmed in**. Nothing about the piece is
chosen by you: the block chooses it, and `traits.json` ships alongside the image
so the buyer can check the derivation themselves.

A Block Art job arrives as a funded escrow job with `job_hash` `"svc:4"`.

### The two tools

- `blockart_plan` — `{ job_id }`. Reads the job, recovers the seed block, derives
  the traits, reads the buyer's form answers and any revision notes, builds the
  prompt, and persists the plan. Read-only, no spend, no signing.
- `blockart_render` — `{ job_id }`. Renders the planned piece, pins the image and
  `traits.json` to IPFS under one CID, and returns a delivery manifest. It never
  signs and never delivers.

### The flow

1. `blockart_plan` with the job id. **Read the `summary`.** It tells you the seed
   block, the eight traits, and what the buyer asked for.
2. If the buyer's notes ask for something the listing does not offer — a
   different subject, a different format, print or physical delivery, a logo or
   any text in the image, a trait they want overridden — ask them **ONE** question
   with `xpr_ask_client` and stop. Do not guess, and do not ask a second question
   later.
3. Otherwise `blockart_render` with the same job id.
4. `xpr_deliver_job` with `evidence_uri` set to the manifest string the render
   returned, **exactly as returned**. Do not rewrite it, do not wrap it, do not
   substitute a bare gateway link.

### What the block fixes, and what it does not

The block fixes the material of the three orbits, the setting, the light, the
palette, the motion, the scale, the time of day, and (from the buyer's account
age) the patina. It says nothing about what else may share the scene, so a
buyer's theme is honoured **in the surroundings** — the environment, the sky, the
forms and shadows around the atom — while the atom itself stays the single clear
subject, unchanged in geometry. A buyer never gets to override a trait; if they
ask to, that is a question for them, not a decision for you.

### Revisions

If the client sends the job back with `revise`:

- Re-run `blockart_plan`. It **reuses the same seed block** — the traits cannot
  change, or the piece stops matching the block the buyer was told it came from.
- The plan folds their revise note into the prompt's steer automatically. Read
  the summary again to see it.
- Re-render, then deliver. **Never deliver identical evidence**: if the render
  came back the same, say so and ask rather than re-sending the previous CID.
- If their note asks for a trait to change, that is not a re-render — ask with
  `xpr_ask_client`.

### Environment

| Variable | Required for | Default |
|----------|--------------|---------|
| `REPLICATE_API_TOKEN` | `blockart_render` | — |
| `PINATA_JWT` | `blockart_render` | — |
| `PINATA_GATEWAY` | pinned URLs | `https://agent.mypinata.cloud` |
| `HYPERION_URL` | seed block + revise notes | a public XPR node |
| `XPR_RPC_ENDPOINT` | all chain reads | shared with the other skills |
| `BLOCKART_WORK_DIR` | plan + render storage | `./blockart-work` |

Both tools return `{ error: "..." }` rather than throwing. If the error names a
missing environment variable, say so plainly and stop — do not deliver a
description of the artwork in place of the artwork.
