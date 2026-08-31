"use client";

import { useState, useCallback } from "react";
import { useStreamStatus } from "@/hooks/useStreamStatus";
import { useAuth } from "@/hooks/useAuth";
import { TopProgressBar } from "@/components/TopProgressBar";
import { ConnectionBanner } from "@/components/ConnectionBanner";
import { Header } from "@/components/Header";
import { PlaybackErrorBanner } from "@/components/PlaybackErrorBanner";
import { UniversalSearchBar } from "@/components/UniversalSearchBar";
import { UniversalSearchModal } from "@/components/UniversalSearchModal";
import { NowPlayingHero } from "@/components/NowPlayingHero";
import { StatusGrid } from "@/components/StatusGrid";
import { StreamPlayer } from "@/components/StreamPlayer";
import { PlaybackList } from "@/components/PlaybackList";
import { PlaylistExplorer } from "@/components/PlaylistExplorer";
import { SaveToPlaylistModal } from "@/components/SaveToPlaylistModal";
import { SecurityOtpModal } from "@/components/SecurityOtpModal";

export default function Home() {
  const {
    status,
    connectionState,
    connectionMessage,
    volume,
    isLoading,
    togglePlayPause,
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
    sendCommand,
  } = useStreamStatus();

  const {
    isSecurityEnabled,
    isAuthenticated,
    isLockModalOpen,
    setIsLockModalOpen,
    authLoading,
    authError,
    submitCode,
    refreshAuth,
  } = useAuth();

  // Modals state
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearchModalOpen, setIsSearchModalOpen] = useState(false);

  const [saveModalTrack, setSaveModalTrack] = useState<{
    url: string;
    title: string;
    thumbnail?: string;
  } | null>(null);
  const [isSaveModalOpen, setIsSaveModalOpen] = useState(false);

  const handleOpenSearch = useCallback((q: string) => {
    setSearchQuery(q);
    setIsSearchModalOpen(true);
  }, []);

  const handleOpenSaveModal = useCallback((url: string, title: string = "", thumbnail?: string) => {
    setSaveModalTrack({ url, title: title || url, thumbnail });
    setIsSaveModalOpen(true);
  }, []);

  const handlePlayPlaylist = useCallback(
    (name: string, shuffle: boolean = false) => {
      sendCommand({ action: "playlist_play", playlist: name, shuffle });
    },
    [sendCommand]
  );

  const handleQueuePlaylist = useCallback(
    (name: string, shuffle: boolean = false) => {
      sendCommand({ action: "playlist_queue", playlist: name, shuffle });
    },
    [sendCommand]
  );

  const handlePlaySingleUrl = useCallback(
    (url: string, title: string = "") => {
      sendCommand({ action: "interrupt", url, title });
    },
    [sendCommand]
  );

  const playlists = status?.playlists || [];

  return (
    <div className="min-h-screen pb-16">
      {/* Top Global Loading Bar */}
      <TopProgressBar isLoading={isLoading} />

      <div className="max-w-5xl mx-auto px-4 sm:px-6 pt-6">
        {/* Connection Lost Banner */}
        <ConnectionBanner
          connectionState={connectionState}
          message={connectionMessage}
          onRetry={retryServerConnection}
        />

        {/* Top Header */}
        <Header
          isSecurityEnabled={isSecurityEnabled}
          isAuthenticated={isAuthenticated}
          onOpenLockModal={() => setIsLockModalOpen(true)}
          connectionState={connectionState}
          listenerCount={status?.clients_connected || 0}
        />

        {/* Universal Search Bar */}
        <UniversalSearchBar onSearch={handleOpenSearch} />

        {/* Playback Error Alert Banner */}
        <PlaybackErrorBanner
          error={status?.last_error}
          onRetry={retryCurrentTrack}
          onSkip={skipTrack}
          onDismiss={dismissPlaybackError}
        />

        {/* Now Playing Hero Card */}
        <NowPlayingHero
          status={status}
          volume={volume}
          onTogglePlayPause={togglePlayPause}
          onSkipTrack={skipTrack}
          onStopMusic={stopMusic}
          onToggleLoop={toggleLoop}
          onToggleMode={toggleMode}
          onVolumeChange={handleVolumeChange}
          onVolumeStep={handleVolumeStep}
          onToggleMute={toggleMute}
        />

        {/* Status Metrics Grid */}
        <StatusGrid status={status} />

        {/* Stream Audio Player Box */}
        <StreamPlayer />

        {/* Playback Tracklist */}
        <PlaybackList
          status={status}
          onTogglePlaybackMode={togglePlaybackMode}
          onResetHistory={resetPlaybackHistory}
          onClearList={clearPlaybackList}
          onPlayTrack={playTrackAtIndex}
          onRemoveTrack={removeTrackFromPlayback}
          onQuickAdd={addTrackToPlayback}
          onQuickInterrupt={interruptPlay}
          onSaveToPlaylist={handleOpenSaveModal}
        />

        {/* Playlists Explorer */}
        <PlaylistExplorer
          playlists={playlists}
          onPlayPlaylist={handlePlayPlaylist}
          onQueuePlaylist={handleQueuePlaylist}
          onPlaySingleUrl={handlePlaySingleUrl}
          onRefreshStatus={() => retryServerConnection()}
        />
      </div>

      {/* Universal Search Results Modal */}
      <UniversalSearchModal
        isOpen={isSearchModalOpen}
        query={searchQuery}
        onClose={() => setIsSearchModalOpen(false)}
        onPlayUrl={handlePlaySingleUrl}
        onQueueUrl={addTrackToPlayback}
        onSaveToPlaylist={handleOpenSaveModal}
      />

      {/* Save Track to Playlist Modal */}
      <SaveToPlaylistModal
        isOpen={isSaveModalOpen}
        trackData={saveModalTrack}
        playlists={playlists}
        onClose={() => {
          setIsSaveModalOpen(false);
          setSaveModalTrack(null);
        }}
        onRefreshPlaylists={() => retryServerConnection()}
      />

      {/* Security OTP Lock Screen Modal */}
      <SecurityOtpModal
        isOpen={isLockModalOpen}
        onClose={() => setIsLockModalOpen(false)}
        onSubmitOtp={submitCode}
        error={authError}
        loading={authLoading}
      />
    </div>
  );
}
