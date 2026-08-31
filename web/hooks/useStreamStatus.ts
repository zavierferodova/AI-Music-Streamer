"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { ServerStatus, LoopMode, BroadcastMode, PlaylistOrderMode } from "@/types";
import { wsClient, ConnectionState } from "@/lib/ws";
import { fetchServerStatus } from "@/lib/api";
import { useToast } from "./useToast";

export function useStreamStatus() {
  const { showToast } = useToast();
  const [status, setStatus] = useState<ServerStatus | null>(null);
  const [connectionState, setConnectionState] = useState<ConnectionState>("connecting");
  const [connectionMessage, setConnectionMessage] = useState<string>("Connecting to Stream Server...");
  const [volume, setVolume] = useState<number>(80);
  const [previousVolume, setPreviousVolume] = useState<number>(80);
  const [globalLoadingCount, setGlobalLoadingCount] = useState<number>(0);
  const lastErrorTimestampRef = useRef<number | null>(null);
  const volumeDebounceTimerRef = useRef<any>(null);

  const startLoading = useCallback(() => {
    setGlobalLoadingCount((c) => c + 1);
  }, []);

  const stopLoading = useCallback(() => {
    setGlobalLoadingCount((c) => Math.max(0, c - 1));
  }, []);

  useEffect(() => {
    wsClient.connect();

    const unsubStatus = wsClient.subscribeStatus((newStatus) => {
      setStatus(newStatus);
      if (newStatus.volume !== undefined && typeof newStatus.volume === "number") {
        setVolume(newStatus.volume);
      }

      // Check for playback error
      if (newStatus.last_error && newStatus.last_error.message) {
        const errTime = newStatus.last_error.timestamp || Date.now();
        if (errTime !== lastErrorTimestampRef.current) {
          lastErrorTimestampRef.current = errTime;
          showToast(`Playback error: ${newStatus.last_error.message}`, "error", "error_outline");
        }
      }
    });

    const unsubConn = wsClient.subscribeConnection((state, msg) => {
      setConnectionState(state);
      if (msg) setConnectionMessage(msg);
    });

    // Fallback polling if WS is disconnected
    const pollInterval = setInterval(() => {
      if (wsClient.getConnectionState() !== "connected") {
        fetchServerStatus().then((res) => {
          if (res) {
            setStatus(res);
            if (typeof res.volume === "number") setVolume(res.volume);
          }
        });
      }
    }, 2500);

    return () => {
      unsubStatus();
      unsubConn();
      clearInterval(pollInterval);
      wsClient.disconnect();
    };
  }, [showToast]);

  const sendCommand = useCallback((payload: Record<string, any>) => {
    wsClient.sendCommand(payload);
  }, []);

  const togglePlayPause = useCallback(() => {
    if (!status) return;
    if (status.state === "playing") {
      sendCommand({ action: "pause" });
      showToast("Paused playback", "info", "pause");
    } else if (status.state === "paused") {
      sendCommand({ action: "resume" });
      showToast("Resumed playback", "success", "play_arrow");
    } else {
      sendCommand({ action: "play" });
      showToast("Started playback", "success", "play_arrow");
    }
  }, [status, sendCommand, showToast]);

  const playPreviousTrack = useCallback(() => {
    sendCommand({ action: "prev" });
    showToast("Playing previous track...", "info", "skip_previous");
  }, [sendCommand, showToast]);

  const skipTrack = useCallback(() => {
    sendCommand({ action: "skip" });
    showToast("Skipping to next track...", "info", "skip_next");
  }, [sendCommand, showToast]);

  const stopMusic = useCallback(() => {
    sendCommand({ action: "stop" });
    showToast("Stopped playback (streaming silence)", "info", "stop");
  }, [sendCommand, showToast]);

  const toggleLoop = useCallback(() => {
    if (!status) return;
    const cur = (status.loop || "repeat").toLowerCase();
    let nextLoop: LoopMode = "repeat";
    if (cur === "repeat" || cur === "yes" || cur === "all") {
      nextLoop = "repeat-one";
    } else if (cur === "repeat-one" || cur === "one" || cur === "single") {
      nextLoop = "off";
    } else {
      nextLoop = "repeat";
    }

    sendCommand({ action: "loop", loop: nextLoop });
    if (nextLoop === "repeat") {
      showToast("Loop: REPEAT (Loops entire tracklist from first)", "info", "repeat");
    } else if (nextLoop === "repeat-one") {
      showToast("Loop: REPEAT-ONE (Repeats current song continuously)", "info", "repeat_one");
    } else {
      showToast("Loop: OFF (Plays once then stops)", "info", "arrow_forward");
    }
  }, [status, sendCommand, showToast]);

  const toggleMode = useCallback(() => {
    if (!status) return;
    if (status.mode === "silent") {
      if (
        window.confirm(
          "Switch to Speaker Sync Mode?\n\nThis will unmute the server speaker and output audio out loud in sync with the live stream."
        )
      ) {
        sendCommand({ action: "mode", mode: "speaker" });
        showToast("Switched to Speaker Sync Mode", "success", "volume_up");
      }
    } else {
      sendCommand({ action: "mode", mode: "silent" });
      showToast("Switched to Silent Broadcast Mode (Speaker Muted)", "info", "volume_off");
    }
  }, [status, sendCommand, showToast]);

  const togglePlaybackMode = useCallback(() => {
    if (!status) return;
    const currentMode = status.playback?.mode || status.queue?.mode || "ordered";
    const nextMode: PlaylistOrderMode = currentMode === "shuffled" ? "ordered" : "shuffled";
    sendCommand({ action: "playback_mode", mode: nextMode });
    showToast(
      nextMode === "shuffled" ? "Unplayed tracks shuffled!" : "Playback set to sequential order",
      "info",
      nextMode === "shuffled" ? "shuffle" : "format_list_numbered"
    );
  }, [status, sendCommand, showToast]);

  const resetPlaybackHistory = useCallback(() => {
    sendCommand({ action: "playback_reset_history" });
    showToast("Reset all tracks for a fresh replay cycle!", "success", "restart_alt");
  }, [sendCommand, showToast]);

  const clearPlaybackList = useCallback(() => {
    if (window.confirm("Clear the entire upcoming playback list?")) {
      sendCommand({ action: "playback_clear" });
      showToast("Cleared playback list", "info", "delete_sweep");
    }
  }, [sendCommand, showToast]);

  const addTrackToPlayback = useCallback(
    (url: string, title: string = "") => {
      const cleanUrl = url.trim();
      const existingTracks = status?.playback?.tracks || status?.queue?.tracks || [];
      const existing = existingTracks.find(
        (t) =>
          t.url?.trim().toLowerCase() === cleanUrl.toLowerCase() ||
          (t.title && cleanUrl && t.title.toLowerCase() === cleanUrl.toLowerCase())
      );

      sendCommand({ action: "playback_add", url: cleanUrl, title });
      if (existing) {
        showToast(
          `Track "${existing.title || title || cleanUrl}" already exists in playback list`,
          "warning"
        );
      } else {
        showToast("Added track to playback list", "success", "playlist_add");
      }
    },
    [status, sendCommand, showToast]
  );

  const interruptPlay = useCallback(
    (url: string, title: string = "") => {
      sendCommand({ action: "interrupt", url, title });
      showToast("Loading track for instant playback...", "success", "bolt");
    },
    [sendCommand, showToast]
  );

  const playTrackAtIndex = useCallback(
    (index: number) => {
      sendCommand({ action: "playback_play", index });
      showToast("Loading track...", "info", "play_arrow");
    },
    [sendCommand, showToast]
  );

  const removeTrackFromPlayback = useCallback(
    (index: number) => {
      sendCommand({ action: "playback_remove", index });
      showToast("Removed track from list", "info", "close");
    },
    [sendCommand, showToast]
  );

  const dismissPlaybackError = useCallback(() => {
    sendCommand({ action: "dismiss_error" });
  }, [sendCommand]);

  const retryCurrentTrack = useCallback(() => {
    if (status?.now_playing?.url) {
      sendCommand({ action: "interrupt", url: status.now_playing.url });
      showToast("Retrying playback...", "info", "refresh");
    } else {
      skipTrack();
    }
  }, [status, sendCommand, showToast, skipTrack]);

  const handleVolumeChange = useCallback(
    (newVol: number) => {
      const clamped = Math.max(0, Math.min(100, newVol));
      setVolume(clamped);
      if (volumeDebounceTimerRef.current) {
        clearTimeout(volumeDebounceTimerRef.current);
      }
      volumeDebounceTimerRef.current = setTimeout(() => {
        sendCommand({ action: "volume", volume: clamped });
      }, 50);
    },
    [sendCommand]
  );

  const handleVolumeStep = useCallback(
    (delta: number) => {
      const clamped = Math.max(0, Math.min(100, volume + delta));
      setVolume(clamped);
      sendCommand({ action: "volume", volume: clamped });
      showToast(`Server volume: ${clamped}%`, "info", clamped === 0 ? "volume_off" : "volume_up");
    },
    [volume, sendCommand, showToast]
  );

  const toggleMute = useCallback(() => {
    if (volume > 0) {
      setPreviousVolume(volume);
      setVolume(0);
      sendCommand({ action: "volume", volume: 0 });
      showToast("Server speaker muted", "info", "volume_off");
    } else {
      const restore = previousVolume > 0 ? previousVolume : 80;
      setVolume(restore);
      sendCommand({ action: "volume", volume: restore });
      showToast(`Server speaker unmuted (${restore}%)`, "info", "volume_up");
    }
  }, [volume, previousVolume, sendCommand, showToast]);

  const retryServerConnection = useCallback(() => {
    wsClient.connect();
    fetchServerStatus().then((res) => {
      if (res) setStatus(res);
    });
  }, []);

  return {
    status,
    connectionState,
    connectionMessage,
    volume,
    isLoading: globalLoadingCount > 0,
    startLoading,
    stopLoading,
    sendCommand,
    togglePlayPause,
    playPreviousTrack,
    skipTrack,
    stopMusic,
    toggleLoop,
    toggleMode,
    togglePlaybackMode,
    resetPlaybackHistory,
    clearPlaybackList,
    addTrackToPlayback,
    interruptPlay,
    playTrackAtIndex,
    removeTrackFromPlayback,
    dismissPlaybackError,
    retryCurrentTrack,
    handleVolumeChange,
    handleVolumeStep,
    toggleMute,
    retryServerConnection,
  };
}
