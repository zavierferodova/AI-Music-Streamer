"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useToast } from "./useToast";
import { copyToClipboard } from "@/lib/utils";
import { wsClient } from "@/lib/ws";

export function useAudioStream() {
  const { showToast } = useToast();
  const audioContextRef = useRef<AudioContext | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const nextPlayTimeRef = useRef<number>(0);
  const isPlayingRef = useRef<boolean>(false);

  const [isPlaying, setIsPlaying] = useState(false);
  const [isBuffering, setIsBuffering] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [localVolume, setLocalVolume] = useState<number>(100);
  const [isMuted, setIsMuted] = useState(false);
  const [latencyMs, setLatencyMs] = useState<number>(45);

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

  // Handle incoming raw PCM chunks over WebSocket (44.1kHz, 16-bit stereo, s16le)
  useEffect(() => {
    const unsub = wsClient.subscribeAudioChunk((arrayBuffer: ArrayBuffer) => {
      if (!isPlayingRef.current || !audioContextRef.current || !gainNodeRef.current) {
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
        // Smooth broadcast jitter buffer (200ms lead-in) preventing jitter, stutter, or overlapping loops
        const targetLead = 0.20;
        const maxLag = 2.0;

        if (nextPlayTimeRef.current < currentTime) {
          // Fresh start or buffer underrun -> start from current time + lead buffer
          nextPlayTimeRef.current = currentTime + targetLead;
        } else if (nextPlayTimeRef.current > currentTime + maxLag) {
          // Large drift (e.g. tab was frozen/backgrounded for seconds) -> resync cleanly
          nextPlayTimeRef.current = currentTime + targetLead;
        }

        const scheduledTime = nextPlayTimeRef.current;
        const source = ctx.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(gainNodeRef.current);
        source.start(scheduledTime);

        // Advance timeline by exact audio chunk duration (monotonically without overlap)
        nextPlayTimeRef.current += audioBuffer.duration;

        // Dynamic real-time latency status in ms
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

  // Update volume when state changes
  useEffect(() => {
    if (gainNodeRef.current && audioContextRef.current) {
      const targetGain = isMuted ? 0 : localVolume / 100;
      gainNodeRef.current.gain.setTargetAtTime(targetGain, audioContextRef.current.currentTime, 0.01);
    }
  }, [localVolume, isMuted]);

  // Clean up AudioContext on unmount
  useEffect(() => {
    return () => {
      isPlayingRef.current = false;
      nextPlayTimeRef.current = 0;
      wsClient.unsubscribeAudioStream();
      if (audioContextRef.current && audioContextRef.current.state !== "closed") {
        audioContextRef.current.close().catch(() => {});
      }
    };
  }, []);

  const toggleStreamAudio = useCallback(async () => {
    setErrorMessage(null);

    if (!isPlaying) {
      setIsBuffering(true);
      try {
        const { ctx } = getOrCreateAudioContext();
        if (ctx.state === "suspended") {
          await ctx.resume();
        }

        nextPlayTimeRef.current = ctx.currentTime + 0.20;
        isPlayingRef.current = true;
        setIsPlaying(true);
        setIsBuffering(false);

        // Subscribe to binary audio chunks over WebSocket
        wsClient.subscribeAudioStream();
        showToast("Connected to live audio broadcast", "success", "bolt");
      } catch (e: any) {
        console.error("[WebAudio] Failed to start Web Audio playback:", e);
        setIsBuffering(false);
        isPlayingRef.current = false;
        setIsPlaying(false);
        let msg = "Failed to start Web Audio stream.";
        if (e?.name === "NotAllowedError") {
          msg = "Autoplay prevented by browser. Click again to play.";
        } else {
          msg = e?.message || "AudioContext initialization failed.";
        }
        setErrorMessage(msg);
        showToast(msg, "error", "error_outline");
      }
    } else {
      isPlayingRef.current = false;
      setIsPlaying(false);
      setIsBuffering(false);
      wsClient.unsubscribeAudioStream();
      showToast("Paused live stream", "info", "pause");
    }
  }, [isPlaying, getOrCreateAudioContext, showToast]);

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
    setBrowserVolume,
    toggleBrowserMute,
    toggleStreamAudio,
    copyStreamUrl,
  };
}
