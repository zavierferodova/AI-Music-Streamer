/**
 * Music Streamer — Client Application Logic
 * Real-time WebSocket synchronization, OTP authentication, and Playback management.
 */

let currentState = 'stopped';
let currentMode = 'silent';
let currentLoop = 'yes';
let currentPlaybackMode = 'ordered';
let currentVolume = 80;
let previousVolume = 80;
let volumeDebounceTimer = null;
let isSecurityEnabled = true;
let isAuthenticated = false;

const audio = document.getElementById('browser-audio');
const audioBtn = document.getElementById('stream-audio-btn');
const audioIcon = document.getElementById('stream-audio-icon');
const visualizer = document.getElementById('visualizer');
const heroThumb = document.getElementById('now-playing-thumb');
const heroThumbFallback = document.getElementById('now-playing-thumb-fallback');
const toast = document.getElementById('toast');
let toastTimeout = null;

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function showToast(msg, iconName = 'check_circle') {
  document.getElementById('toast-msg').innerText = msg;
  document.getElementById('toast-icon').innerText = iconName;
  toast.classList.add('show');
  if (toastTimeout) clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => {
    toast.classList.remove('show');
  }, 2500);
}

function formatUptime(seconds) {
  const h = Math.floor(seconds / 3600).toString().padStart(2, '0');
  const m = Math.floor((seconds % 3600) / 60).toString().padStart(2, '0');
  const s = (seconds % 60).toString().padStart(2, '0');
  return `${h}:${m}:${s}`;
}

function copyText(txt) {
  if (!txt) return;
  if (navigator.clipboard) {
    navigator.clipboard.writeText(txt).then(() => {
      showToast('Copied to clipboard!', 'check_circle');
    }).catch(() => {
      prompt('Copy link:', txt);
    });
  } else {
    prompt('Copy link:', txt);
  }
}

function copyStreamLink() {
  const link = document.getElementById('track-url-link');
  if (link && link.href) {
    copyText(link.href);
  }
}

function copyDirectStreamLink() {
  const fullUrl = window.location.origin + '/stream.mp3';
  copyText(fullUrl);
}

function showThumbnailFallback() {
  if (heroThumb) heroThumb.style.display = 'none';
  if (heroThumbFallback) heroThumbFallback.style.display = 'flex';
}

function toggleStreamAudio() {
  if (audio.paused) {
    audio.play().then(() => {
      audioIcon.innerText = 'pause';
      document.getElementById('stream-audio-status').innerText = 'Connected & Playing Live';
      showToast('Playing live audio stream', 'play_arrow');
    }).catch(e => {
      console.error('Audio playback error:', e);
    });
  } else {
    audio.pause();
    audioIcon.innerText = 'play_arrow';
    document.getElementById('stream-audio-status').innerText = 'Paused';
    showToast('Paused live stream', 'pause');
  }
}

/* =========================================================================
   Security Lock Screen & OTP Verification
   ========================================================================= */
const lockModal = document.getElementById('lock-screen-modal');
const lockCard = document.getElementById('lock-card-box');
const lockError = document.getElementById('lock-error-msg');
const otpInputs = document.querySelectorAll('.otp-digit');

function openLockModal() {
  lockModal.classList.add('active');
  lockError.innerText = '';
  if (otpInputs.length > 0) otpInputs[0].focus();
}

function closeLockModal() {
  lockModal.classList.remove('active');
}

// OTP 6-Digit input auto-advancement & backspace
otpInputs.forEach((input, index) => {
  input.addEventListener('input', () => {
    if (input.value.length === 1 && index < otpInputs.length - 1) {
      otpInputs[index + 1].focus();
    }
    if (index === otpInputs.length - 1 && input.value.length === 1) {
      submitOTP();
    }
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Backspace' && !input.value && index > 0) {
      otpInputs[index - 1].focus();
    } else if (e.key === 'Enter') {
      submitOTP();
    }
  });
  input.addEventListener('paste', (e) => {
    e.preventDefault();
    const text = (e.clipboardData || window.clipboardData).getData('text').trim();
    if (/^\d+$/.test(text)) {
      const digits = text.split('').slice(0, 6);
      digits.forEach((d, i) => {
        if (otpInputs[i]) otpInputs[i].value = d;
      });
      if (digits.length === 6) submitOTP();
      else if (otpInputs[digits.length]) otpInputs[digits.length].focus();
    }
  });
});

