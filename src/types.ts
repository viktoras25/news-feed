export type FeedConfig = {
  name: string;
  priority: 1 | 2;
  url: string;
  topic: string;
};

export type Keywords = {
  include: string[];
  wordBoundary: string[];
  exclude: string[];
};

// Одна запись из RSS после очистки. title и snippet уже безопасны как текст,
// но Markdown-экранирование делается только при выводе (см. render.ts).
export type Item = {
  topic: string;
  source: string;
  priority: 1 | 2;
  title: string;
  url: string;
  published: Date;
  snippet: string;
  // Полный очищенный текст (без обрезки) только для поиска ключевых слов.
  searchText: string;
};

// Результат загрузки одного фида до разбора записей.
export type RawEntry = {
  title: string;
  link: string;
  date: Date | null;
  description: string;
};

export type FeedStatusKind =
  | 'ok'
  | 'quiet' // фид работает, но за окно нет записей
  | 'empty' // фид работает, но в нём нет ни одной записи
  | 'no_dates' // записи есть, но ни у одной нет даты
  | 'http_error'
  | 'timeout'
  | 'parse_error';

export type FeedReport = {
  feed: FeedConfig;
  status: FeedStatusKind;
  detail: string;
  fetched: number; // записей в фиде
  inWindow: number; // после фильтра по времени
  afterNoise: number; // после фильтра шума и лимита priority 2
  kept: number; // осталось после дедупликации
  droppedInjection: number; // записей с подозрительным заголовком
  strippedSnippets: number; // сниппетов, убранных из-за подозрительного текста
};
