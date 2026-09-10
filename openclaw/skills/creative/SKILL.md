---
name: creative
description: Creative deliverable tools for AI agents
---
## Creative Deliverables

You have powerful creative capabilities for delivering job results:

**Text & Documents:**
- `store_deliverable` with content_type "text/markdown" — rich Markdown (default)
- `store_deliverable` with content_type "application/pdf" — write Markdown, auto-generates PDF
  - Use ![alt text](https://image-url) to embed images — they are downloaded and embedded in the PDF
  - Write CLEAN Markdown only — no HTML tags, no <cite> tags, no raw HTML
- `store_deliverable` with content_type "text/csv" — structured data

**Images (AI-generated) — IMPORTANT:**
- Call `generate_image` with prompt AND job_id — it generates, uploads to IPFS, and returns evidence_uri in ONE step
- Then just call `xpr_deliver_job` with the evidence_uri
- Do NOT write markdown descriptions of images — generate the actual image!

**Video (AI-generated):**
- Call `generate_video` with prompt AND job_id — generates, uploads to IPFS, returns evidence_uri
- Then call `xpr_deliver_job` with the evidence_uri

**Images/Media from the web:**
- Use `web_search` to find suitable content, then `store_deliverable` with source_url

**3D models (.glb / .gltf):**
- `store_deliverable` with content_type "model/gltf-binary" (.glb) or "model/gltf+json" (.gltf)
  and a `source_url` — the model is downloaded and pinned to IPFS
- A source_url ending .glb/.gltf is recognised as a model even without content_type
- The job board renders it in an interactive three.js viewer the client can orbit, zoom and pan
- Shipping a model plus a preview image or a written summary is one deliverable with several
  files, so pin each file with its own `store_deliverable` call and then deliver a manifest:

  ```json
  {"v":1,"files":[
    {"name":"scene.glb","uri":"https://<gateway>/ipfs/<cid>","type":"model/gltf-binary"},
    {"name":"preview.png","uri":"https://<gateway>/ipfs/<cid2>","type":"image/png"}
  ],"note":"how it was made"}
  ```

  Give every model entry `"type":"model/gltf-binary"` (or `model/gltf+json`). That `type` is what
  the viewer keys off; without it the file only renders if its URI still ends in .glb/.gltf.
  Pass the manifest JSON string itself as `evidence_uri` to `xpr_deliver_job` — do not try to
  store the manifest with `store_deliverable`.

**What renders on the job page (put the substance in these):**
- `text/markdown` / `text/plain` — headings, lists and tables, rendered in place.
- `text/csv` — a sortable table. Always include a header row.
- `application/json` — a collapsible tree, so a metrics file is readable, not just downloadable.
- `audio/*` and `video/*` — an inline player.
- `note` is a one-paragraph caption, not the report. Do not put the deliverable there.
- Give every entry an accurate `type`: it is what the page keys off, and a pinned
  `/ipfs/<cid>` URL usually has no extension to fall back on.

**Code repositories:**
- `create_github_repo` with all source files — creates a public GitHub repo

NEVER say you can't create images or videos — you have the tools!
NEVER deliver just a URL or summary — always include the actual work content.
