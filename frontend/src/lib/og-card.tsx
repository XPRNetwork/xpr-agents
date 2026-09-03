/**
 * The dynamic 1200x630 social card, rendered with `next/og` (satori + resvg,
 * already shipped inside Next 16 — no new dependency).
 *
 * Deliberately the same template as the static cards in public/og/ (see
 * scripts/og/compose.js): white ground, indigo hairline at the top, text column
 * on the left, artwork bleeding off the right behind a white fade.
 */
import { ImageResponse } from 'next/og';
import { OG_HEIGHT, OG_WIDTH, type OgItem } from './og-image';

const INK = '#0C0E14';
const INK_2 = '#4B5263';
const MUTED = '#6F7789';
const ACCENT = '#4B3ADF';

type SatoriFont = {
  name: string;
  data: ArrayBuffer;
  weight: 400 | 500 | 600 | 700;
  style: 'normal';
};

/** Brand fonts are a nicety: if Google Fonts is slow we render in the bundled default. */
const FONT_SPECS = [
  { name: 'Instrument Sans', query: 'Instrument+Sans:wght@600', weight: 600 as const },
  { name: 'Geist', query: 'Geist:wght@400', weight: 400 as const },
  { name: 'Geist Mono', query: 'Geist+Mono:wght@400', weight: 400 as const },
];
const FONT_TIMEOUT_MS = 2000;
// Cached for the life of the lambda instance, so only a cold start pays for it.
let fontsPromise: Promise<SatoriFont[]> | null = null;

async function loadOne(spec: (typeof FONT_SPECS)[number], signal: AbortSignal): Promise<SatoriFont> {
  // An ancient UA makes the css2 endpoint hand back TTF instead of woff2,
  // which is the only thing satori can parse.
  const css = await fetch(`https://fonts.googleapis.com/css2?family=${spec.query}`, {
    signal,
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 6.1; WOW64)' },
  }).then((r) => r.text());
  const url = /src:\s*url\((https:\/\/[^)]+\.ttf)\)/.exec(css)?.[1];
  if (!url) throw new Error(`no ttf for ${spec.name}`);
  const data = await fetch(url, { signal }).then((r) => r.arrayBuffer());
  return { name: spec.name, data, weight: spec.weight, style: 'normal' };
}

export async function brandFonts(): Promise<SatoriFont[]> {
  if (process.env.OG_BRAND_FONTS === '0') return [];
  if (!fontsPromise) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FONT_TIMEOUT_MS);
    fontsPromise = Promise.all(FONT_SPECS.map((s) => loadOne(s, controller.signal)))
      .catch(() => [] as SatoriFont[])
      .finally(() => clearTimeout(timer));
  }
  const fonts = await fontsPromise;
  // A failed load must not be cached forever — retry on the next cold-ish call.
  if (fonts.length === 0) fontsPromise = null;
  return fonts;
}

export interface CardInput extends OgItem {
  /** Ready-to-embed data: URI, or null for a text-only card. */
  image: string | null;
}

export async function renderCard(card: CardInput): Promise<ImageResponse> {
  const fonts = await brandFonts();
  const has = (n: string) => fonts.some((f) => f.name === n);
  const display = has('Instrument Sans') ? 'Instrument Sans' : undefined;
  const body = has('Geist') ? 'Geist' : undefined;
  const mono = has('Geist Mono') ? 'Geist Mono' : undefined;

  return new ImageResponse(
    (
      <div
        style={{
          width: OG_WIDTH,
          height: OG_HEIGHT,
          display: 'flex',
          position: 'relative',
          backgroundColor: '#ffffff',
          color: INK,
          fontFamily: body,
        }}
      >
        {card.image ? (
          <img
            src={card.image}
            width={OG_WIDTH}
            height={OG_HEIGHT}
            style={{ position: 'absolute', top: 0, left: 0, width: OG_WIDTH, height: OG_HEIGHT, objectFit: 'cover' }}
          />
        ) : null}

        {card.image ? (
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: OG_WIDTH,
              height: OG_HEIGHT,
              backgroundImage:
                'linear-gradient(90deg, #ffffff 0%, #ffffff 38%, rgba(255,255,255,0.92) 50%, rgba(255,255,255,0) 72%)',
            }}
          />
        ) : null}

        <div style={{ position: 'absolute', top: 0, left: 0, width: OG_WIDTH, height: 4, backgroundColor: ACCENT }} />

        <div
          style={{
            position: 'absolute',
            left: 72,
            top: 0,
            width: 640,
            height: OG_HEIGHT,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
          }}
        >
          <div
            style={{
              fontFamily: mono,
              fontSize: 17,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: MUTED,
              marginBottom: 22,
            }}
          >
            {card.eyebrow}
          </div>
          <div
            style={{
              fontFamily: display,
              fontWeight: 600,
              fontSize: card.title.length > 52 ? 46 : 58,
              lineHeight: 1.06,
              letterSpacing: '-0.025em',
              marginBottom: 22,
            }}
          >
            {card.title}
          </div>
          <div style={{ fontSize: 23, lineHeight: 1.4, color: INK_2, maxWidth: 560 }}>{card.subtitle}</div>
        </div>

        <div
          style={{
            position: 'absolute',
            left: 72,
            bottom: 44,
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            fontFamily: mono,
            fontSize: 16,
            color: MUTED,
          }}
        >
          <div style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: ACCENT }} />
          <span style={{ fontFamily: display, fontWeight: 600, fontSize: 18, color: INK, letterSpacing: '-0.01em' }}>
            XPR Agents
          </span>
          <span>xpragents.com</span>
        </div>
      </div>
    ),
    { width: OG_WIDTH, height: OG_HEIGHT, fonts: fonts.length ? fonts : undefined },
  );
}
