import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatTrackDisplay(rawTitle?: string | null, rawUrl?: string | null): { title: string; url: string } {
  const t = (rawTitle || "").trim();
  const u = (rawUrl || "").trim();

  if (!t && !u) {
    return { title: "Unknown Track", url: "" };
  }

  const isTitleUrl = t.startsWith("http://") || t.startsWith("https://") || t === u;

  if (isTitleUrl) {
    let cleanTitle = "YouTube Track";
    const m = u.match(/(?:v=|youtu\.be\/|shorts\/|embed\/|watch\?.*v=)([a-zA-Z0-9_-]{11})/);
    if (m) {
      cleanTitle = `YouTube Track (${m[1]})`;
    }
    return {
      title: cleanTitle,
      url: u,
    };
  }

  return {
    title: t,
    url: u && u !== t ? u : "",
  };
}

export function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600).toString().padStart(2, "0");
  const m = Math.floor((seconds % 3600) / 60).toString().padStart(2, "0");
  const s = (seconds % 60).toString().padStart(2, "0");
  return `${h}:${m}:${s}`;
}

export function getThumbnailFromUrl(url?: string | null): string {
  if (!url) return "";
  const m = url.match(/(?:v=|youtu\.be\/|shorts\/|embed\/|watch\?.*v=)([a-zA-Z0-9_-]{11})/);
  if (m) {
    return `https://i.ytimg.com/vi/${m[1]}/hqdefault.jpg`;
  }
  return "";
}

export function normalizeSearchText(str?: string | null): string {
  if (!str) return "";
  return String(str)
    .toLowerCase()
    .replace(/['’`´"“”]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function matchesSearchQuery(target?: string | null, query?: string | null): boolean {
  if (!query) return true;
  if (!target) return false;
  const nTarget = normalizeSearchText(target);
  const nQuery = normalizeSearchText(query);
  if (!nQuery) return true;
  if (nTarget.includes(nQuery)) return true;

  const qTokens = nQuery.split(" ").filter(Boolean);
  const tTokens = nTarget.split(" ").filter(Boolean);

  if (qTokens.every((q) => tTokens.some((t) => t.includes(q)))) return true;

  if (qTokens.length >= 2) {
    const matched = qTokens.filter((q) => tTokens.some((t) => t.includes(q))).length;
    if (matched / qTokens.length >= 0.5) return true;
  }
  return false;
}

export async function copyToClipboard(text: string): Promise<boolean> {
  if (!text) return false;
  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fallback
  }
  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    const successful = document.execCommand("copy");
    document.body.removeChild(textarea);
    return successful;
  } catch {
    return false;
  }
}
