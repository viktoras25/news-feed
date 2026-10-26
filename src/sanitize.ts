// Everything that comes from RSS is treated as untrusted data.
// Here the text is stripped of HTML and anything that looks like instructions for an assistant is removed.

export const MAX_SNIPPET_LENGTH = 300;
export const MAX_TITLE_LENGTH = 200;

// If at least one pattern matches, the text is considered suspicious.
// For a snippet that means the snippet is dropped entirely; for a title, the entry is dropped.
// Patterns have no g flag so that RegExp carries no state between calls.
export const INJECTION_PATTERNS: RegExp[] = [
  // English
  /ignore\s+(all\s+|any\s+|the\s+)?(previous|prior|above|earlier)/i,
  /disregard\s+(all\s+|any\s+|the\s+)?(previous|prior|above|earlier|instructions)/i,
  /forget\s+(all\s+|everything|your|the\s+previous)/i,
  /you\s+are\s+(now\s+|an?\s+|the\s+)/i,
  /(system|developer)\s+prompt/i,
  /new\s+instructions?/i,
  /\binstructions?\s*:/i,
  // Addressing an AI, detected by structure. The names themselves (OpenAI, Claude, Home Assistant) are
  // normal in tech news, so only an address or a command is matched.
  /\b(dear|hey|hello|attention|note\s+to|message\s+for|for\s+the)\s+(ai|a\.i\.|assistant|claude|chatgpt|chatbot|llm|model|agent)s?\b/i,
  /\b(ai|assistant|claude|chatgpt|chatbot|llm|agent)\s*[,:]\s*(please|you\s+(must|should|will|need)|ignore|do\s+not|don't|call|send|forward|summari[sz]e|read|fetch|open|visit|run|execute|output|reply|respond)\b(?!\s+source)/i,
  /\bif\s+you\s+are\s+(an?\s+)?(ai|llm|assistant|language\s+model|chatbot|agent)/i,
  /\byou\s+(must|should|will)\s+(now\s+)?(ignore|obey|call|send|forward|reveal|output|execute|run)\b/i,
  /\b(tool|function)\s+call/i,
  /\bas\s+an\s+ai\b/i,
  /\bdo\s+not\s+(tell|mention|reveal)/i,
  // German
  /ignorier(e|en)\s+(alle|die|jegliche)/i,
  /vergiss\s+(alle|die|alles)/i,
  /du\s+bist\s+(nun|jetzt|ein)/i,
  /neue\s+anweisung/i,
  /\b(ki|assistent|chatbot)\s*[,:]\s*(bitte|du\s+(musst|sollst)|ignorier|vergiss)/i,
  // markup used to disguise commands
  // tags that pose as a prompt structure, checked on the raw text before HTML is stripped
  /<\/?\s*(instructions?|system|assistant|prompt|tool_?calls?|function_?calls?)\b/i,
  /```/,
  /<\|.*?\|>/,
  /\[\/?INST\]/i,
  /^\s*(system|user|assistant)\s*:/im,
];

export function looksLikeInjection(text: string): boolean {
  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(text)) {
      return true;
    }
  }
  return false;
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  auml: 'ä',
  ouml: 'ö',
  uuml: 'ü',
  Auml: 'Ä',
  Ouml: 'Ö',
  Uuml: 'Ü',
  szlig: 'ß',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  laquo: '«',
  raquo: '»',
  bdquo: '„',
  ldquo: '“',
  rdquo: '”',
  lsquo: '‘',
  rsquo: '’',
  euro: '€',
};

// Single pass, so that "&amp;lt;" becomes "&lt;" and not "<".
export function decodeEntities(input: string): string {
  return input.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (whole, body: string) => {
    if (body.startsWith('#x') || body.startsWith('#X')) {
      const code = parseInt(body.slice(2), 16);
      return codePointToString(code, whole);
    }
    if (body.startsWith('#')) {
      const code = parseInt(body.slice(1), 10);
      return codePointToString(code, whole);
    }
    const named = NAMED_ENTITIES[body];
    return named === undefined ? whole : named;
  });
}

function codePointToString(code: number, fallback: string): string {
  if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) {
    return fallback;
  }
  return String.fromCodePoint(code);
}

export function stripHtml(input: string): string {
  let text = input.replace(/<!\[CDATA\[|\]\]>/g, '');
  text = text.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ');
  text = text.replace(/<[^>]*>/g, ' ');
  text = decodeEntities(text);
  // After decoding, "&lt;b&gt;" may have turned into tags again.
  text = text.replace(/<[^>]*>/g, ' ');
  // Stray angle brackets are no longer needed.
  text = text.replace(/[<>]/g, ' ');
  return text.replace(/\s+/g, ' ').trim();
}

export function truncate(text: string, max: number): string {
  if (text.length <= max) {
    return text;
  }
  const cut = text.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  // Cut at a word boundary, but only if that does not lose too much.
  const base = lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut;
  return base.replace(/[\s.,;:!?-]+$/, '') + '…';
}

export type CleanTitle = {
  text: string;
  flagged: boolean;
};

export function cleanTitle(raw: string): CleanTitle {
  const text = stripHtml(raw);
  if (looksLikeInjection(raw) || looksLikeInjection(text)) {
    return { text: '', flagged: true };
  }
  return { text: truncate(text, MAX_TITLE_LENGTH), flagged: false };
}

export type CleanSnippet = {
  text: string; // for output, up to 300 characters
  full: string; // for keyword search
  flagged: boolean;
};

export function cleanSnippet(raw: string): CleanSnippet {
  const stripped = stripHtml(raw);
  if (looksLikeInjection(raw) || looksLikeInjection(stripped)) {
    return { text: '', full: '', flagged: true };
  }
  // Links are removed from the snippet: the only link in an entry is the entry's own url.
  const withoutUrls = stripped.replace(/https?:\/\/\S+/gi, '').replace(/\s+/g, ' ').trim();
  return {
    text: truncate(withoutUrls, MAX_SNIPPET_LENGTH),
    full: withoutUrls,
    flagged: false,
  };
}

// Markdown escaping for output: so that text from a feed cannot create
// a heading, link, image or table.
export function escapeMarkdown(text: string): string {
  const escaped = text.replace(/[\\`*_\[\]<>|~]/g, '\\$&');
  // A line that starts with a list, quote or heading marker would turn into markup.
  return escaped.replace(/^(\s*)([#>+-]|\d+[.)])/, '$1\\$2');
}
