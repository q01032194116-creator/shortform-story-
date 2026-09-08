import type { ImageCandidate } from "../types.js";

interface PexelsPhoto {
  id: number;
  url: string;
  photographer: string;
  src: { large: string; large2x: string; original: string };
}

interface UnsplashPhoto {
  id: string;
  urls: { regular: string; full: string };
  links: { html: string };
  user: { name: string };
}

const TIMEOUT_MS = 20_000;

async function getJson<T>(url: string, headers: Record<string, string>): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, { headers, signal: controller.signal });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    return (await response.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Stock providers serve pre-sized renditions, so we request a blog-sized image
 * directly and never need a native image-processing dependency.
 */
export async function searchPexels(query: string, key: string, perPage = 4): Promise<ImageCandidate[]> {
  if (!key) return [];
  const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=${perPage}&orientation=landscape`;
  const data = await getJson<{ photos?: PexelsPhoto[] }>(url, { Authorization: key });
  return (data.photos ?? []).map((photo) => ({
    id: `pexels-${photo.id}`,
    provider: "pexels" as const,
    query,
    pageUrl: photo.url,
    downloadUrl: photo.src.large,
    credit: `Photo by ${photo.photographer} on Pexels`,
    filePath: null,
    score: null,
    fits: null,
    reason: null,
    altText: null,
    caption: null,
  }));
}

export async function searchUnsplash(query: string, key: string, perPage = 4): Promise<ImageCandidate[]> {
  if (!key) return [];
  const url = `https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&per_page=${perPage}&orientation=landscape`;
  const data = await getJson<{ results?: UnsplashPhoto[] }>(url, { Authorization: `Client-ID ${key}` });
  return (data.results ?? []).map((photo) => ({
    id: `unsplash-${photo.id}`,
    provider: "unsplash" as const,
    query,
    pageUrl: photo.links.html,
    downloadUrl: photo.urls.regular,
    credit: `Photo by ${photo.user.name} on Unsplash`,
    filePath: null,
    score: null,
    fits: null,
    reason: null,
    altText: null,
    caption: null,
  }));
}

export async function searchStock(
  query: string,
  keys: { pexelsKey: string; unsplashKey: string },
): Promise<ImageCandidate[]> {
  const [pexels, unsplash] = await Promise.all([
    searchPexels(query, keys.pexelsKey).catch(() => []),
    searchUnsplash(query, keys.unsplashKey).catch(() => []),
  ]);
  // Interleave providers so one source cannot monopolise the candidate list.
  const merged: ImageCandidate[] = [];
  for (let i = 0; i < Math.max(pexels.length, unsplash.length); i += 1) {
    if (pexels[i]) merged.push(pexels[i]!);
    if (unsplash[i]) merged.push(unsplash[i]!);
  }
  return merged;
}
