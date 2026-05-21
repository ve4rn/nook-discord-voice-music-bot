import sharp from "sharp";

type DominantColorOptions = {
  timeoutMs?: number;
  maxBytes?: number;
  sampleSize?: number;
  minAlpha?: number;
  cacheTtlMs?: number;
};

const DEFAULT_OPTIONS = {
  timeoutMs: 5_000,
  maxBytes: 8 * 1024 * 1024,
  sampleSize: 64,
  minAlpha: 32,
  cacheTtlMs: 1000 * 60 * 30,
} satisfies Required<DominantColorOptions>;

const MAX_CACHE_SIZE = 500;

const cache = new Map<
  string,
  {
    expiresAt: number;
    value: Promise<number | null>;
  }
>();

export async function getDominantColorFromImageUrl(
  imageUrl: string,
  options: DominantColorOptions = {},
): Promise<number | null> {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  const cacheKey = `${imageUrl}:${opts.sampleSize}:${opts.minAlpha}`;
  const now = Date.now();

  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return cached.value;
  }

  const value = computeDominantColorFromImageUrl(imageUrl, opts).catch(() => null);

  cache.set(cacheKey, {
    value,
    expiresAt: now + opts.cacheTtlMs,
  });

  if (cache.size > MAX_CACHE_SIZE) {
    const firstKey = cache.keys().next().value;
    if (firstKey) cache.delete(firstKey);
  }

  return value;
}

async function computeDominantColorFromImageUrl(
  imageUrl: string,
  options: Required<DominantColorOptions>,
): Promise<number | null> {
  const buffer = await fetchImageBuffer(imageUrl, options);
  if (!buffer) return null;

  return getDominantColorFromImageBuffer(buffer, options);
}

export async function getDominantColorFromImageBuffer(
  buffer: Buffer,
  options: DominantColorOptions = {},
): Promise<number | null> {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  try {
    const { data, info } = await sharp(buffer, {
      animated: false,
      failOn: "none",
      limitInputPixels: 40_000_000,
      sequentialRead: true,
    })
      .rotate()
      .resize(opts.sampleSize, opts.sampleSize, {
        fit: "inside",
        withoutEnlargement: true,
        fastShrinkOnLoad: true,
        kernel: sharp.kernel.cubic,
      })
      .toColorspace("srgb")
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    if (!data.length || info.width <= 0 || info.height <= 0) return null;

    return pickBestColor(data, info.width, info.height, info.channels, opts.minAlpha);
  } catch {
    return null;
  }
}