async function submitOTP() {
  const code = Array.from(otpInputs).map(i => i.value).join('');
  if (code.length < 6) {
    lockError.innerText = 'Please enter all 6 digits of your OTP';
    return;
  }

  lockError.innerText = 'Verifying passcode...';

  try {
    const res = await fetch('/api/auth/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ otp: code })
    });
    const data = await res.json();

    if (res.ok && data.authenticated) {
      isAuthenticated = true;
      if (data.token) {
        localStorage.setItem('music_token', data.token);
      }
      closeLockModal();
      showToast('Unlocked successfully! Welcome.', 'lock_open');
      connectWebSocket();
      updateStatus();
    } else {
      lockError.innerText = data.message || 'Invalid OTP Passcode';
      lockCard.classList.remove('shake');
      void lockCard.offsetWidth; // Trigger reflow
      lockCard.classList.add('shake');
      otpInputs.forEach(i => i.value = '');
      if (otpInputs.length > 0) otpInputs[0].focus();
    }
  } catch (e) {
    lockError.innerText = 'Network connection error';
  }
}

async function checkAuthStatus() {
  try {
    const res = await fetch('/api/auth/status');
    if (!res.ok) {
      console.warn('Auth status check returned HTTP', res.status);
      return;
    }
    const data = await res.json();
    isSecurityEnabled = !!data.security_enabled;
    isAuthenticated = !!data.authenticated;

    const secText = document.getElementById('security-status-text');
    if (isSecurityEnabled) {
      if (secText) secText.innerText = isAuthenticated ? 'Protected (Verified)' : 'OTP Locked';
      if (!isAuthenticated) {
        // Check if ?otp=... is in URL
        const urlOtp = new URLSearchParams(window.location.search).get('otp');
        if (urlOtp && urlOtp.length === 6) {
          urlOtp.split('').forEach((d, i) => { if (otpInputs[i]) otpInputs[i].value = d; });
          submitOTP();
        } else {
          openLockModal();
        }
      }
    } else {
      if (secText) secText.innerText = 'Public Access';
      closeLockModal();
    }
  } catch (e) {
    console.error('Auth check error:', e);
  }
}

/* =========================================================================
   WebSocket Real-Time Synchronization Engine
   ========================================================================= */
let ws = null;
let wsReconnectTimer = null;

function connectWebSocket() {
  const loc = window.location;
  const wsProtocol = loc.protocol === 'https:' ? 'wss://' : 'ws://';
  const wsUrl = `${wsProtocol}${loc.host}/ws`;

  try {
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      console.log('[WebSocket] Connected to live realtime sync hub');
      document.getElementById('live-indicator').innerText = 'LIVE (REALTIME WS)';
      const dot = document.getElementById('live-dot-indicator');
      if (dot) dot.style.background = 'var(--emerald)';
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        applyStatusUpdate(data);
      } catch (e) {
        console.error('[WebSocket] Message JSON error:', e);
      }
    };

    ws.onclose = () => {
      console.warn('[WebSocket] Connection closed. Reconnecting in 1.5s...');
      document.getElementById('live-indicator').innerText = 'RECONNECTING...';
      const dot = document.getElementById('live-dot-indicator');
      if (dot) dot.style.background = 'var(--amber)';
      if (!wsReconnectTimer) {
        wsReconnectTimer = setTimeout(() => {
          wsReconnectTimer = null;
          connectWebSocket();
        }, 1500);
      }
    };

    ws.onerror = (err) => {
      console.error('[WebSocket] Error:', err);
      ws.close();
    };
  } catch (err) {
    console.error('[WebSocket] Failed to initiate:', err);
    setTimeout(connectWebSocket, 2000);
  }
}

function sendCommand(payload) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  } else {
    const action = payload.action;
    let endpoint = '/api/' + action;
    if (action === 'playback_add' || action === 'queue_add') endpoint = '/api/playback/add';
    else if (action === 'playback_clear' || action === 'queue_clear') endpoint = '/api/playback/clear';
    else if (action === 'playback_play' || action === 'queue_play' || action === 'interrupt') endpoint = '/api/playback/play';
    else if (action === 'playback_remove' || action === 'queue_remove') endpoint = '/api/playback/remove';
    else if (action === 'playback_mode' || action === 'queue_mode') endpoint = '/api/playback/mode';
    else if (action === 'playback_shuffle') endpoint = '/api/playback/shuffle';
    else if (action === 'playback_reset_history') endpoint = '/api/playback/reset_history';

    fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).then(r => {
      if (r.status === 401) {
        openLockModal();
      }
    }).catch(e => console.error('API POST error:', e));
  }
}

