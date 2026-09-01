"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useToast } from "./useToast";
import { copyToClipboard } from "@/lib/utils";
import { wsClient } from "@/lib/ws";

export type StreamEngineMode = "webaudio" | "direct_mp3";

export interface AudioStreamOptions {
  nowPlaying?: {
    title?: string | null;
    artist?: string | null;
    thumbnail?: string | null;
    url?: string | null;
  } | null;
  playbackState?: string;
  isAdmin?: boolean;
  onTogglePlayPause?: () => void;
  onPlayPrevious?: () => void;
  onSkipTrack?: () => void;
  onSeekRelative?: (seconds: number) => void;
}

// 1-second 44.1kHz stereo silent WAV data URI to keep mobile OS audio sessions awake in the background
const SILENT_AUDIO_URI =
  "data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA";

export function useAudioStream(options?: AudioStreamOptions) {
  const { showToast } = useToast();
  const audioContextRef = useRef<AudioContext | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const nextPlayTimeRef = useRef<number>(0);
  const isPlayingRef = useRef<boolean>(false);
  const engineModeRef = useRef<StreamEngineMode>("webaudio");

  const keepaliveAudioRef = useRef<HTMLAudioElement | null>(null);
  const directMp3AudioRef = useRef<HTMLAudioElement | null>(null);

  const [engineMode, setEngineModeState] = useState<StreamEngineMode>("webaudio");
  const [isPlaying, setIsPlaying] = useState(false);
  const [isBuffering, setIsBuffering] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [localVolume, setLocalVolume] = useState<number>(100);
  const [isMuted, setIsMuted] = useState(false);
  const [latencyMs, setLatencyMs] = useState<number>(45);
  const [isBackgroundSupported, setIsBackgroundSupported] = useState(true);

  const optionsRef = useRef(options);
  optionsRef.current = options;

  // Initialize or get the AudioContext singleton
  const getOrCreateAudioContext = useCallback(() => {
    if (!audioContextRef.current || audioContextRef.current.state === "closed") {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      const ctx = new AudioCtx({ sampleRate: 44100 });
      const gain = ctx.createGain();
      gain.gain.value = localVolume / 100;
      gain.connect(ctx.destination);

      audioContextRef.current = ctx;
      gainNodeRef.current = gain;
    }
    return { ctx: audioContextRef.current, gain: gainNodeRef.current };
  }, [localVolume]);

  // Keepalive silent audio anchor for background playback on mobile / background tabs
  const startBackgroundKeepalive = useCallback(() => {
    try {
      if (!keepaliveAudioRef.current) {
        const audio = new Audio();
        audio.src = SILENT_AUDIO_URI;
        audio.loop = true;
        audio.preload = "auto";
        (audio as any).playsInline = true;
        (audio as any).webkitPlaysInline = true;
        keepaliveAudioRef.current = audio;
      }
      keepaliveAudioRef.current.play().catch(() => {});
    } catch (e) {
      console.warn("[BackgroundAudio] Could not start keepalive audio:", e);
    }
  }, []);

  const stopBackgroundKeepalive = useCallback(() => {
    if (keepaliveAudioRef.current) {
      try {
        keepaliveAudioRef.current.pause();
      } catch (e) {}
    }
  }, []);

  // Update MediaSession metadata and role-based action handlers for background & lockscreen playback
  useEffect(() => {
    if (typeof window === "undefined" || !("mediaSession" in navigator)) return;

    const title = options?.nowPlaying?.title || "Music Streamer Live Broadcast";
    const artist = options?.nowPlaying?.artist || "Live Audio Stream";
    const thumbnail = options?.nowPlaying?.thumbnail;
    const isAdmin = Boolean(options?.isAdmin);

    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title,
        artist,
        album: "AI Music Streamer",
        artwork: thumbnail
          ? [
              { src: thumbnail, sizes: "512x512", type: "image/jpeg" },
              { src: thumbnail, sizes: "256x256", type: "image/jpeg" },
              { src: thumbnail, sizes: "128x128", type: "image/jpeg" },
            ]
          : [{ src: "/favicon.ico", sizes: "64x64", type: "image/x-icon" }],
      });

      navigator.mediaSession.playbackState = isPlaying ? "playing" : "paused";

      // Register system lockscreen / notification center action handlers
      navigator.mediaSession.setActionHandler("play", () => {
        if (isAdmin && optionsRef.current?.onTogglePlayPause) {
          optionsRef.current.onTogglePlayPause();
        } else {
          // Subscriber: strictly control local browser stream playback
          if (!isPlayingRef.current) {
            toggleStreamAudio();
          }
        }
      });

      navigator.mediaSession.setActionHandler("pause", () => {
        if (isAdmin && optionsRef.current?.onTogglePlayPause) {
          optionsRef.current.onTogglePlayPause();
        } else {
          // Subscriber: strictly control local browser stream playback
          if (isPlayingRef.current) {
            toggleStreamAudio();
          }
        }
      });

      navigator.mediaSession.setActionHandler("stop", () => {
        if (isPlayingRef.current) {
          toggleStreamAudio();
        }
      });

      if (isAdmin) {
        // Admin: enable full background lockscreen controls for track skipping and seeking
        navigator.mediaSession.setActionHandler("previoustrack", () => {
          if (optionsRef.current?.onPlayPrevious) {
            optionsRef.current.onPlayPrevious();
          }
        });
        navigator.mediaSession.setActionHandler("nexttrack", () => {
          if (optionsRef.current?.onSkipTrack) {
            optionsRef.current.onSkipTrack();
          }
        });
        navigator.mediaSession.setActionHandler("seekbackward", (details) => {
          const step = details.seekOffset || 10;
          if (optionsRef.current?.onSeekRelative) {
            optionsRef.current.onSeekRelative(-step);
          }
        });
        navigator.mediaSession.setActionHandler("seekforward", (details) => {
          const step = details.seekOffset || 10;
          if (optionsRef.current?.onSeekRelative) {
            optionsRef.current.onSeekRelative(step);
          }
        });
      } else {
        // Subscriber: strictly read-only listening from background (disable all track skip and seek handlers)
        try {
          navigator.mediaSession.setActionHandler("previoustrack", null);
          navigator.mediaSession.setActionHandler("nexttrack", null);
          navigator.mediaSession.setActionHandler("seekbackward", null);
          navigator.mediaSession.setActionHandler("seekforward", null);
        } catch (e) {}
      }
    } catch (e) {
      console.warn("[MediaSession] Error setting metadata or action handlers:", e);
    }
  }, [options?.nowPlaying?.title, options?.nowPlaying?.thumbnail, options?.isAdmin, isPlaying]);

  // Handle incoming raw PCM chunks over WebSocket (44.1kHz, 16-bit stereo, s16le)
  useEffect(() => {
    const unsub = wsClient.subscribeAudioChunk((arrayBuffer: ArrayBuffer) => {
      if (
        !isPlayingRef.current ||
        engineModeRef.current !== "webaudio" ||
        !audioContextRef.current ||
        !gainNodeRef.current
      ) {
        return;
      }

      const ctx = audioContextRef.current;
      if (ctx.state === "suspended") {
        ctx.resume().catch(() => {});
      }

      try {
        const int16 = new Int16Array(arrayBuffer);
        const numFrames = int16.length / 2;
        if (numFrames === 0) return;

        // Convert interleaved s16le PCM to planar Float32Array [-1.0, 1.0]
        const left = new Float32Array(numFrames);
        const right = new Float32Array(numFrames);

        for (let i = 0; i < numFrames; i++) {
          left[i] = int16[i * 2] / 32768.0;
          right[i] = int16[i * 2 + 1] / 32768.0;
        }

        const audioBuffer = ctx.createBuffer(2, numFrames, 44100);
        audioBuffer.copyToChannel(left, 0);
        audioBuffer.copyToChannel(right, 1);

        const currentTime = ctx.currentTime;
        const targetLead = 0.20;
        const maxLag = 2.0;

        if (nextPlayTimeRef.current < currentTime) {
          nextPlayTimeRef.current = currentTime + targetLead;
        } else if (nextPlayTimeRef.current > currentTime + maxLag) {
          nextPlayTimeRef.current = currentTime + targetLead;
        }

        const scheduledTime = nextPlayTimeRef.current;
        const source = ctx.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(gainNodeRef.current);
        source.start(scheduledTime);

        nextPlayTimeRef.current += audioBuffer.duration;

        const currentLatency = Math.max(0, Math.round((scheduledTime - currentTime) * 1000));
        setLatencyMs(currentLatency);
      } catch (err) {
        console.error("[WebAudio] Error decoding/scheduling PCM chunk:", err);
      }
    });

    return () => {
      unsub();
    };
  }, []);

  // Handle visibility change to resume AudioContext cleanly on returning to tab
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible" && isPlayingRef.current) {
        if (audioContextRef.current && audioContextRef.current.state === "suspended") {
          audioContextRef.current.resume().catch(() => {});
        }
        if (audioContextRef.current) {
          nextPlayTimeRef.current = audioContextRef.current.currentTime + 0.20;
        }
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  // Update volume when state changes
  useEffect(() => {
    const targetGain = isMuted ? 0 : localVolume / 100;
    if (gainNodeRef.current && audioContextRef.current) {
      gainNodeRef.current.gain.setTargetAtTime(targetGain, audioContextRef.current.currentTime, 0.01);
    }
    if (directMp3AudioRef.current) {
      directMp3AudioRef.current.volume = targetGain;
    }
  }, [localVolume, isMuted]);

  // Clean up AudioContext & audio elements on unmount
  useEffect(() => {
    return () => {
      isPlayingRef.current = false;
      nextPlayTimeRef.current = 0;
      wsClient.unsubscribeAudioStream();
      stopBackgroundKeepalive();
      if (directMp3AudioRef.current) {
        directMp3AudioRef.current.pause();
        directMp3AudioRef.current.src = "";
      }
      if (audioContextRef.current && audioContextRef.current.state !== "closed") {
        audioContextRef.current.close().catch(() => {});
      }
    };
  }, [stopBackgroundKeepalive]);

  const toggleStreamAudio = useCallback(async () => {
    setErrorMessage(null);

    if (!isPlaying) {
      setIsBuffering(true);
      try {
        if (engineModeRef.current === "direct_mp3") {
          // Native HTML5 Direct MP3 Stream with built-in background playback
          if (!directMp3AudioRef.current) {
            const audio = new Audio();
            audio.preload = "none";
            (audio as any).playsInline = true;
            (audio as any).webkitPlaysInline = true;
            directMp3AudioRef.current = audio;
          }
          const streamUrl = window.location.origin + "/stream.mp3?t=" + Date.now();
          directMp3AudioRef.current.src = streamUrl;
          directMp3AudioRef.current.volume = isMuted ? 0 : localVolume / 100;
          await directMp3AudioRef.current.play();

          startBackgroundKeepalive();
          isPlayingRef.current = true;
          setIsPlaying(true);
          setIsBuffering(false);
          setLatencyMs(180);
          showToast("Connected to live MP3 stream (Background Active)", "success", "headphones");
        } else {
          // Web Audio API raw PCM WebSocket stream with background keepalive anchor
          const { ctx } = getOrCreateAudioContext();
          if (ctx.state === "suspended") {
            await ctx.resume();
          }

          nextPlayTimeRef.current = ctx.currentTime + 0.20;
          startBackgroundKeepalive();

          isPlayingRef.current = true;
          setIsPlaying(true);
          setIsBuffering(false);

          wsClient.subscribeAudioStream();
          showToast("Connected to live audio stream (Background Active)", "success", "bolt");
        }
      } catch (e: any) {
        console.error("[AudioStream] Failed to start audio playback:", e);
        setIsBuffering(false);
        isPlayingRef.current = false;
        setIsPlaying(false);
        stopBackgroundKeepalive();
        let msg = "Failed to start live audio stream.";
        if (e?.name === "NotAllowedError") {
          msg = "Autoplay prevented by browser. Click again to play.";
        } else {
          msg = e?.message || "Audio initialization failed.";
        }
        setErrorMessage(msg);
        showToast(msg, "error", "error_outline");
      }
    } else {
      isPlayingRef.current = false;
      setIsPlaying(false);
      setIsBuffering(false);
      wsClient.unsubscribeAudioStream();
      stopBackgroundKeepalive();

      if (directMp3AudioRef.current) {
        directMp3AudioRef.current.pause();
        directMp3AudioRef.current.src = "";
      }
      showToast("Paused live stream", "info", "pause");
    }
  }, [isPlaying, isMuted, localVolume, getOrCreateAudioContext, startBackgroundKeepalive, stopBackgroundKeepalive, showToast]);

  const setEngineMode = useCallback(
    async (mode: StreamEngineMode) => {
      if (mode === engineModeRef.current) return;
      engineModeRef.current = mode;
      setEngineModeState(mode);

      // If currently playing, restart smoothly with the new engine
      if (isPlayingRef.current) {
        if (mode === "direct_mp3") {
          wsClient.unsubscribeAudioStream();
          if (audioContextRef.current && audioContextRef.current.state !== "closed") {
            audioContextRef.current.suspend().catch(() => {});
          }
          if (!directMp3AudioRef.current) {
            const audio = new Audio();
            (audio as any).playsInline = true;
            (audio as any).webkitPlaysInline = true;
            directMp3AudioRef.current = audio;
          }
          directMp3AudioRef.current.src = window.location.origin + "/stream.mp3?t=" + Date.now();
          directMp3AudioRef.current.volume = isMuted ? 0 : localVolume / 100;
          await directMp3AudioRef.current.play().catch(() => {});
          setLatencyMs(180);
          showToast("Switched to Direct MP3 background stream", "info", "headphones");
        } else {
          if (directMp3AudioRef.current) {
            directMp3AudioRef.current.pause();
            directMp3AudioRef.current.src = "";
          }
          const { ctx } = getOrCreateAudioContext();
          if (ctx.state === "suspended") {
            await ctx.resume().catch(() => {});
          }
          nextPlayTimeRef.current = ctx.currentTime + 0.20;
          wsClient.subscribeAudioStream();
          showToast("Switched to Ultra-Low Latency Web Audio stream", "info", "bolt");
        }
      }
    },
    [isMuted, localVolume, getOrCreateAudioContext, showToast]
  );

  const setBrowserVolume = useCallback((val: number) => {
    const clamped = Math.max(0, Math.min(100, val));
    setLocalVolume(clamped);
    if (clamped > 0 && isMuted) {
      setIsMuted(false);
    }
  }, [isMuted]);

  const toggleBrowserMute = useCallback(() => {
    setIsMuted((prev) => !prev);
  }, []);

  const copyStreamUrl = useCallback(async () => {
    const fullUrl = window.location.origin + "/stream.mp3";
    const ok = await copyToClipboard(fullUrl);
    if (ok) {
      showToast("Copied MP3 direct stream link to clipboard!", "success", "check_circle");
    } else {
      window.prompt("Copy link:", fullUrl);
    }
  }, [showToast]);

  return {
    isPlaying,
    isBuffering,
    errorMessage,
    latencyMs,
    localVolume,
    isMuted,
    engineMode,
    isBackgroundSupported,
    setEngineMode,
    setBrowserVolume,
    toggleBrowserMute,
    toggleStreamAudio,
    copyStreamUrl,
  };
}
