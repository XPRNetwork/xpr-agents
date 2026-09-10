/**
 * IPFS helpers shared by the deliverable viewer, the 3D model viewer and NFT cards.
 *
 * Deliverables are pinned by agents (Pinata) and referenced on-chain as gateway URLs,
 * `ipfs://` URIs or bare CIDs. Any single gateway can be slow or rate-limited, so anything
 * fetching a pinned file walks `ipfsCandidates()` until one responds.
 *
 * This is the one gateway list and the one CID parser: `IpfsImage` re-exports from here
 * rather than keeping its own copy.
 */

/** Tried in order after the URL as given. Ordered by observed reliability for our pins. */
const FALLBACK_GATEWAYS = [
  'https://gateway.pinata.cloud/ipfs/',
  'https://dweb.link/ipfs/',
  'https://cloudflare-ipfs.com/ipfs/',
  'https://ipfs.io/ipfs/',
];

const CID_PATTERN = '(Qm[1-9A-HJ-NP-Za-km-z]{44}|b[A-Za-z2-7]{58,})';
const BARE_CID_RE = new RegExp(`^${CID_PATTERN}(/[^?#]*)?$`);

/**
 * Returns the CID plus any sub-path for an IPFS URL, or null for non-IPFS URLs.
 * Accepts `ipfs://CID/path`, any `/ipfs/CID/path` gateway URL, and a bare CID.
 */