/* =========================================================================
   Action Handlers
   ========================================================================= */
function togglePlayPause() {
  if (currentState === 'playing') {
    sendCommand({ action: 'pause' });
    showToast('Paused playback', 'pause');
  } else if (currentState === 'paused') {
    sendCommand({ action: 'resume' });
    showToast('Resumed playback', 'play_arrow');
  } else {
    sendCommand({ action: 'play' });
    showToast('Started playback', 'play_arrow');
  }
}

function skipTrack() {
  sendCommand({ action: 'skip' });
  showToast('Skipping to next track...', 'skip_next');
}

function stopMusic() {
  sendCommand({ action: 'stop' });
  showToast('Stopped playback (streaming silence)', 'stop');
}

function toggleLoop() {
  const nextLoop = currentLoop === 'yes' ? 'no' : 'yes';
  sendCommand({ action: 'loop', loop: nextLoop });
  showToast(nextLoop === 'yes' ? 'Loop: REPEAT (Repeats all tracks continuously)' : 'Loop: ONE-SHOT (Plays once then stops)', 'repeat');
}

function toggleMode() {
  const nextMode = currentMode === 'silent' ? 'speaker' : 'silent';
  sendCommand({ action: 'mode', mode: nextMode });
  showToast(nextMode === 'speaker' ? 'Switched to Speaker Sync Mode' : 'Switched to Silent Broadcast Mode', 'volume_up');
}

function togglePlaybackMode() {
  const nextMode = currentPlaybackMode === 'shuffled' ? 'ordered' : 'shuffled';
  sendCommand({ action: 'playback_mode', mode: nextMode });
  showToast(nextMode === 'shuffled' ? 'Unplayed tracks shuffled!' : 'Playback set to sequential order', nextMode === 'shuffled' ? 'shuffle' : 'format_list_numbered');
}

function resetPlaybackHistory() {
  sendCommand({ action: 'playback_reset_history' });
  showToast('Reset all tracks for a fresh replay cycle!', 'restart_alt');
}

function clearPlaybackList() {
  sendCommand({ action: 'playback_clear' });
  showToast('Cleared playback list', 'delete_sweep');
}

function quickAddPlayback() {
  const input = document.getElementById('quick-url-input');
  const val = input.value.trim();
  if (!val) return;
  sendCommand({ action: 'playback_add', url: val });
  input.value = '';
  showToast('Added track to playback list!', 'playlist_add');
}

function quickInterruptPlay() {
  const input = document.getElementById('quick-url-input');
  const val = input.value.trim();
  if (!val) return;
  sendCommand({ action: 'interrupt', url: val });
  input.value = '';
  showToast('Interrupted — Playing now!', 'bolt');
}

function playTrackItem(idx) {
  sendCommand({ action: 'playback_play', index: idx });
  showToast('Interrupted — Playing track now!', 'play_arrow');
}

function removeTrackItem(idx) {
  sendCommand({ action: 'playback_remove', index: idx });
  showToast('Removed track from list', 'close');
}

/* =========================================================================
   Server Volume Controls
   ========================================================================= */
function updateVolumeSliderStyle(vol) {
  const slider = document.getElementById('server-volume-slider');
  const badge = document.getElementById('server-volume-badge');
  const statVol = document.getElementById('stat-volume-val');
  const icon = document.getElementById('volume-icon');
  const muteBtn = document.getElementById('btn-volume-mute');

  if (slider) slider.value = vol;
  if (badge) badge.innerText = `${vol}%`;
  if (statVol) statVol.innerText = `${vol}%`;

  if (slider) {
    slider.style.background = `linear-gradient(to right, var(--primary) 0%, var(--accent) ${vol}%, rgba(51, 65, 85, 0.6) ${vol}%, rgba(51, 65, 85, 0.6) 100%)`;
  }

  if (icon && muteBtn) {
    if (vol === 0) {
      icon.innerText = 'volume_off';
      muteBtn.classList.add('muted');
    } else if (vol < 35) {
      icon.innerText = 'volume_mute';
      muteBtn.classList.remove('muted');
    } else if (vol < 75) {
      icon.innerText = 'volume_down';
      muteBtn.classList.remove('muted');
    } else {
      icon.innerText = 'volume_up';
      muteBtn.classList.remove('muted');
    }
  }
}

