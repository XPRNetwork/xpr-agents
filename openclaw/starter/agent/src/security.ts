/**
 * Security scanning module for XPR Agent Runner
 *
 * Two layers:
 * 1. Inbound prompt injection detection — scans webhook, A2A, poller, and manual input
 * 2. Output scanning — scans tool results before feeding back to Claude
 *
 * This is best-effort defence in depth, not an authorization boundary: a fixed pattern
 * list can always be rephrased around (see #89). What protects funds is the confirmation
 * gate on high-risk writes, the MAX_TRANSFER_AMOUNT cap at the signing layer, A2A
 * readonly tool mode with registered-caller gating, and TRUSTED_ARBITRATORS on accept/bid.
 */

// ── Types ────────────────────────────────────

export interface ScanResult {
  safe: boolean;
  text: string;           // cleaned text (stripped patterns removed)
  flagged: string[];      // matched pattern names
  severity: 'none' | 'low' | 'medium' | 'high';
  action: 'allow' | 'strip' | 'block';
}

export interface SecurityConfig {
  enabled: boolean;
  mode: 'block' | 'warn';
  logBlocked: boolean;
}

interface Pattern {
  name: string;
  regex: RegExp;
  severity: 'low' | 'medium' | 'high';
  action: 'block' | 'strip';
  category: string;
}

// ── Stats ────────────────────────────────────

let stats = { scanned: 0, blocked: 0, stripped: 0 };

export function getSecurityStats(): { scanned: number; blocked: number; stripped: number } {
  return { ...stats };
}

// ── Config ───────────────────────────────────

let cachedConfig: SecurityConfig | null = null;

export function loadSecurityConfig(): SecurityConfig {
  if (cachedConfig) return cachedConfig;
  cachedConfig = {
    enabled: process.env.SECURITY_ENABLED !== 'false',
    mode: (process.env.SECURITY_MODE === 'warn' ? 'warn' : 'block') as 'block' | 'warn',
    logBlocked: true,
  };
  return cachedConfig;
}

// ── Inbound Patterns ─────────────────────────

