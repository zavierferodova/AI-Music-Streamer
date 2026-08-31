"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useToast } from "./useToast";
import { copyToClipboard } from "@/lib/utils";

export function useAudioStream() {
  const { showToast } = useToast();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isBuffering, setIsBuffering] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    const audio = new Audio();
    audio.preload = "none";
    audioRef.current = audio;

    const onWaiting = () => setIsBuffering(true);
    const onPlaying = () => {
      setIsBuffering(false);
      setIsPlaying(true);
    };
    const onPause = () => setIsPlaying(false);
    const onError = (e: any) => {
      console.error("[BrowserAudio] Stream playback error:", e);
      setIsBuffering(false);
      setIsPlaying(false);
      const msg = "Audio stream error occurred. Click to reconnect.";
      setErrorMessage(msg);
      showToast(msg, "error", "error_outline");
    };

    audio.addEventListener("waiting", onWaiting);
    audio.addEventListener("playing", onPlaying);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("error", onError);

    return () => {
      audio.removeEventListener("waiting", onWaiting);
      audio.removeEventListener("playing", onPlaying);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("error", onError);
      audio.pause();
      audio.src = "";
    };
  }, [showToast]);

  const toggleStreamAudio = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;

    setErrorMessage(null);

    if (audio.paused) {
      setIsBuffering(true);
      audio.src = `/stream.mp3?t=${Date.now()}`;
      audio
        .play()
        .then(() => {
          setIsBuffering(false);
          setIsPlaying(true);
          showToast("Playing live audio stream", "success", "play_arrow");
        })
        .catch((e) => {
          console.error("Audio playback error:", e);
          setIsBuffering(false);
          setIsPlaying(false);
          let msg = "Failed to start stream.";
          if (e.name === "NotAllowedError") {
            msg = "Autoplay prevented by browser. Click again to play.";
          } else if (e.name === "NotSupportedError") {
            msg = "MP3 stream format unsupported by this browser.";
          } else {
            msg = e.message || "Stream connection failed.";
          }
          setErrorMessage(msg);
          showToast(msg, "error", "error_outline");
        });
    } else {
      audio.pause();
      setIsPlaying(false);
      setIsBuffering(false);
      showToast("Paused live stream", "info", "pause");
    }
  }, [showToast]);

  const copyStreamUrl = useCallback(async () => {
    const fullUrl = window.location.origin + "/stream.mp3";
    const ok = await copyToClipboard(fullUrl);
    if (ok) {
      showToast("Copied stream link to clipboard!", "success", "check_circle");
    } else {
      window.prompt("Copy link:", fullUrl);
    }
  }, [showToast]);

  return {
    isPlaying,
    isBuffering,
    errorMessage,
    toggleStreamAudio,
    copyStreamUrl,
  };
}