function onVolumeSliderInput(val) {
  const vol = Math.max(0, Math.min(100, parseInt(val, 10) || 0));
  currentVolume = vol;
  updateVolumeSliderStyle(vol);

  if (volumeDebounceTimer) clearTimeout(volumeDebounceTimer);
  volumeDebounceTimer = setTimeout(() => {
    sendCommand({ action: 'volume', volume: vol });
  }, 40);
}

function onVolumeSliderChange(val) {
  const vol = Math.max(0, Math.min(100, parseInt(val, 10) || 0));
  currentVolume = vol;
  updateVolumeSliderStyle(vol);
  sendCommand({ action: 'volume', volume: vol });
  showToast(`Server volume set to ${vol}%`, vol === 0 ? 'volume_off' : 'volume_up');
}

function stepVolume(delta) {
  const nextVol = Math.max(0, Math.min(100, currentVolume + delta));
  currentVolume = nextVol;
  updateVolumeSliderStyle(nextVol);
  sendCommand({ action: 'volume', volume: nextVol });
  showToast(`Server volume: ${nextVol}%`, nextVol === 0 ? 'volume_off' : 'volume_up');
}

function setVolumePreset(val) {
  const vol = Math.max(0, Math.min(100, val));
  currentVolume = vol;
  updateVolumeSliderStyle(vol);
  sendCommand({ action: 'volume', volume: vol });
  showToast(`Server volume preset: ${vol}%`, vol === 0 ? 'volume_off' : 'volume_up');
}

function toggleMuteVolume() {
  if (currentVolume > 0) {
    previousVolume = currentVolume;
    currentVolume = 0;
    updateVolumeSliderStyle(0);
    sendCommand({ action: 'volume', volume: 0 });
    showToast('Server speaker muted', 'volume_off');
  } else {
    const restoreVol = previousVolume > 0 ? previousVolume : 80;
    currentVolume = restoreVol;
    updateVolumeSliderStyle(restoreVol);
    sendCommand({ action: 'volume', volume: restoreVol });
    showToast(`Server speaker unmuted (${restoreVol}%)`, 'volume_up');
  }
}

/* =========================================================================
   UI State Rendering
   ========================================================================= */
