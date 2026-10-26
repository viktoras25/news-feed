import { createHash } from 'node:crypto';
import { jaccard, normalizeUrl, sharedTokenCount, titleTokens } from './dedupe.ts';
import { matchesWords } from './filter.ts';
import type { Cluster, Item, Keywords } from './types.ts';

export const CLUSTER_SIMILARITY_THRESHOLD = 0.4;
// Titles must also share at least this many words, so two short titles with one common word do not merge.
export const MIN_SHARED_TOKENS = 2;
export const MAX_CLUSTERS_PER_TOPIC = 12;
export const MAX_CLUSTERS_TOTAL = 50;

export type ClusterResult = {
  clusters: Cluster[];
  removedByUrl: number;
};

export function distinctSources(cluster: Cluster): string[] {
  const names: string[] = [];
  for (const member of cluster.members) {
    if (!names.includes(member.source)) {
      names.push(member.source);
    }
  }
  return names;
}

function makeCluster(members: Item[], keywords: Keywords): Cluster {
  const head = members[0];

  // Snippet of the head, or the first non-empty one if the head has none.
  let snippet = head.snippet;
  for (const member of members) {
    if (snippet === '') {
      snippet = member.snippet;
    }
  }

  let published = head.published;
  for (const member of members) {
    if (member.published.getTime() < published.getTime()) {
      published = member.published;
    }
  }

  const text = members.map((member) => member.title + ' ' + member.searchText).join(' ');
  const tags: string[] = [];
  for (const tag of Object.keys(keywords.tags)) {
    if (matchesWords(text, keywords.tags[tag], keywords.wordBoundary)) {
      tags.push(tag);
    }
  }

  const id = createHash('sha1').update(normalizeUrl(head.url)).digest('hex').slice(0, 10);

  return { id, topic: head.topic, head, members, snippet, published, tags };
}

// Groups entries about the same event. The first entry of a cluster (best priority, then earliest)
// is its head; later entries join the first cluster whose head title is similar enough.
export function clusterItems(items: Item[], keywords: Keywords): ClusterResult {
  const sorted = [...items].sort((a, b) => {
    if (a.priority !== b.priority) {
      return a.priority - b.priority;
    }
    return a.published.getTime() - b.published.getTime();
  });

  const groups: Item[][] = [];
  const headTokens: Set<string>[] = [];
  const seenUrls = new Set<string>();
  let removedByUrl = 0;

  for (const item of sorted) {
    const urlKey = normalizeUrl(item.url);
    if (seenUrls.has(urlKey)) {
      removedByUrl += 1;
      continue;
    }
    seenUrls.add(urlKey);

    const tokens = titleTokens(item.title);
    let joined = false;
    for (let i = 0; i < groups.length; i++) {
      const similar = jaccard(tokens, headTokens[i]) >= CLUSTER_SIMILARITY_THRESHOLD;
      const enoughShared = sharedTokenCount(tokens, headTokens[i]) >= MIN_SHARED_TOKENS;
      if (similar && enoughShared) {
        groups[i].push(item);
        joined = true;
        break;
      }
    }
    if (!joined) {
      groups.push([item]);
      headTokens.push(tokens);
    }
  }

  return {
    clusters: groups.map((members) => makeCluster(members, keywords)),
    removedByUrl,
  };
}

// Best (lowest) position that any member has in its own feed.
function bestFeedRank(cluster: Cluster): number {
  let best = cluster.members[0].feedRank;
  for (const member of cluster.members) {
    if (member.feedRank < best) {
      best = member.feedRank;
    }
  }
  return best;
}

// More distinct sources first (an event picked up widely matters more), then better priority,
// then the top of each feed before its lower entries (so feeds take turns), then newer.
function compareClusters(a: Cluster, b: Cluster): number {
  const sourcesA = distinctSources(a).length;
  const sourcesB = distinctSources(b).length;
  if (sourcesA !== sourcesB) {
    return sourcesB - sourcesA;
  }
  if (a.head.priority !== b.head.priority) {
    return a.head.priority - b.head.priority;
  }
  const rankA = bestFeedRank(a);
  const rankB = bestFeedRank(b);
  if (rankA !== rankB) {
    return rankA - rankB;
  }
  return b.published.getTime() - a.published.getTime();
}

// Keeps at most perTopic clusters per topic and at most total overall. When the total limit bites,
// topics are served round-robin (best of each topic first) so no topic disappears.
export function capClusters(clusters: Cluster[], perTopic: number, total: number): Cluster[] {
  const byTopic = new Map<string, Cluster[]>();
  for (const cluster of [...clusters].sort(compareClusters)) {
    const list = byTopic.get(cluster.topic) ?? [];
    if (list.length < perTopic) {
      list.push(cluster);
    }
    byTopic.set(cluster.topic, list);
  }

  const result: Cluster[] = [];
  const lists = [...byTopic.values()];
  for (let rank = 0; result.length < total; rank++) {
    let added = false;
    for (const list of lists) {
      if (rank < list.length && result.length < total) {
        result.push(list[rank]);
        added = true;
      }
    }
    if (!added) {
      break;
    }
  }
  return result;
}

// Order inside a topic section of the output.
export function sortForOutput(clusters: Cluster[]): Cluster[] {
  return [...clusters].sort(compareClusters);
}