async function fetchImageBuffer(
  imageUrl: string,
  options: Required<DominantColorOptions>,
): Promise<Buffer | null> {
  let url: URL;

  try {
    url = new URL(imageUrl);
  } catch {
    return null;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return null;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: "image/avif,image/webp,image/png,image/jpeg,image/gif,image/*;q=0.8",
      },
    });

    if (!response.ok) return null;

    const contentType = response.headers.get("content-type");
    if (contentType && !contentType.toLowerCase().startsWith("image/")) {
      return null;
    }

    const contentLength = Number(response.headers.get("content-length") ?? 0);
    if (contentLength > options.maxBytes) {
      return null;
    }

    if (!response.body) {
      const arrayBuffer = await response.arrayBuffer();
      if (arrayBuffer.byteLength > options.maxBytes) return null;
      return Buffer.from(arrayBuffer);
    }

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let received = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;

      received += value.byteLength;

      if (received > options.maxBytes) {
        await reader.cancel().catch(() => undefined);
        return null;
      }

      chunks.push(value);
    }

    return Buffer.concat(chunks, received);
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function pickBestColor(
  data: Buffer,
  width: number,
  height: number,
  channels: number,
  minAlpha: number,
): number | null {
  const bucketCount = 16 * 16 * 16;

  const counts = new Uint32Array(bucketCount);
  const scores = new Float64Array(bucketCount);

  const sumR = new Float64Array(bucketCount);
  const sumG = new Float64Array(bucketCount);
  const sumB = new Float64Array(bucketCount);

  let totalPixels = 0;
  let fallbackR = 0;
  let fallbackG = 0;
  let fallbackB = 0;

  const centerX = (width - 1) / 2;
  const centerY = (height - 1) / 2;
  const maxDistance = Math.sqrt(centerX * centerX + centerY * centerY) || 1;

  let index = 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const r = data[index];
      const g = data[index + 1];
      const b = data[index + 2];
      const a = channels >= 4 ? data[index + 3] : 255;

      index += channels;

      if (r == null || g == null || b == null || a == null) continue;
      if (a < minAlpha) continue;

      totalPixels++;

      fallbackR += r;
      fallbackG += g;
      fallbackB += b;

      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const chroma = max - min;

      const saturation = max === 0 ? 0 : chroma / max;
      const luma = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;

      const distanceFromCenter = Math.sqrt((x - centerX) ** 2 + (y - centerY) ** 2);
      const centerWeight = 0.85 + 0.3 * (1 - distanceFromCenter / maxDistance);

      const saturationWeight = 0.45 + Math.min(1, saturation * 1.8);
      const chromaWeight = 0.7 + Math.min(1, chroma / 90) * 0.65;

      const lumaDistance = Math.abs(luma - 0.52) / 0.52;
      const lumaWeight = 0.55 + clamp01(1 - lumaDistance) * 0.8;

      const alphaWeight = a / 255;

      let penalty = 1;

      if (saturation < 0.06) penalty *= 0.28;
      if (luma < 0.06 || luma > 0.96) penalty *= 0.18;
      else if (luma < 0.12 || luma > 0.9) penalty *= 0.45;

      const score =
        alphaWeight *
        centerWeight *
        saturationWeight *
        chromaWeight *
        lumaWeight *
        penalty;

      const bucketR = r >> 4;
      const bucketG = g >> 4;
      const bucketB = b >> 4;
      const bucketKey = (bucketR << 8) | (bucketG << 4) | bucketB;

      counts[bucketKey]++;
      scores[bucketKey] += score;

      sumR[bucketKey] += r;
      sumG[bucketKey] += g;
      sumB[bucketKey] += b;
    }
  }

  if (totalPixels === 0) return null;

  const minBucketPresence = Math.max(2, Math.floor(totalPixels * 0.002));

  let bestKey = -1;
  let bestScore = -Infinity;

  for (let key = 0; key < bucketCount; key++) {
    const count = counts[key];
    if (count === 0) continue;

    const avgR = sumR[key] / count;
    const avgG = sumG[key] / count;
    const avgB = sumB[key] / count;

    const max = Math.max(avgR, avgG, avgB);
    const min = Math.min(avgR, avgG, avgB);
    const chroma = max - min;
    const saturation = max === 0 ? 0 : chroma / max;
    const luma = (0.2126 * avgR + 0.7152 * avgG + 0.0722 * avgB) / 255;

    let candidateScore = scores[key];

    if (count < minBucketPresence) candidateScore *= 0.35;
    if (saturation < 0.05) candidateScore *= 0.35;
    if (luma < 0.04 || luma > 0.97) candidateScore *= 0.2;

    if (candidateScore > bestScore) {
      bestScore = candidateScore;
      bestKey = key;
    }
  }

  if (bestKey !== -1) {
    const count = counts[bestKey];

    const r = Math.round(sumR[bestKey] / count);
    const g = Math.round(sumG[bestKey] / count);
    const b = Math.round(sumB[bestKey] / count);

    return rgbToInt(r, g, b);
  }

  const r = Math.round(fallbackR / totalPixels);
  const g = Math.round(fallbackG / totalPixels);
  const b = Math.round(fallbackB / totalPixels);

  return rgbToInt(r, g, b);
}

function rgbToInt(r: number, g: number, b: number): number {
  return ((clamp255(r) << 16) | (clamp255(g) << 8) | clamp255(b)) >>> 0;
}

function clamp255(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}