function applyStatusUpdate(data) {
  if (!data) return;

  currentState = data.state || 'stopped';
  currentMode = data.mode || 'silent';
  currentLoop = data.loop || 'yes';
  
  const playbackData = data.playback || {};
  currentPlaybackMode = playbackData.mode || data.queue?.mode || 'ordered';

  // Volume Synchronization
  if (data.volume !== undefined) {
    const vol = typeof data.volume === 'object' ? parseInt(data.volume.saved || data.volume.level || 80, 10) : parseInt(data.volume, 10);
    if (!isNaN(vol)) {
      currentVolume = vol;
      updateVolumeSliderStyle(vol);
    }
  }

  // Uptime & Listeners
  document.getElementById('uptime-badge').innerText = formatUptime(data.uptime_seconds || 0);
  document.getElementById('client-count-badge').innerText = data.clients_connected || 0;

  // Security Badge
  if (data.security) {
    isSecurityEnabled = data.security.enabled;
    const secText = document.getElementById('security-status-text');
    secText.innerText = isSecurityEnabled ? 'OTP Protected' : 'Public Access';
  }

  // Now Playing Title & URL
  const title = data.now_playing?.title || 'Idle (Continuous Live Silence)';
  const url = data.now_playing?.url || '';
  const thumb = data.now_playing?.thumbnail || '';

  document.getElementById('track-title').innerText = title;
  const urlLink = document.getElementById('track-url-link');
  urlLink.innerText = url || 'No active track URL';
  urlLink.href = url || '#';

  // Thumbnail update
  if (thumb) {
    if (heroThumb.src !== thumb) {
      heroThumb.src = thumb;
    }
    heroThumb.style.display = 'block';
    heroThumbFallback.style.display = 'none';
  } else {
    showThumbnailFallback();
  }

  // Visualizer & Play/Pause Button
  const playPauseIcon = document.getElementById('play-pause-icon');
  const playPauseText = document.getElementById('play-pause-text');

  if (currentState === 'playing') {
    visualizer.classList.add('active');
    playPauseIcon.innerText = 'pause';
    playPauseText.innerText = 'Pause';
    document.getElementById('stat-state').innerText = 'PLAYING';
    document.getElementById('stat-state').style.color = 'var(--emerald)';
    document.getElementById('stat-state-desc').innerText = 'Audio decoding active';
  } else if (currentState === 'paused') {
    visualizer.classList.remove('active');
    playPauseIcon.innerText = 'play_arrow';
    playPauseText.innerText = 'Resume';
    document.getElementById('stat-state').innerText = 'PAUSED';
    document.getElementById('stat-state').style.color = 'var(--amber)';
    document.getElementById('stat-state-desc').innerText = 'Playback paused (silence stream)';
  } else {
    visualizer.classList.remove('active');
    playPauseIcon.innerText = 'play_arrow';
    playPauseText.innerText = 'Play';
    document.getElementById('stat-state').innerText = 'STOPPED';
    document.getElementById('stat-state').style.color = 'var(--text-muted)';
    document.getElementById('stat-state-desc').innerText = 'Broadcasting comfort silence';
  }

  // Mode Button & Stat
  const modeIcon = document.getElementById('mode-icon');
  if (currentMode === 'speaker') {
    modeIcon.innerText = 'volume_up';
    document.getElementById('mode-state-text').innerText = 'SPEAKER';
    document.getElementById('stat-mode').innerText = 'SPEAKER';
    document.getElementById('stat-mode-desc').innerText = 'Server speaker unmuted + stream';
  } else {
    modeIcon.innerText = 'volume_off';
    document.getElementById('mode-state-text').innerText = 'SILENT';
    document.getElementById('stat-mode').innerText = 'SILENT';
    document.getElementById('stat-mode-desc').innerText = 'HTTP stream broadcast only';
  }

  // Loop Button & Stat
  const loopIcon = document.getElementById('loop-icon');
  if (currentLoop === 'yes') {
    loopIcon.innerText = 'repeat';
    document.getElementById('loop-state-text').innerText = 'REPEAT';
    document.getElementById('stat-loop').innerText = 'REPEAT';
    document.getElementById('stat-loop-desc').innerText = 'Full cycle repetition';
  } else {
    loopIcon.innerText = 'repeat_one';
    document.getElementById('loop-state-text').innerText = 'ONE-SHOT';
    document.getElementById('stat-loop').innerText = 'ONE-SHOT';
    document.getElementById('stat-loop-desc').innerText = 'Plays once then stops';
  }

  // Playback Stats
  const totalTracks = playbackData.total_count || 0;
  const playedCount = playbackData.played_count || 0;
  const playingCount = playbackData.playing_count || (currentState === 'playing' ? 1 : 0);
  const queuedCount = playbackData.queued_count || 0;
  const allTracks = playbackData.tracks || [];

  document.getElementById('stat-playback-count').innerText = `${totalTracks} Track(s)`;
  document.getElementById('stat-playback-summary').innerText = `${playedCount} played, ${queuedCount} upcoming`;
  document.getElementById('playback-badge-count').innerText = totalTracks;
  document.getElementById('pill-playing-count').innerText = `${playingCount} Playing`;
  document.getElementById('pill-queued-count').innerText = `${queuedCount} Upcoming`;
  document.getElementById('pill-played-count').innerText = `${playedCount} Played`;

  // Playback Mode Toggle Button UI
  const pModeIcon = document.getElementById('playback-mode-btn-icon');
  const pModeText = document.getElementById('playback-mode-btn-text');
  const pModeBtn = document.getElementById('btn-playback-mode-toggle');

  if (currentPlaybackMode === 'shuffled') {
    pModeIcon.innerText = 'shuffle';
    pModeText.innerText = 'Shuffled';
    pModeBtn.style.borderColor = 'var(--primary)';
    pModeBtn.style.background = 'rgba(56, 189, 248, 0.15)';
    pModeBtn.style.color = 'var(--primary)';
  } else {
    pModeIcon.innerText = 'format_list_numbered';
    pModeText.innerText = 'Ordered';
    pModeBtn.style.borderColor = 'rgba(255,255,255,0.1)';
    pModeBtn.style.background = 'var(--surface)';
    pModeBtn.style.color = 'var(--text)';
  }

  // Next Track Stat
  if (playbackData.next) {
    document.getElementById('stat-next-title').innerText = playbackData.next.title || playbackData.next.url;
    document.getElementById('stat-next-url').innerText = playbackData.next.url || '';
  } else {
    document.getElementById('stat-next-title').innerText = 'None (End of list)';
    document.getElementById('stat-next-url').innerText = '—';
  }

  // Render Complete Playback Tracklist (Played, Playing, Upcoming)
  const listContainer = document.getElementById('playback-list-container');
  if (allTracks.length === 0) {
    listContainer.innerHTML = '<div class="playback-empty">Playback list is currently empty. Add tracks below or use <code>./playback.py add</code></div>';
  } else {
    let upcomingIndex = 1;
    listContainer.innerHTML = allTracks.map((t, idx) => {
      const status = t.status || 'queued';
      let badgeHtml = '';
      let itemClass = '';
      let actionBtnHtml = '';

      const safeTitle = escapeHtml(t.title || t.url || '');
      const safeUrl = escapeHtml(t.url || '');
      const safeThumb = escapeHtml(t.thumbnail || '');

      if (status === 'playing') {
        itemClass = 'item-playing';
        badgeHtml = `<span class="track-badge badge-item-playing"><span class="material-symbols-rounded">equalizer</span> PLAYING</span>`;
        actionBtnHtml = `<button class="btn-item-action btn-item-play" title="Replay Track" onclick="playTrackItem(${idx})"><span class="material-symbols-rounded">replay</span><span>Restart</span></button>`;
      } else if (status === 'played') {
        itemClass = 'item-played';
        badgeHtml = `<span class="track-badge badge-item-played"><span class="material-symbols-rounded">done_all</span> PLAYED</span>`;
        actionBtnHtml = `<button class="btn-item-action btn-item-replay" title="Replay this song" onclick="playTrackItem(${idx})"><span class="material-symbols-rounded">replay</span><span>Replay</span></button>`;
      } else {
        // queued / upcoming
        const isNext = (upcomingIndex === 1);
        const badgeClass = isNext ? 'badge-item-next' : 'badge-item-queued';
        badgeHtml = `<span class="track-badge ${badgeClass}"><span class="material-symbols-rounded">schedule</span> #${upcomingIndex}${isNext ? ' NEXT' : ''}</span>`;
        upcomingIndex++;
        actionBtnHtml = `<button class="btn-item-action btn-item-play" title="Play Now" onclick="playTrackItem(${idx})"><span class="material-symbols-rounded">play_arrow</span><span>Play Now</span></button>`;
      }

      const thumbHtml = safeThumb ? `
        <div class="playback-thumb-box">
          <img class="playback-thumb-img" src="${safeThumb}" alt="thumb" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
          <div class="playback-thumb-fallback" style="display: none;"><span class="material-symbols-rounded">music_note</span></div>
        </div>
      ` : `
        <div class="playback-thumb-box">
          <span class="material-symbols-rounded">music_note</span>
        </div>
      `;

      return `
        <li class="playback-item ${itemClass}">
          ${badgeHtml}
          ${thumbHtml}
          <div class="playback-item-info">
            <div class="playback-item-title">${safeTitle}</div>
            <div class="playback-item-url">${safeUrl}</div>
          </div>
          <div class="playback-item-actions">
            ${actionBtnHtml}
            <button class="btn-item-action btn-item-remove" title="Remove track from list" onclick="removeTrackItem(${idx})">
              <span class="material-symbols-rounded">close</span>
            </button>
          </div>
        </li>
      `;
    }).join('');
  }
}

async function updateStatus() {
  try {
    const res = await fetch('/status');
    if (res.ok) {
      const data = await res.json();
      applyStatusUpdate(data);
    }
  } catch (e) {
    console.error('Status fetch error:', e);
  }
}

// Initialize Security & WebSocket on load
checkAuthStatus();
connectWebSocket();

// Fallback HTTP poll
setInterval(() => {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    updateStatus();
  }
}, 2000);
