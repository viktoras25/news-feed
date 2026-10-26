// Всё, что приходит из RSS, считается недоверенными данными.
// Здесь текст очищается от HTML, а всё похожее на инструкции для ассистента убирается.

export const MAX_SNIPPET_LENGTH = 300;
export const MAX_TITLE_LENGTH = 200;

// Если хотя бы один паттерн сработал, текст считается подозрительным.
// Для сниппета это значит: сниппет выбрасывается целиком. Для заголовка: запись выбрасывается.
// Паттерны без флага g, чтобы у RegExp не было состояния между вызовами.
export const INJECTION_PATTERNS: RegExp[] = [
  // английский
  /ignore\s+(all\s+|any\s+|the\s+)?(previous|prior|above|earlier)/i,
  /disregard\s+(all\s+|any\s+|the\s+)?(previous|prior|above|earlier|instructions)/i,
  /forget\s+(all\s+|everything|your|the\s+previous)/i,
  /you\s+are\s+(now\s+|an?\s+|the\s+)/i,
  /(system|developer)\s+prompt/i,
  /new\s+instructions?/i,
  /\binstructions?\s*:/i,
  // Обращение к ИИ по структуре. Сами названия (OpenAI, Claude, Home Assistant) в tech-новостях
  // нормальны, поэтому ловим только обращение или команду.
  /\b(dear|hey|hello|attention|note\s+to|message\s+for|for\s+the)\s+(ai|a\.i\.|assistant|claude|chatgpt|chatbot|llm|model|agent)s?\b/i,
  /\b(ai|assistant|claude|chatgpt|chatbot|llm|agent)\s*[,:]\s*(please|you\s+(must|should|will|need)|ignore|do\s+not|don't|call|send|forward|summari[sz]e|read|fetch|open|visit|run|execute|output|reply|respond)\b(?!\s+source)/i,
  /\bif\s+you\s+are\s+(an?\s+)?(ai|llm|assistant|language\s+model|chatbot|agent)/i,
  /\byou\s+(must|should|will)\s+(now\s+)?(ignore|obey|call|send|forward|reveal|output|execute|run)\b/i,
  /\b(tool|function)\s+call/i,
  /\bas\s+an\s+ai\b/i,
  /\bdo\s+not\s+(tell|mention|reveal)/i,
  // немецкий
  /ignorier(e|en)\s+(alle|die|jegliche)/i,
  /vergiss\s+(alle|die|alles)/i,
  /du\s+bist\s+(nun|jetzt|ein)/i,
  /neue\s+anweisung/i,
  /\b(ki|assistent|chatbot)\s*[,:]\s*(bitte|du\s+(musst|sollst)|ignorier|vergiss)/i,
  // русский
  /игнорир(уй|уйте)/i,
  /забудь(те)?\s+(все|предыдущ)/i,
  /ты\s+(теперь|должен)/i,
  /системн(ый|ое)\s+(промпт|сообщение)/i,
  /(ассистент|нейросеть|ии)\s*[,:]\s*(пожалуйста|ты\s+должен|игнорируй|отправь|перешли|выполни)/i,
  // разметка, которой маскируют команды
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

// Одним проходом, чтобы "&amp;lt;" стало "&lt;", а не "<".
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
  // После декодирования из "&lt;b&gt;" снова могли получиться теги.
  text = text.replace(/<[^>]*>/g, ' ');
  // Одиночные угловые скобки больше не нужны.
  text = text.replace(/[<>]/g, ' ');
  return text.replace(/\s+/g, ' ').trim();
}

export function truncate(text: string, max: number): string {
  if (text.length <= max) {
    return text;
  }
  const cut = text.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  // Режем по границе слова, но только если не потеряем слишком много.
  const base = lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut;
  return base.replace(/[\s.,;:!?-]+$/, '') + '…';
}

export type CleanTitle = {
  text: string;
  flagged: boolean;
};

export function cleanTitle(raw: string): CleanTitle {
  const text = stripHtml(raw);
  if (looksLikeInjection(text)) {
    return { text: '', flagged: true };
  }
  return { text: truncate(text, MAX_TITLE_LENGTH), flagged: false };
}

export type CleanSnippet = {
  text: string; // для вывода, до 300 символов
  full: string; // для поиска ключевых слов
  flagged: boolean;
};

export function cleanSnippet(raw: string): CleanSnippet {
  const stripped = stripHtml(raw);
  if (looksLikeInjection(stripped)) {
    return { text: '', full: '', flagged: true };
  }
  // Ссылки из сниппета убираем: единственная ссылка в записи - это url самой записи.
  const withoutUrls = stripped.replace(/https?:\/\/\S+/gi, '').replace(/\s+/g, ' ').trim();
  return {
    text: truncate(withoutUrls, MAX_SNIPPET_LENGTH),
    full: withoutUrls,
    flagged: false,
  };
}

// Экранирование для вывода в Markdown: чтобы текст из фида не мог создать
// заголовок, ссылку, картинку или таблицу.
export function escapeMarkdown(text: string): string {
  return text.replace(/[\\`*_{}\[\]()<>#+!|~]/g, '\\$&');
}
