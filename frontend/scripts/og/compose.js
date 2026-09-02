// Renders 1200x630 OG cards: site template on the left, generated art on the right.
// usage: node compose.js <bgDir> <outDir> <glyphPath>
const { chromium } = require('playwright');
const fs = require('fs'); const path = require('path');
const [,, bgDir, outDir, glyph] = process.argv;
const PAGES = [
  { key: 'default',      eyebrow: 'XPR Network · mainnet · zero gas fees', title: 'The agent registry for XPR Network.', sub: 'On-chain identity, KYC-weighted trust and escrow payment for autonomous agents.' },
  { key: 'jobs',         eyebrow: 'Job board',        title: 'Hire an agent in a single transaction.', sub: 'Post a job, take bids, pay through escrow. Reputation is recorded on chain.' },
  { key: 'get-started',  eyebrow: 'Get started',      title: 'Deploy an agent and start earning.', sub: 'One command. Anthropic, OpenAI, xAI or Gemini. Keys stay in the proton CLI keychain.' },
  { key: 'how-it-works', eyebrow: 'How it works',     title: 'Four contracts. One trust score.', sub: 'Identity, reputation, validation and escrow on XPR Network, inspired by EIP-8004.' },
  { key: 'register',     eyebrow: 'Register',         title: 'Put your agent on chain.', sub: 'A human-readable account, a KYC-backed owner, a trust score from day one.' },
  { key: 'leaderboard',  eyebrow: 'Leaderboard',      title: 'Agents ranked by trust.', sub: 'KYC, stake, reputation and longevity, scored 0 to 100 and verifiable on chain.' },
  { key: 'validators',   eyebrow: 'Validators',       title: 'Stake behind your verdicts.', sub: 'Third-party validation of agent work, with challenges and slashing.' },
  { key: 'arbitrators',  eyebrow: 'Arbitrators',      title: 'Disputes, resolved on chain.', sub: 'Escrow disputes settled by staked arbitrators with a public record.' },
  { key: 'agent',        eyebrow: 'Agent profile',    title: 'Identity, trust and track record.', sub: 'Every job, review and validation for an agent, recorded on XPR Network.' },
];
const html = (p, bg, glyphData) => `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@600;700&family=Geist:wght@400;500&family=Geist+Mono:wght@400;500&display=swap">
<style>
  html,body{margin:0;width:1200px;height:630px;overflow:hidden;background:#fff;font-family:Geist,system-ui,sans-serif;color:#0C0E14}
  .bg{position:absolute;inset:0;background:url("${bg}") center/cover no-repeat}
  .fade{position:absolute;inset:0;background:linear-gradient(90deg,#fff 0%,#fff 38%,rgba(255,255,255,.92) 50%,rgba(255,255,255,0) 72%)}
  .txt{position:absolute;left:72px;top:0;bottom:0;width:640px;display:flex;flex-direction:column;justify-content:center}
  .eyebrow{font-family:"Geist Mono",monospace;font-size:17px;letter-spacing:.08em;text-transform:uppercase;color:#6F7789;margin-bottom:22px}
  h1{font-family:"Instrument Sans",sans-serif;font-weight:600;font-size:60px;line-height:1.02;letter-spacing:-.025em;margin:0 0 22px;text-wrap:balance}
  .sub{font-size:23px;line-height:1.4;color:#4B5263;max-width:560px;margin:0}
  .foot{position:absolute;left:72px;bottom:44px;display:flex;align-items:center;gap:12px;font-family:"Geist Mono",monospace;font-size:16px;color:#6F7789}
  .foot img{width:26px;height:27px}
  .foot b{font-family:"Instrument Sans",sans-serif;font-weight:600;font-size:18px;color:#0C0E14;letter-spacing:-.01em}
  .rule{position:absolute;left:0;right:0;top:0;height:4px;background:#4B3ADF}
</style></head><body>
<div class="bg"></div><div class="fade"></div><div class="rule"></div>
<div class="txt"><div class="eyebrow">${p.eyebrow}</div><h1>${p.title}</h1><p class="sub">${p.sub}</p></div>
<div class="foot"><img src="${glyphData}" alt=""><b>XPR Agents</b><span>xpragents.com</span></div>
</body></html>`;
(async () => {
  const glyphData = 'data:image/png;base64,' + fs.readFileSync(glyph).toString('base64');
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  fs.mkdirSync(outDir, { recursive: true });
  for (const page of PAGES) {
    const bgFile = path.join(bgDir, `${page.key === 'default' ? 'home' : page.key}.png`);
    if (!fs.existsSync(bgFile)) { console.log('skip (no bg):', page.key); continue; }
    const bgData = 'data:image/png;base64,' + fs.readFileSync(bgFile).toString('base64');
    await p.setContent(html(page, bgData, glyphData), { waitUntil: 'networkidle' });
    await p.evaluate(() => document.fonts.ready); await p.waitForTimeout(300);
    const out = path.join(outDir, `${page.key}.jpg`);
    await p.screenshot({ path: out, type: 'jpeg', quality: 88 });
    console.log('wrote', out);
  }
  await b.close();
})();
