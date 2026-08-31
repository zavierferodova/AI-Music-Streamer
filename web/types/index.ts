export type PlaybackState = "playing" | "paused" | "stopped";
export type BroadcastMode = "silent" | "speaker";
export type LoopMode = "repeat" | "repeat-one" | "off" | "yes" | "no";
export type PlaylistOrderMode = "ordered" | "shuffled";

export interface NowPlaying {
  url: string | null;
  title: string | null;
  thumbnail: string | null;
  elapsed_seconds?: number;
}

export interface PlaybackError {
  title?: string;
  message: string;
  timestamp?: number;
}

export interface Track {
  id?: number | string;
  url: string;
  title: string;
  thumbnail?: string | null;
  status?: "playing" | "played" | "queued";
  position?: number;
  created_at?: number;
  updated_at?: number;
}

export interface PlaybackSummary {
  mode: PlaylistOrderMode;
  total_count: number;
  played_count: number;
  playing_count: number;
  queued_count: number;
  tracks: Track[];
  queued_tracks: Track[];
  played_tracks: Track[];
  next: Track | null;
}

export interface Playlist {
  id?: number | string;
  name: string;
  track_count?: number;
  created_at?: number;
  updated_at?: number;
  tracks?: Track[];
}

export interface SearchResultLocal {
  url: string;
  title: string;
  thumbnail?: string | null;
  playlist_name?: string;
  source_label?: string;
  match_score?: number;
  is_exact_match?: boolean;
}

export interface SearchResultWeb {
  id?: string;
  title: string;
  url: string;
  thumbnail?: string | null;
}

export interface SearchResponse {
  status?: string;
  query: string;
  count: number;
  local_count?: number;
  local_results?: SearchResultLocal[];
  web_count?: number;
  web_results?: SearchResultWeb[];
  provider?: string;
}

export interface SecurityStatus {
  enabled: boolean;
}

export interface ServerStatus {
  server: string;
  state: PlaybackState;
  mode: BroadcastMode;
  volume: number;
  security: SecurityStatus;
  now_playing: NowPlaying;
  loop: LoopMode;
  last_error?: PlaybackError | null;
  is_buffering?: boolean;
  playback: PlaybackSummary;
  queue: {
    count: number;
    mode: PlaylistOrderMode;
    tracks: Track[];
  };
  playlists: Playlist[];
  next: Track | null;
  clients_connected: number;
  stream_url: string;
  uptime_seconds?: number;
}

export interface AuthStatusResponse {
  status: string;
  security_enabled: boolean;
  authenticated: boolean;
}

export interface AuthVerifyResponse {
  status: string;
  authenticated: boolean;
  token?: string;
  message?: string;
}

export type ToastType = "info" | "success" | "warning" | "error";

export interface ToastMessage {
  id: string;
  message: string;
  type: ToastType;
  icon?: string;
}
