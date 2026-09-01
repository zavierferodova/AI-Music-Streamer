import {
  AuthStatusResponse,
  AuthVerifyResponse,
  Playlist,
  SearchResponse,
  ServerStatus,
  UserRole,
} from "@/types";

export function getAuthToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("music_token");
}

export function setAuthToken(token: string) {
  if (typeof window === "undefined") return;
  localStorage.setItem("music_token", token);
}

export function getAuthRole(): UserRole | null {
  if (typeof window === "undefined") return null;
  return (localStorage.getItem("music_role") as UserRole) || null;
}

export function setAuthRole(role: UserRole) {
  if (typeof window === "undefined") return;
  localStorage.setItem("music_role", role);
}

export function clearAuthToken() {
  if (typeof window === "undefined") return;
  localStorage.removeItem("music_token");
  localStorage.removeItem("music_role");
}

function getHeaders(customHeaders: Record<string, string> = {}): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...customHeaders,
  };
  const token = getAuthToken();
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  return headers;
}

export async function fetchServerStatus(): Promise<ServerStatus | null> {
  try {
    const res = await fetch("/status", {
      headers: getHeaders(),
      cache: "no-store",
    });
    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    console.error("fetchServerStatus error:", err);
    return null;
  }
}

export async function checkAuthStatus(): Promise<AuthStatusResponse | null> {
  try {
    const res = await fetch("/api/auth/status", {
      headers: getHeaders(),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const data: AuthStatusResponse = await res.json();
    if (data.authenticated && data.role) {
      setAuthRole(data.role);
    }
    return data;
  } catch (err) {
    console.error("checkAuthStatus error:", err);
    return null;
  }
}

export async function verifyOtp(otp: string): Promise<AuthVerifyResponse> {
  try {
    const res = await fetch("/api/auth/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ otp }),
    });
    const data: AuthVerifyResponse = await res.json();
    if (res.ok && data.authenticated && data.token) {
      setAuthToken(data.token);
      if (data.role) {
        setAuthRole(data.role);
      }
    }
    return data;
  } catch (err: any) {
    console.error("verifyOtp error:", err);
    return {
      status: "error",
      authenticated: false,
      message: err?.message || "Network connection error",
    };
  }
}

export async function fetchPlaylists(): Promise<Playlist[]> {
  try {
    const res = await fetch("/api/playlists", {
      headers: getHeaders(),
      cache: "no-store",
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data.playlists || [];
  } catch (err) {
    console.error("fetchPlaylists error:", err);
    return [];
  }
}

export async function fetchPlaylist(name: string): Promise<Playlist | null> {
  try {
    const res = await fetch(`/api/playlist?name=${encodeURIComponent(name)}`, {
      headers: getHeaders(),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.playlist || null;
  } catch (err) {
    console.error("fetchPlaylist error:", err);
    return null;
  }
}

export async function createPlaylist(name: string): Promise<boolean> {
  try {
    const res = await fetch("/api/playlist/create", {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify({ name }),
    });
    return res.ok;
  } catch (err) {
    console.error("createPlaylist error:", err);
    return false;
  }
}

export async function renamePlaylist(playlist: string, newName: string): Promise<boolean> {
  try {
    const res = await fetch("/api/playlist/rename", {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify({ playlist, new_name: newName }),
    });
    return res.ok;
  } catch (err) {
    console.error("renamePlaylist error:", err);
    return false;
  }
}

export async function deletePlaylist(name: string): Promise<boolean> {
  try {
    const res = await fetch("/api/playlist/delete", {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify({ name }),
    });
    return res.ok;
  } catch (err) {
    console.error("deletePlaylist error:", err);
    return false;
  }
}

export async function addTrackToPlaylist(
  playlist: string,
  url: string,
  title: string = ""
): Promise<{ success: boolean; already_exists?: boolean; message?: string; track?: any }> {
  try {
    const res = await fetch("/api/playlist/add", {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify({ playlist, url, title }),
    });
    if (!res.ok) return { success: false, message: `Request failed with status ${res.status}` };
    const data = await res.json();
    return {
      success: true,
      already_exists: Boolean(data.already_exists || data.status === "already_exists"),
      message: data.message,
      track: data.track,
    };
  } catch (err: any) {
    console.error("addTrackToPlaylist error:", err);
    return { success: false, message: err?.message || "Network error" };
  }
}

export async function removeTrackFromPlaylist(playlist: string, index: number): Promise<boolean> {
  try {
    const res = await fetch("/api/playlist/remove", {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify({ playlist, index }),
    });
    return res.ok;
  } catch (err) {
    console.error("removeTrackFromPlaylist error:", err);
    return false;
  }
}

export async function movePlaylistTrack(playlist: string, fromIndex: number, toIndex: number): Promise<boolean> {
  try {
    const res = await fetch("/api/playlist/move", {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify({ playlist, from_index: fromIndex, to_index: toIndex }),
    });
    return res.ok;
  } catch (err) {
    console.error("movePlaylistTrack error:", err);
    return false;
  }
}

export async function reorderPlaylistTracks(playlist: string, sequence: (string | number)[]): Promise<boolean> {
  try {
    const res = await fetch("/api/playlist/reorder", {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify({ playlist, sequence }),
    });
    return res.ok;
  } catch (err) {
    console.error("reorderPlaylistTracks error:", err);
    return false;
  }
}

export async function searchMusic(query: string, count: number = 6, includeWeb: boolean = true): Promise<SearchResponse | null> {
  try {
    const res = await fetch(
      `/api/search?q=${encodeURIComponent(query)}&count=${count}&web=${includeWeb ? 1 : 0}`,
      {
        headers: getHeaders(),
        cache: "no-store",
      }
    );
    if (!res.ok) throw new Error(`Search request failed (${res.status})`);
    return await res.json();
  } catch (err) {
    console.error("searchMusic error:", err);
    throw err;
  }
}

export async function reorderPlaybackTracks(trackIds: string[]): Promise<boolean> {
  try {
    const res = await fetch("/api/playback/reorder", {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify({ track_ids: trackIds }),
    });
    return res.ok;
  } catch (err) {
    console.error("reorderPlaybackTracks error:", err);
    return false;
  }
}

export async function movePlaybackTrack(fromIndex: number, toIndex: number): Promise<boolean> {
  try {
    const res = await fetch("/api/playback/move", {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify({ from_index: fromIndex, to_index: toIndex }),
    });
    return res.ok;
  } catch (err) {
    console.error("movePlaybackTrack error:", err);
    return false;
  }
}

export async function postApiFallback(action: string, payload: Record<string, any> = {}): Promise<boolean> {
  let endpoint = `/api/${action}`;
  if (action === "playback_add" || action === "queue_add") endpoint = "/api/playback/add";
  else if (action === "playback_clear" || action === "queue_clear") endpoint = "/api/playback/clear";
  else if (action === "playback_play" || action === "queue_play" || action === "interrupt") endpoint = "/api/playback/play";
  else if (action === "playback_remove" || action === "queue_remove") endpoint = "/api/playback/remove";
  else if (action === "playback_move" || action === "queue_move") endpoint = "/api/playback/move";
  else if (action === "playback_reorder" || action === "queue_reorder") endpoint = "/api/playback/reorder";
  else if (action === "playback_mode" || action === "queue_mode") endpoint = "/api/playback/mode";
  else if (action === "playback_shuffle") endpoint = "/api/playback/shuffle";
  else if (action === "playback_reset_history") endpoint = "/api/playback/reset_history";
  else if (action === "dismiss_error" || action === "clear_error") endpoint = "/api/error/dismiss";

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify(payload),
    });
    return res.ok;
  } catch (err) {
    console.error(`postApiFallback for ${endpoint} error:`, err);
    return false;
  }
}