const INBOUND_PATTERNS: Pattern[] = [
  // System prompt override
  { name: 'ignore_instructions', regex: /ignore\s+(all\s+)?(previous|prior|above|earlier|preceding)\s+(instructions|prompts|rules|guidelines|directives)/i, severity: 'high', action: 'block', category: 'system_override' },
  { name: 'disregard_instructions', regex: /disregard\s+(all\s+)?(previous|prior|above|earlier)\s+(instructions|prompts|rules)/i, severity: 'high', action: 'block', category: 'system_override' },
  { name: 'new_system_prompt', regex: /new\s+system\s+prompt/i, severity: 'high', action: 'block', category: 'system_override' },
  { name: 'override_system', regex: /override\s+(the\s+)?system\s+(prompt|message|instructions)/i, severity: 'high', action: 'block', category: 'system_override' },
  { name: 'forget_instructions', regex: /forget\s+(your|all|previous|prior)\s+(instructions|rules|guidelines|programming|training)/i, severity: 'high', action: 'block', category: 'system_override' },
  { name: 'reset_instructions', regex: /reset\s+(your|all)\s+(instructions|context|rules|behavior)/i, severity: 'high', action: 'block', category: 'system_override' },
  { name: 'you_are_now', regex: /you\s+are\s+now\s+(a|an|the|my)\s+/i, severity: 'high', action: 'block', category: 'system_override' },
  { name: 'from_now_on', regex: /from\s+now\s+on[,\s]+(you|your|ignore|disregard|forget)/i, severity: 'high', action: 'block', category: 'system_override' },
  { name: 'system_colon_prefix', regex: /^system\s*:/im, severity: 'high', action: 'block', category: 'system_override' },
  { name: 'ignore_everything', regex: /(?:ignore|disregard|forget)\s+(?:everything|anything|all)\s+(?:(?:that\s+)?you(?:\s+were|\s+have\s+been|'ve\s+been)\s+(?:told|given|instructed)|(?:above|before|prior|previously|earlier)(?=\s*(?:$|[.,;:!\n]|and\b|then\b|now\b)))/i, severity: 'high', action: 'block', category: 'system_override' },
  { name: 'obey_only_me', regex: /\b(?:obey|follow|listen\s+to|take\s+(?:orders|instructions)\s+from)\s+(?:only\s+(?:me|my\s+(?:instructions|orders|commands))|(?:me|my\s+(?:instructions|orders|commands))\s+only)\b/i, severity: 'high', action: 'block', category: 'system_override' },
  { name: 'new_task_execute', regex: /\bnew\s+(?:task|instructions?|orders?)\s*:[\s\S]{0,300}?\b(?:execute|run|do)\s+(?:it\s+|this\s+|them\s+)?(?:immediately|now|right\s+away|without\s+(?:asking|confirmation))/i, severity: 'high', action: 'block', category: 'system_override' },
  { name: 'enter_developer_mode', regex: /enter\s+(developer|debug|admin|god|sudo)\s+mode/i, severity: 'high', action: 'block', category: 'system_override' },

  // Role hijacking
  { name: 'act_as', regex: /(?:please\s+)?(?:you\s+(?:should|must|will)\s+)?act\s+as\s+(?:if\s+you\s+(?:are|were)|though\s+you)\s+/i, severity: 'medium', action: 'block', category: 'role_hijack' },
  { name: 'pretend_you_are', regex: /pretend\s+(you\s+are|to\s+be|you're)\s+/i, severity: 'medium', action: 'block', category: 'role_hijack' },
  { name: 'roleplay_as', regex: /role\s*play\s+(as|being)\s+/i, severity: 'medium', action: 'block', category: 'role_hijack' },
  { name: 'dan_jailbreak', regex: /\bDAN\b.*\b(do\s+anything|jailbreak|unrestricted)/i, severity: 'high', action: 'block', category: 'role_hijack' },
  { name: 'jailbreak_keyword', regex: /\bjailbreak\b/i, severity: 'high', action: 'block', category: 'role_hijack' },
  { name: 'bypass_filters', regex: /bypass\s+(your|the|all|any)\s+(filter|safet|restriction|guardrail|limit)/i, severity: 'high', action: 'block', category: 'role_hijack' },
  { name: 'ignore_safety', regex: /ignore\s+(your\s+)?(safety|ethical|content)\s+(guidelines|rules|filters|restrictions)/i, severity: 'high', action: 'block', category: 'role_hijack' },

  // Delimiter injection
  { name: 'close_system_tag', regex: /<\/system>/i, severity: 'high', action: 'strip', category: 'delimiter' },
  { name: 'open_system_tag', regex: /<system>/i, severity: 'high', action: 'strip', category: 'delimiter' },
  { name: 'inst_tag', regex: /\[INST\]/i, severity: 'high', action: 'strip', category: 'delimiter' },
  { name: 'end_inst_tag', regex: /\[\/INST\]/i, severity: 'high', action: 'strip', category: 'delimiter' },
  { name: 'sys_tag', regex: /<<SYS>>/i, severity: 'high', action: 'strip', category: 'delimiter' },
  { name: 'end_sys_tag', regex: /<<\/SYS>>/i, severity: 'high', action: 'strip', category: 'delimiter' },
  { name: 'human_prefix', regex: /^Human\s*:/im, severity: 'medium', action: 'strip', category: 'delimiter' },
  { name: 'assistant_prefix', regex: /^Assistant\s*:/im, severity: 'medium', action: 'strip', category: 'delimiter' },
  { name: 'user_prefix_tag', regex: /<\|?(user|human|im_start)\|?>/i, severity: 'medium', action: 'strip', category: 'delimiter' },
  { name: 'assistant_prefix_tag', regex: /<\|?(assistant|ai|im_end)\|?>/i, severity: 'medium', action: 'strip', category: 'delimiter' },

  // Tool / function injection
  { name: 'tool_use_block', regex: /"type"\s*:\s*"tool_use"/i, severity: 'high', action: 'block', category: 'tool_injection' },
  { name: 'function_call_block', regex: /"function_call"\s*:/i, severity: 'high', action: 'block', category: 'tool_injection' },
  { name: 'tool_xml_tag', regex: /<tool>/i, severity: 'high', action: 'block', category: 'tool_injection' },
  { name: 'tool_code_tag', regex: /<tool_code>/i, severity: 'high', action: 'block', category: 'tool_injection' },
  { name: 'antml_invoke', regex: /<invoke/i, severity: 'high', action: 'block', category: 'tool_injection' },
  { name: 'antml_function', regex: /<function_calls>/i, severity: 'high', action: 'block', category: 'tool_injection' },
  { name: 'fake_tool_result', regex: /"type"\s*:\s*"tool_result"/i, severity: 'high', action: 'block', category: 'tool_injection' },

  // Encoding evasion
  { name: 'base64_instruction', regex: /(?:base64|decode|atob)\s*[:(]\s*[A-Za-z0-9+/=]{20,}/i, severity: 'medium', action: 'block', category: 'encoding_evasion' },
  { name: 'zero_width_chars', regex: /[\u200B\u200C\u200D\uFEFF\u2060\u00AD]{3,}/, severity: 'low', action: 'strip', category: 'encoding_evasion' },
  { name: 'unicode_homoglyph_sequence', regex: /[\u0400-\u04FF]{2,}[\u0020-\u007E]+[\u0400-\u04FF]{2,}/i, severity: 'low', action: 'strip', category: 'encoding_evasion' },

  // Data exfiltration attempts
  { name: 'exfil_curl', regex: /curl\s+.*(?:private.key|\.env|secret|password|token)/i, severity: 'high', action: 'block', category: 'exfiltration' },
  { name: 'exfil_webhook', regex: /(?:webhook|ngrok|burpcollaborator|requestbin|hookbin)\.[a-z]+.*(?:key|secret|token|password)/i, severity: 'high', action: 'block', category: 'exfiltration' },
  { name: 'send_to_url', regex: /send\s+(?:my|the|your|all)\s+(?:key|secret|token|password|private|credential)/i, severity: 'high', action: 'block', category: 'exfiltration' },
];

// ── Output Patterns ──────────────────────────

const OUTPUT_PATTERNS: Pattern[] = [
  // Embedded instructions in tool output
  { name: 'output_ignore_previous', regex: /ignore\s+(all\s+)?(previous|prior|above)\s+(instructions|prompts|rules)/i, severity: 'high', action: 'block', category: 'embedded_instruction' },
  { name: 'output_important_prefix', regex: /^IMPORTANT\s*:/im, severity: 'medium', action: 'block', category: 'embedded_instruction' },
  { name: 'output_system_prefix', regex: /^SYSTEM\s*:/im, severity: 'high', action: 'block', category: 'embedded_instruction' },
  { name: 'output_new_instructions', regex: /new\s+instructions?\s*:/i, severity: 'high', action: 'block', category: 'embedded_instruction' },
  { name: 'output_override_prompt', regex: /override\s+(the\s+)?system\s+(prompt|instructions)/i, severity: 'high', action: 'block', category: 'embedded_instruction' },
  { name: 'output_you_must_now', regex: /you\s+must\s+now\s+(ignore|forget|disregard|override)/i, severity: 'high', action: 'block', category: 'embedded_instruction' },

  // Injected tool calls in output
  { name: 'output_tool_use', regex: /"type"\s*:\s*"tool_use"/i, severity: 'high', action: 'block', category: 'output_tool_injection' },
  { name: 'output_function_call', regex: /"function_call"\s*:/i, severity: 'high', action: 'block', category: 'output_tool_injection' },
  { name: 'output_antml_invoke', regex: /<invoke/i, severity: 'high', action: 'block', category: 'output_tool_injection' },

  // Sensitive data leaks
  { name: 'private_key_pvt', regex: /PVT_K1_[A-Za-z0-9]{44,}/i, severity: 'high', action: 'block', category: 'sensitive_data' },
  { name: 'private_key_5k', regex: /\b5K[A-HJ-NP-Za-km-z1-9]{49,}\b/, severity: 'high', action: 'block', category: 'sensitive_data' },
  { name: 'private_key_5j', regex: /\b5J[A-HJ-NP-Za-km-z1-9]{49,}\b/, severity: 'high', action: 'block', category: 'sensitive_data' },
  { name: 'aws_key', regex: /AKIA[0-9A-Z]{16}/, severity: 'high', action: 'block', category: 'sensitive_data' },
  { name: 'aws_secret', regex: /[A-Za-z0-9/+=]{40}(?=.*(?:aws|secret|key))/i, severity: 'medium', action: 'block', category: 'sensitive_data' },
  { name: 'api_key_generic', regex: /(?:api[_-]?key|apikey|secret[_-]?key)\s*[:=]\s*['"][A-Za-z0-9_\-]{20,}['"]/i, severity: 'medium', action: 'block', category: 'sensitive_data' },
  { name: 'bearer_token_leak', regex: /Bearer\s+[A-Za-z0-9_\-\.]{20,}/i, severity: 'medium', action: 'block', category: 'sensitive_data' },

  // Exfiltration via URL query params
  { name: 'url_exfil_key', regex: /https?:\/\/[^\s]+[?&](?:key|token|secret|password|apikey)=[^\s&]{8,}/i, severity: 'high', action: 'block', category: 'exfiltration' },
];

// Tools that return external content — lighter scan (sensitive data only)
const OUTPUT_BYPASS_TOOLS = new Set([
  'generate_image',
  'generate_video',
  'web_fetch',
  'web_search',
]);

// Sensitive-data-only patterns for bypass tools
const SENSITIVE_DATA_PATTERNS = OUTPUT_PATTERNS.filter(p => p.category === 'sensitive_data');

// ── Normalisation ────────────────────────────

// Common Cyrillic/Greek look-alikes of Latin letters (NFKC leaves these alone).
const CONFUSABLES: Record<string, string> = {
  'а': 'a', 'е': 'e', 'о': 'o', 'р': 'p', 'с': 'c', 'у': 'y', 'х': 'x', 'і': 'i', 'ј': 'j', 'ѕ': 's',
  'ԁ': 'd', 'һ': 'h', 'ԛ': 'q', 'ԝ': 'w', 'ɡ': 'g',
  'α': 'a', 'ε': 'e', 'ι': 'i', 'κ': 'k', 'ν': 'v', 'ο': 'o', 'ρ': 'p', 'τ': 't', 'υ': 'u', 'χ': 'x',
};

/**
 * Canonical form used only for matching, never returned: NFKC (fullwidth and other
 * compatibility forms), format characters removed, look-alikes and curly quotes folded,
 * lower-cased, and separators between single letters collapsed ("I.g.n.o.r.e" -> "ignore").
 */
export function normaliseForScan(text: string): string {
  let t = text.normalize('NFKC')
    .replace(/[\u00AD\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF]/g, '')
    .replace(/[\u2018\u2019\u201A\u201B\u2032]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F\u2033]/g, '"')
    .toLowerCase();
  t = t.replace(/[^\x00-\x7F]/g, (c) => CONFUSABLES[c] ?? c);
  // Runs of 3+ single letters joined by one repeated separator: "i.g.n.o.r.e", "i g n o r e"
  t = t.replace(/(?<![a-z])[a-z]([\s.\-_*·•|/\\,'`~+])(?:[a-z]\1)+[a-z](?![a-z])/g, (m) => m.replace(/[^a-z]/g, ''));
  return t.replace(/\s+/g, ' ');
}

// Block-action patterns that match the normalised text but not the raw text.
function normalisedBlockHits(text: string, patterns: Pattern[], already: string[]): Pattern[] {
  const normalised = normaliseForScan(text);
  if (normalised === text) return [];
  return patterns.filter(p => p.action === 'block' && !already.includes(p.name) && p.regex.test(normalised));
}

// ── Core scanning ────────────────────────────

function runPatterns(text: string, patterns: Pattern[]): ScanResult {
  const flagged: string[] = [];
  let highestSeverity: 'none' | 'low' | 'medium' | 'high' = 'none';
  let shouldBlock = false;
  let cleaned = text;

  const severityRank = { none: 0, low: 1, medium: 2, high: 3 };

  for (const pattern of patterns) {
    if (pattern.regex.test(text)) {
      flagged.push(pattern.name);

      if (severityRank[pattern.severity] > severityRank[highestSeverity]) {
        highestSeverity = pattern.severity;
      }

      if (pattern.action === 'block') {
        shouldBlock = true;
      } else if (pattern.action === 'strip') {
        cleaned = cleaned.replace(new RegExp(pattern.regex.source, pattern.regex.flags + (pattern.regex.flags.includes('g') ? '' : 'g')), '');
      }
    }
  }

  if (flagged.length === 0) {
    return { safe: true, text, flagged: [], severity: 'none', action: 'allow' };
  }

  if (shouldBlock) {
    return { safe: false, text: cleaned, flagged, severity: highestSeverity, action: 'block' };
  }

  stats.stripped++;
  return { safe: true, text: cleaned.replace(/\s{3,}/g, '  ').trim(), flagged, severity: highestSeverity, action: 'strip' };
}

// ── Public API ───────────────────────────────

export function scanInbound(text: string, source: string): ScanResult {
  const config = loadSecurityConfig();
  if (!config.enabled) {
    return { safe: true, text, flagged: [], severity: 'none', action: 'allow' };
  }

  stats.scanned++;
  let result = runPatterns(text, INBOUND_PATTERNS);

  // Obfuscated forms (spacing, homoglyphs, zero-width) are caught on the normalised copy
  const extra = normalisedBlockHits(text, INBOUND_PATTERNS, result.flagged);
  if (extra.length > 0) {
    const rank = { none: 0, low: 1, medium: 2, high: 3 };
    let severity = result.severity;
    for (const p of extra) if (rank[p.severity] > rank[severity]) severity = p.severity;
    if (result.action === 'strip') stats.stripped--;
    result = { safe: false, text: result.text, flagged: [...result.flagged, ...extra.map(p => `${p.name}:normalised`)], severity, action: 'block' };
  }

  if (result.action === 'block') {
    stats.blocked++;
    if (config.logBlocked) {
      console.warn(`[security] Blocked inbound (${source}): ${result.flagged.join(', ')}`);
    }
    // In warn mode, downgrade block to strip
    if (config.mode === 'warn') {
      return { ...result, safe: true, action: 'strip' };
    }
  }

  return result;
}

export function scanOutput(toolName: string, output: string): ScanResult {
  const config = loadSecurityConfig();
  if (!config.enabled) {
    return { safe: true, text: output, flagged: [], severity: 'none', action: 'allow' };
  }

  stats.scanned++;

  // Bypass tools get a lighter scan (sensitive data only)
  const patterns = OUTPUT_BYPASS_TOOLS.has(toolName) ? SENSITIVE_DATA_PATTERNS : OUTPUT_PATTERNS;
  const result = runPatterns(output, patterns);

  if (result.action === 'block') {
    stats.blocked++;
    if (config.logBlocked) {
      console.warn(`[security] Blocked output from ${toolName}: ${result.flagged.join(', ')}`);
    }
    if (config.mode === 'warn') {
      return { ...result, safe: true, action: 'strip' };
    }
  }

  return result;
}
