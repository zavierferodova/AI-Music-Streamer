"use client";

import { useState, useCallback } from "react";
import { useStreamStatus } from "@/hooks/useStreamStatus";
import { useAuth } from "@/hooks/useAuth";
import type { StreamEngineMode } from "@/hooks/useAudioStream";
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
import { ConfirmationModal } from "@/components/ConfirmationModal";

export default function Home() {
  // Lift engine mode state to page level for metadata delay coordination
  const [engineMode, setEngineMode] = useState<StreamEngineMode>("webaudio");

  const {
    status,
    connectionState,
    connectionMessage,
    volume,
    isLoading,
    togglePlayPause,
    playPreviousTrack,
    skipTrack,
    stopMusic,
    toggleLoop,
    toggleMode,
    isSpeakerConfirmOpen,
    setIsSpeakerConfirmOpen,
    confirmSpeakerMode,
    togglePlaybackMode,
    resetPlaybackHistory,
    clearPlaybackList,
    addTrackToPlayback,
    interruptPlay,
    playTrackAtIndex,
    removeTrackFromPlayback,
    movePlaybackTrack,
    reorderPlaybackTracks,
    dismissPlaybackError,
    retryCurrentTrack,
    handleVolumeChange,
    handleVolumeStep,
    toggleMute,
    seekTo,
    seekRelative,
    retryServerConnection,
    refreshStatus,
    sendCommand,
  } = useStreamStatus(engineMode);

  const {
    isSecurityEnabled,
    isAuthenticated,
    role,
    isAdmin,
    isSubscriber,
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

  const handleOpenSearch = useCallback(
    (q: string) => {
      if (!isAdmin) return;
      setSearchQuery(q);
      setIsSearchModalOpen(true);
    },
    [isAdmin]
  );

  const handleOpenSaveModal = useCallback(
    (url: string, title: string = "", thumbnail?: string) => {
      if (!isAdmin) return;
      setSaveModalTrack({ url, title: title || url, thumbnail });
      setIsSaveModalOpen(true);
    },
    [isAdmin]
  );

  const handlePlayPlaylist = useCallback(
    (name: string, shuffle: boolean = false) => {
      if (!isAdmin) return;
      sendCommand({ action: "playlist_play", playlist: name, shuffle });
    },
    [isAdmin, sendCommand]
  );

  const handleQueuePlaylist = useCallback(
    (name: string, shuffle: boolean = false) => {
      if (!isAdmin) return;
      sendCommand({ action: "playlist_queue", playlist: name, shuffle });
    },
    [isAdmin, sendCommand]
  );

  const handlePlaySingleUrl = useCallback(
    (url: string, title: string = "") => {
      if (!isAdmin) return;
      sendCommand({ action: "interrupt", url, title });
    },
    [isAdmin, sendCommand]
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
          role={role}
          onOpenLockModal={() => setIsLockModalOpen(true)}
          connectionState={connectionState}
          listenerCount={status?.clients_connected || 0}
        />

        {/* Universal Search Bar (Admin only) */}
        {isAdmin && <UniversalSearchBar onSearch={handleOpenSearch} />}

        {/* Playback Error Alert Banner (Admin only) */}
        {isAdmin && (
          <PlaybackErrorBanner
            error={status?.last_error}
            onRetry={retryCurrentTrack}
            onSkip={skipTrack}
            onDismiss={dismissPlaybackError}
          />
        )}

        {/* Now Playing Hero Card */}
        <NowPlayingHero
          status={status}
          volume={volume}
          isAdmin={isAdmin}
          onTogglePlayPause={togglePlayPause}
          onPlayPrevious={playPreviousTrack}
          onSkipTrack={skipTrack}
          onStopMusic={stopMusic}
          onToggleLoop={toggleLoop}
          onToggleMode={toggleMode}
          onVolumeChange={handleVolumeChange}
          onVolumeStep={handleVolumeStep}
          onToggleMute={toggleMute}
          onSeekTo={seekTo}
          onSeekRelative={seekRelative}
        />

        {/* Status Metrics Grid */}
        <StatusGrid status={status} isAdmin={isAdmin} />

        {/* Stream Audio Player Box (with Background Playback & Lockscreen Support) */}
        <StreamPlayer
          status={status}
          isAdmin={isAdmin}
          engineMode={engineMode}
          setEngineMode={setEngineMode}
          onTogglePlayPause={togglePlayPause}
          onPlayPrevious={playPreviousTrack}
          onSkipTrack={skipTrack}
          onSeekRelative={seekRelative}
        />

        {/* Playback Tracklist */}
        <PlaybackList
          status={status}
          isAdmin={isAdmin}
          onTogglePlaybackMode={togglePlaybackMode}
          onResetHistory={resetPlaybackHistory}
          onClearList={clearPlaybackList}
          onPlayTrack={playTrackAtIndex}
          onRemoveTrack={removeTrackFromPlayback}
          onMoveTrack={movePlaybackTrack}
          onReorderTracks={reorderPlaybackTracks}
          onQuickAdd={addTrackToPlayback}
          onQuickInterrupt={interruptPlay}
          onSaveToPlaylist={handleOpenSaveModal}
        />

        {/* Playlists Explorer (Admin only - subscriber cannot view playlists) */}
        {isAdmin && (
          <PlaylistExplorer
            playlists={playlists}
            onPlayPlaylist={handlePlayPlaylist}
            onQueuePlaylist={handleQueuePlaylist}
            onPlaySingleUrl={handlePlaySingleUrl}
            onRefreshStatus={refreshStatus}
          />
        )}
      </div>

      {/* Universal Search Results Modal (Admin only) */}
      {isAdmin && (
        <UniversalSearchModal
          isOpen={isSearchModalOpen}
          query={searchQuery}
          isAdmin={isAdmin}
          onClose={() => setIsSearchModalOpen(false)}
          onPlayUrl={handlePlaySingleUrl}
          onQueueUrl={addTrackToPlayback}
          onSaveToPlaylist={handleOpenSaveModal}
        />
      )}

      {/* Save Track to Playlist Modal (Admin only) */}
      {isAdmin && (
        <SaveToPlaylistModal
          isOpen={isSaveModalOpen}
          trackData={saveModalTrack}
          playlists={playlists}
          onClose={() => {
            setIsSaveModalOpen(false);
            setSaveModalTrack(null);
          }}
          onRefreshPlaylists={refreshStatus}
        />
      )}

      {/* Security OTP Lock Screen Modal */}
      <SecurityOtpModal
        isOpen={isLockModalOpen}
        onClose={() => setIsLockModalOpen(false)}
        onSubmitOtp={submitCode}
        error={authError}
        loading={authLoading}
      />

      {/* Speaker Sync Mode Confirmation Dialog */}
      <ConfirmationModal
        isOpen={isSpeakerConfirmOpen}
        title="Switch to Speaker Sync Mode?"
        message="This will unmute the server speaker and output audio out loud in sync with the live stream broadcast."
        confirmLabel="Enable Speaker"
        cancelLabel="Keep Silent"
        variant="speaker"
        onConfirm={confirmSpeakerMode}
        onClose={() => setIsSpeakerConfirmOpen(false)}
      />
    </div>
  );
}