export function ipfsPath(url: string): string | null {
  if (!url) return null;
  const m =
    url.match(/^ipfs:\/\/(.+)$/i) ||
    url.match(/\/ipfs\/([A-Za-z0-9]+(?:\/[^?#]*)?)/) ||
    url.match(BARE_CID_RE);
  if (!m) return null;
  // The bare-CID branch splits CID and path across two groups; the others capture both in one.
  return m[2] !== undefined ? `${m[1]}${m[2]}` : m[1];
}

/** All candidate URLs for a pinned file, original first, de-duplicated. */
export function ipfsCandidates(url: string): string[] {
  const p = ipfsPath(url);
  const isHttp = /^https?:\/\//i.test(url);
  // `ipfs://` and bare CIDs have no fetchable form of their own — start at a gateway.
  const original = isHttp || url.startsWith('data:') ? url : p ? `${FALLBACK_GATEWAYS[0]}${p}` : url;
  if (!p) return [original];
  const out = [original, ...FALLBACK_GATEWAYS.map(g => g + p)];
  return out.filter((u, i) => out.indexOf(u) === i);
}

/** Turn `ipfs://CID/path` or a bare CID into an HTTP gateway URL. Other URLs pass through. */
export function resolveIpfsUrl(url: string): string {
  return ipfsCandidates(url)[0] || url;
}

// ── File-type detection ──────────────────────────
//
// A pinned file's gateway URL is often just `/ipfs/<CID>` with no extension, and gateways
// serve those as `application/octet-stream`. Detection therefore looks at, in order: an
// explicit manifest `type`, the URL path, a `?filename=` hint if some pinner supplied one,
// and finally the file's own magic bytes.

const MODEL_EXT_RE = /\.(glb|gltf)(?:$|[?#])/i;
const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|avif|svg)(?:$|[?#])/i;

export const MODEL_CONTENT_TYPES = ['model/gltf-binary', 'model/gltf+json'];

const GENERIC_BINARY_TYPES = ['', 'application/octet-stream', 'binary/octet-stream', 'application/binary'];

/** Some gateways accept a `?filename=` hint that drives content-disposition. Read it if present. */
function filenameHint(url: string): string {
  const query = url.split('?')[1];
  if (!query) return '';
  const match = query.match(/(?:^|&)filename=([^&#]+)/);
  if (!match) return '';
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

export function isModelUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  return MODEL_EXT_RE.test(url.split('?')[0]) || MODEL_EXT_RE.test(filenameHint(url));
}

export function isImageUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  return IMAGE_EXT_RE.test(url.split('?')[0]) || IMAGE_EXT_RE.test(filenameHint(url));
}

export function isModelContentType(contentType: string | null | undefined): boolean {
  if (!contentType) return false;
  return MODEL_CONTENT_TYPES.includes(contentType.split(';')[0].trim().toLowerCase());
}

export function isGenericBinaryContentType(contentType: string | null | undefined): boolean {
  return GENERIC_BINARY_TYPES.includes((contentType || '').split(';')[0].trim().toLowerCase());
}

/**
 * Peek at the first bytes of a URL to see whether it is a binary glTF, for files pinned
 * without a usable extension or content type. Reads one chunk and cancels, so a gateway
 * that ignores the Range header does not cost us the whole model.
 */
export async function looksLikeGlb(url: string): Promise<boolean> {
  try {
    const resp = await fetch(url, { headers: { Range: 'bytes=0-11' }, signal: AbortSignal.timeout(8000) });
    if (!resp.ok || !resp.body) return false;
    const reader = resp.body.getReader();
    const { value } = await reader.read();
    reader.cancel().catch(() => {});
    if (!value || value.length < 4) return false;
    return String.fromCharCode(value[0], value[1], value[2], value[3]) === 'glTF';
  } catch {
    return false;
  }
}

/** Does this parsed JSON body look like a glTF document rather than a deliverable wrapper? */
export function isGltfJson(data: unknown): boolean {
  if (!data || typeof data !== 'object') return false;
  const doc = data as Record<string, unknown>;
  const asset = doc.asset as Record<string, unknown> | undefined;
  return Boolean(asset && typeof asset === 'object' && asset.version && (doc.meshes || doc.scenes || doc.nodes));
}

/** Display label for a file: the `?filename=` hint if present, else the last path segment. */
export function filenameFromUrl(url: string): string {
  if (!url) return '';
  const hint = filenameHint(url);
  if (hint) return hint;
  const clean = url.split('?')[0].split('#')[0].replace(/\/$/, '');
  const segment = clean.split('/').pop() || '';
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

export interface ModelFile {
  url: string;
  name: string;
}

export function toModelFile(url: string, name?: string): ModelFile {
  return { url: resolveIpfsUrl(url), name: name || filenameFromUrl(url) || '3D model' };
}

/** De-duplicated model files from a list of candidate URLs. */
export function collectModelFiles(urls: (string | null | undefined)[]): ModelFile[] {
  const files: ModelFile[] = [];
  for (const url of urls) {
    if (!url || !isModelUrl(url)) continue;
    const file = toModelFile(url);
    if (!files.some(f => f.url === file.url)) files.push(file);
  }
  return files;
}

/**
 * Model entries in a delivery manifest. The manifest's per-file `type` is authoritative —
 * it is the whole reason the format exists — with the URI extension as the fallback for
 * agents that omitted it.
 */
export function modelFilesFromManifest(
  files: { name?: string; uri: string; type?: string }[] | null | undefined
): ModelFile[] {
  if (!files) return [];
  const out: ModelFile[] = [];
  for (const f of files) {
    if (!f?.uri) continue;
    if (!isModelContentType(f.type) && !isModelUrl(f.uri)) continue;
    const file = toModelFile(f.uri, f.name);
    if (!out.some(m => m.url === file.url)) out.push(file);
  }
  return out;
}

/**
 * Text files worth rendering on the page rather than linking.
 *
 * A `.md` report is the substance of most written deliverables, so it belongs in
 * the page. A `.csv` is a dataset — it is deliberately excluded, since dumping a
 * few thousand comma-separated rows into a scroll box helps nobody.
 */
const TEXT_EXT_RE = /\.(md|markdown|txt)(?:$|[?#])/i;

const TEXT_CONTENT_TYPES = ['text/markdown', 'text/x-markdown', 'text/plain'];

export function isReadableTextContentType(contentType: string | null | undefined): boolean {
  if (!contentType) return false;
  return TEXT_CONTENT_TYPES.includes(contentType.split(';')[0].trim().toLowerCase());
}

export function isReadableTextUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  return TEXT_EXT_RE.test(url.split('?')[0]) || TEXT_EXT_RE.test(filenameHint(url));
}

export interface ManifestFile {
  name?: string;
  uri: string;
  type?: string;
}

/**
 * Manifest entries to render inline, in manifest order. Capped because each one is a
 * gateway fetch, and a delivery whose point is twenty separate notes is a file list.
 */
export function readableTextFilesFromManifest(
  files: ManifestFile[] | null | undefined,
  limit = 2
): { uri: string; name: string }[] {
  if (!files) return [];
  const out: { uri: string; name: string }[] = [];
  for (const f of files) {
    if (!f?.uri) continue;
    // An explicit type wins: a manifest may name a file `notes` with no extension. The
    // extension is the fallback for pins typed as a generic blob, which gateways do often.
    const typedText = isReadableTextContentType(f.type);
    const namedText = isReadableTextUrl(f.uri) && (!f.type || isGenericBinaryContentType(f.type));
    if (!typedText && !namedText) continue;
    if (out.some(t => t.uri === f.uri)) continue;
    out.push({ uri: f.uri, name: f.name || filenameFromUrl(f.uri) || 'file' });
    if (out.length >= limit) break;
  }
  return out;
}

const MODEL_FIELD_RE = /(model|glb|gltf|mesh|3d)/i;

/**
 * Scan an NFT's attribute map for a 3D asset. AtomicAssets templates commonly store
 * these under keys like `model`, `glb`, `mesh3d` as a bare CID or a full URL.
 */
export function extractModelFilesFromData(data: Record<string, unknown> | null | undefined): ModelFile[] {
  if (!data) return [];
  const files: ModelFile[] = [];
  for (const [key, value] of Object.entries(data)) {
    if (typeof value !== 'string' || !value) continue;
    if (!isModelUrl(value) && !(MODEL_FIELD_RE.test(key) && BARE_CID_RE.test(value))) continue;
    const url = resolveIpfsUrl(value);
    if (files.some(f => f.url === url)) continue;
    files.push({ url, name: isModelUrl(value) ? filenameFromUrl(value) : key });
  }
  return files;
}
