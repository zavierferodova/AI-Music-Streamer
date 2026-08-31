/**
 * Music Streamer — Client Application Logic
 * Real-time WebSocket synchronization, Loading indicators, Playback error handling,
 * OTP authentication, and Playlists management.
 */

let currentState = 'stopped';
let currentMode = 'silent';
let currentLoop = 'repeat';
let currentPlaybackMode = 'ordered';
let currentVolume = 80;
let previousVolume = 80;
let volumeDebounceTimer = null;
let currentPlaylists = [];
let selectedPlaylistName = null;
let loadedPlaylistData = null;
let isPlaylistLoading = false;
let isSecurityEnabled = true;
let isAuthenticated = false;
let lastKnownErrorTimestamp = null;
let lastRenderedPlaybackSignature = '';
let lastRenderedPlaylistsNavSignature = '';
let lastRenderedActivePlaylistSignature = '';

const audio = document.getElementById('browser-audio');
const audioBtn = document.getElementById('stream-audio-btn');
const audioIcon = document.getElementById('stream-audio-icon');
const audioSpinner = document.getElementById('stream-audio-spinner');
const visualizer = document.getElementById('visualizer');
const heroThumb = document.getElementById('now-playing-thumb');
const heroThumbFallback = document.getElementById('now-playing-thumb-fallback');
const toast = document.getElementById('toast');
const topProgressBar = document.getElementById('top-progress-bar');
let toastTimeout = null;

/* =========================================================================
   Global Loading State Management (with Safety Auto-Timeout)
   ========================================================================= */
const activeLoadingTasks = new Map();

function startGlobalLoading(taskKey, timeoutMs = 6000) {
  if (activeLoadingTasks.has(taskKey)) {
    clearTimeout(activeLoadingTasks.get(taskKey));
  }
  const timer = setTimeout(() => {
    stopGlobalLoading(taskKey);
  }, timeoutMs);
  activeLoadingTasks.set(taskKey, timer);

  if (topProgressBar) {
    topProgressBar.classList.add('active');
    topProgressBar.style.width = '75%';
  }
}

function stopGlobalLoading(taskKey) {
  if (activeLoadingTasks.has(taskKey)) {
    clearTimeout(activeLoadingTasks.get(taskKey));
    activeLoadingTasks.delete(taskKey);
  }
  if (activeLoadingTasks.size === 0 && topProgressBar) {
    topProgressBar.style.width = '100%';
    setTimeout(() => {
      if (activeLoadingTasks.size === 0) {
        topProgressBar.classList.remove('active');
        topProgressBar.style.width = '0%';
      }
    }, 250);
  }
}

function setButtonLoading(btn, isLoading, loadingText = '') {
  if (!btn) return;
  if (isLoading) {
    btn.dataset.originalHtml = btn.innerHTML;
    btn.classList.add('is-loading');
    btn.disabled = true;
    btn.innerHTML = `<span class="btn-inline-spinner"></span> ${loadingText ? `<span>${escapeHtml(loadingText)}</span>` : ''}`;
  } else {
    btn.classList.remove('is-loading');
    btn.disabled = false;
    if (btn.dataset.originalHtml) {
      btn.innerHTML = btn.dataset.originalHtml;
    }
  }
}

/* =========================================================================
   Utility Functions & Toast System
   ========================================================================= */
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatTrackDisplay(rawTitle, rawUrl) {
  const t = (rawTitle || '').trim();
  const u = (rawUrl || '').trim();

  if (!t && !u) {
    return { title: 'Unknown Track', url: '' };
  }

  const isTitleUrl = t.startsWith('http://') || t.startsWith('https://') || (t === u);

  if (isTitleUrl) {
    let cleanTitle = 'YouTube Track';
    const m = u.match(/(?:v=|youtu\.be\/|shorts\/|embed\/|watch\?.*v=)([a-zA-Z0-9_-]{11})/);
    if (m) {
      cleanTitle = `YouTube Track (${m[1]})`;
    }
    return {
      title: escapeHtml(cleanTitle),
      url: escapeHtml(u)
    };
  }

  return {
    title: escapeHtml(t),
    url: (u && u !== t) ? escapeHtml(u) : ''
  };
}

/**
 * Enhanced Toast Notification
 * @param {string} msg 
 * @param {'info'|'success'|'warning'|'error'} type 
 * @param {string|null} iconName 
 */
function showToast(msg, type = 'info', iconName = null) {
  if (!toast) return;
  const msgElem = document.getElementById('toast-msg');
  const iconElem = document.getElementById('toast-icon');

  let defaultIcon = 'info';
  if (type === 'success') defaultIcon = 'check_circle';
  else if (type === 'error') defaultIcon = 'error_outline';
  else if (type === 'warning') defaultIcon = 'warning';

  if (msgElem) msgElem.innerText = msg;
  if (iconElem) iconElem.innerText = iconName || defaultIcon;

  toast.className = 'toast show';
  if (type === 'error') toast.classList.add('toast-error');
  else if (type === 'warning') toast.classList.add('toast-warning');
  else if (type === 'success') toast.classList.add('toast-success');

  if (toastTimeout) clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => {
    toast.classList.remove('show');
  }, type === 'error' ? 4000 : 2600);
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
      showToast('Copied to clipboard!', 'success', 'check_circle');
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

/* =========================================================================
   Live Stream Player Audio & Event Handlers
   ========================================================================= */
function updateStreamPlayerUI(isBuffering = false) {
  const errorText = document.getElementById('stream-audio-error');
  if (errorText) errorText.style.display = 'none';

  if (isBuffering) {
    if (audioIcon) audioIcon.style.display = 'none';
    if (audioSpinner) audioSpinner.style.display = 'inline-block';
    const statusText = document.getElementById('stream-audio-status');
    if (statusText) statusText.innerText = 'Connecting to broadcast stream...';
  } else if (!audio.paused) {
    if (audioSpinner) audioSpinner.style.display = 'none';
    if (audioIcon) {
      audioIcon.style.display = 'inline-block';
      audioIcon.innerText = 'pause';
    }
    const statusText = document.getElementById('stream-audio-status');
    if (statusText) statusText.innerText = 'Connected & Playing Live';
  } else {
    if (audioSpinner) audioSpinner.style.display = 'none';
    if (audioIcon) {
      audioIcon.style.display = 'inline-block';
      audioIcon.innerText = 'play_arrow';
    }
    const statusText = document.getElementById('stream-audio-status');
    if (statusText) statusText.innerText = 'Continuous MP3 Broadcast (24/7)';
  }
}

function toggleStreamAudio() {
  const errorText = document.getElementById('stream-audio-error');
  if (errorText) errorText.style.display = 'none';

  if (audio.paused) {
    updateStreamPlayerUI(true);
    audio.src = '/stream.mp3?t=' + Date.now();
    audio.play().then(() => {
      updateStreamPlayerUI(false);
      showToast('Playing live audio stream', 'success', 'play_arrow');
    }).catch(e => {
      console.error('Audio playback error:', e);
      updateStreamPlayerUI(false);
      let errMsg = 'Failed to start stream.';
      if (e.name === 'NotAllowedError') {
        errMsg = 'Autoplay prevented by browser. Click again to play.';
      } else if (e.name === 'NotSupportedError') {
        errMsg = 'MP3 stream format unsupported by this browser.';
      } else {
        errMsg = e.message || 'Stream connection failed.';
      }
      if (errorText) {
        errorText.innerText = errMsg;
        errorText.style.display = 'block';
      }
      showToast(errMsg, 'error', 'error_outline');
    });
  } else {
    audio.pause();
    updateStreamPlayerUI(false);
    showToast('Paused live stream', 'info', 'pause');
  }
}

// Browser Audio Event Listeners for Buffering & Errors
if (audio) {
  audio.addEventListener('waiting', () => {
    updateStreamPlayerUI(true);
  });
  audio.addEventListener('playing', () => {
    updateStreamPlayerUI(false);
  });
  audio.addEventListener('stalled', () => {
    console.warn('[Audio] Live stream stalled');
  });
  audio.addEventListener('error', (e) => {
    console.error('[Audio] Stream playback error:', e);
    updateStreamPlayerUI(false);
    const errorText = document.getElementById('stream-audio-error');
    if (errorText) {
      errorText.innerText = 'Audio stream error occurred. Click to reconnect.';
      errorText.style.display = 'block';
    }
    showToast('Live stream audio error occurred', 'error', 'error_outline');
  });
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

  const unlockBtn = document.getElementById('btn-unlock-otp');
  setButtonLoading(unlockBtn, true, 'Verifying...');
  lockError.innerText = '';

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
      showToast('Unlocked successfully! Welcome.', 'success', 'lock_open');
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
  } finally {
    setButtonLoading(unlockBtn, false);
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

function showConnectionBanner(show, msg = 'Connecting to Stream Server...') {
  const banner = document.getElementById('connection-banner');
  const bannerText = document.getElementById('connection-banner-text');
  if (banner) banner.style.display = show ? 'flex' : 'none';
  if (bannerText && msg) bannerText.innerText = msg;
}

function retryServerConnection() {
  const btn = document.getElementById('btn-reconnect-now');
  setButtonLoading(btn, true, 'Connecting...');
  connectWebSocket();
  updateStatus().finally(() => {
    setTimeout(() => setButtonLoading(btn, false), 500);
  });
}

function connectWebSocket() {
  const loc = window.location;
  const wsProtocol = loc.protocol === 'https:' ? 'wss://' : 'ws://';
  const wsUrl = `${wsProtocol}${loc.host}/ws`;

  try {
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      console.log('[WebSocket] Connected to live realtime sync hub');
      showConnectionBanner(false);
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
      showConnectionBanner(true, 'Connection lost to Stream Server. Reconnecting...');
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
      showConnectionBanner(true, 'Failed to connect to stream daemon. Retrying...');
      ws.close();
    };
  } catch (err) {
    console.error('[WebSocket] Failed to initiate:', err);
    showConnectionBanner(true, 'Server offline or unreachable.');
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
    else if (action === 'dismiss_error' || action === 'clear_error') endpoint = '/api/error/dismiss';

    fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).then(r => {
      if (r.status === 401) {
        openLockModal();
      }
    }).catch(e => {
      console.error('API POST error:', e);
      showToast('Action failed: Network error', 'error', 'error_outline');
    });
  }
}

/* =========================================================================
   Playback Error Handling & User Actions
   ========================================================================= */
function handlePlaybackErrorDisplay(errorObj) {
  const banner = document.getElementById('playback-error-banner');
  const titleElem = document.getElementById('playback-error-title');
  const msgElem = document.getElementById('playback-error-msg');

  if (!banner) return;

  if (errorObj && errorObj.message) {
    banner.style.display = 'flex';
    if (titleElem) titleElem.innerText = errorObj.title ? `Failed: ${errorObj.title}` : 'Playback Error';
    if (msgElem) msgElem.innerText = errorObj.message;

    if (errorObj.timestamp && errorObj.timestamp !== lastKnownErrorTimestamp) {
      lastKnownErrorTimestamp = errorObj.timestamp;
      showToast(`Music could not be played: ${errorObj.message}`, 'error', 'error_outline');
    }
  } else {
    banner.style.display = 'none';
  }
}

function dismissPlaybackError() {
  sendCommand({ action: 'dismiss_error' });
  const banner = document.getElementById('playback-error-banner');
  if (banner) banner.style.display = 'none';
}

function retryCurrentTrack() {
  const link = document.getElementById('track-url-link');
  const url = link ? link.href : '';
  if (url && url !== '#' && !url.endsWith('#')) {
    showToast('Retrying playback...', 'info', 'refresh');
    sendCommand({ action: 'interrupt', url: url });
  } else {
    skipTrack();
  }
}

/* =========================================================================
   Action Handlers
   ========================================================================= */
function togglePlayPause() {
  if (currentState === 'playing') {
    sendCommand({ action: 'pause' });
    showToast('Paused playback', 'info', 'pause');
  } else if (currentState === 'paused') {
    sendCommand({ action: 'resume' });
    showToast('Resumed playback', 'success', 'play_arrow');
  } else {
    sendCommand({ action: 'play' });
    showToast('Started playback', 'success', 'play_arrow');
  }
}

function skipTrack() {
  const btn = document.getElementById('btn-skip-track');
  setButtonLoading(btn, true);
  sendCommand({ action: 'skip' });
  showToast('Skipping to next track...', 'info', 'skip_next');
  setTimeout(() => setButtonLoading(btn, false), 400);
}

function stopMusic() {
  sendCommand({ action: 'stop' });
  showToast('Stopped playback (streaming silence)', 'info', 'stop');
}

function toggleLoop() {
  let nextLoop = 'repeat';
  const cur = (currentLoop || 'repeat').toLowerCase();
  if (cur === 'repeat' || cur === 'yes' || cur === 'all') {
    nextLoop = 'repeat-one';
  } else if (cur === 'repeat-one' || cur === 'one' || cur === 'single') {
    nextLoop = 'off';
  } else {
    nextLoop = 'repeat';
  }
  sendCommand({ action: 'loop', loop: nextLoop });
  if (nextLoop === 'repeat') {
    showToast('Loop: REPEAT (Loops entire tracklist from first)', 'info', 'repeat');
  } else if (nextLoop === 'repeat-one') {
    showToast('Loop: REPEAT-ONE (Repeats current song continuously)', 'info', 'repeat_one');
  } else {
    showToast('Loop: OFF (Plays once then stops)', 'info', 'arrow_forward');
  }
}

function toggleMode() {
  if (currentMode === 'silent') {
    if (confirm('Switch to Speaker Sync Mode?\n\nThis will unmute the server speaker and output audio out loud in sync with the live stream.')) {
      sendCommand({ action: 'mode', mode: 'speaker' });
      showToast('Switched to Speaker Sync Mode', 'success', 'volume_up');
    }
  } else {
    sendCommand({ action: 'mode', mode: 'silent' });
    showToast('Switched to Silent Broadcast Mode (Speaker Muted)', 'info', 'volume_off');
  }
}

function togglePlaybackMode() {
  const nextMode = currentPlaybackMode === 'shuffled' ? 'ordered' : 'shuffled';
  sendCommand({ action: 'playback_mode', mode: nextMode });
  showToast(nextMode === 'shuffled' ? 'Unplayed tracks shuffled!' : 'Playback set to sequential order', 'info', nextMode === 'shuffled' ? 'shuffle' : 'format_list_numbered');
}

function resetPlaybackHistory() {
  const btn = document.getElementById('btn-reset-history');
  setButtonLoading(btn, true);
  sendCommand({ action: 'playback_reset_history' });
  showToast('Reset all tracks for a fresh replay cycle!', 'success', 'restart_alt');
  setTimeout(() => setButtonLoading(btn, false), 400);
}

function clearPlaybackList() {
  if (confirm('Clear the entire upcoming playback list?')) {
    const btn = document.getElementById('btn-clear-playback');
    setButtonLoading(btn, true);
    sendCommand({ action: 'playback_clear' });
    showToast('Cleared playback list', 'info', 'delete_sweep');
    setTimeout(() => setButtonLoading(btn, false), 400);
  }
}

function quickAddPlayback() {
  const input = document.getElementById('quick-url-input');
  const btn = document.getElementById('btn-quick-add');
  const val = input ? input.value.trim() : '';
  if (!val) {
    showToast('Please enter a song name or YouTube URL', 'warning', 'warning');
    return;
  }
  setButtonLoading(btn, true, 'Adding...');
  sendCommand({ action: 'playback_add', url: val });
  input.value = '';
  showToast('Adding track to playback list...', 'success', 'playlist_add');
  setTimeout(() => setButtonLoading(btn, false), 500);
}

function quickInterruptPlay() {
  const input = document.getElementById('quick-url-input');
  const btn = document.getElementById('btn-quick-interrupt');
  const val = input ? input.value.trim() : '';
  if (!val) {
    showToast('Please enter a song name or YouTube URL', 'warning', 'warning');
    return;
  }
  setButtonLoading(btn, true, 'Starting...');
  sendCommand({ action: 'interrupt', url: val });
  input.value = '';
  showToast('Loading track for instant playback...', 'success', 'bolt');
  setTimeout(() => setButtonLoading(btn, false), 500);
}

function playTrackItem(idx) {
  showToast('Loading track...', 'info', 'play_arrow');
  sendCommand({ action: 'playback_play', index: idx });
}

function removeTrackItem(idx) {
  sendCommand({ action: 'playback_remove', index: idx });
  showToast('Removed track from list', 'info', 'close');
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
  showToast(`Server volume set to ${vol}%`, 'info', vol === 0 ? 'volume_off' : 'volume_up');
}

function stepVolume(delta) {
  const nextVol = Math.max(0, Math.min(100, currentVolume + delta));
  currentVolume = nextVol;
  updateVolumeSliderStyle(nextVol);
  sendCommand({ action: 'volume', volume: nextVol });
  showToast(`Server volume: ${nextVol}%`, 'info', nextVol === 0 ? 'volume_off' : 'volume_up');
}

function setVolumePreset(val) {
  const vol = Math.max(0, Math.min(100, val));
  currentVolume = vol;
  updateVolumeSliderStyle(vol);
  sendCommand({ action: 'volume', volume: vol });
  showToast(`Server volume preset: ${vol}%`, 'info', vol === 0 ? 'volume_off' : 'volume_up');
}

function toggleMuteVolume() {
  if (currentVolume > 0) {
    previousVolume = currentVolume;
    currentVolume = 0;
    updateVolumeSliderStyle(0);
    sendCommand({ action: 'volume', volume: 0 });
    showToast('Server speaker muted', 'info', 'volume_off');
  } else {
    const restoreVol = previousVolume > 0 ? previousVolume : 80;
    currentVolume = restoreVol;
    updateVolumeSliderStyle(restoreVol);
    sendCommand({ action: 'volume', volume: restoreVol });
    showToast(`Server speaker unmuted (${restoreVol}%)`, 'info', 'volume_up');
  }
}

/* =========================================================================
   Playlists Management (Fixed Loop Issue)
   ========================================================================= */
let playlistFilterQuery = '';

async function loadActivePlaylist(name, showSkeleton = false) {
  if (!name) return;
  if (isPlaylistLoading && selectedPlaylistName === name) return;

  selectedPlaylistName = name;
  const listElem = document.getElementById('playlist-tracks-container');

  if (showSkeleton && listElem) {
    listElem.innerHTML = `
      <div class="skeleton-item"><div class="skeleton-box skeleton-thumb"></div><div class="skeleton-lines"><div class="skeleton-box skeleton-line full"></div><div class="skeleton-box skeleton-line short"></div></div></div>
      <div class="skeleton-item"><div class="skeleton-box skeleton-thumb"></div><div class="skeleton-lines"><div class="skeleton-box skeleton-line medium"></div><div class="skeleton-box skeleton-line short"></div></div></div>
      <div class="skeleton-item"><div class="skeleton-box skeleton-thumb"></div><div class="skeleton-lines"><div class="skeleton-box skeleton-line full"></div><div class="skeleton-box skeleton-line short"></div></div></div>
    `;
  }

  isPlaylistLoading = true;
  startGlobalLoading('playlist_load');

  try {
    const res = await fetch(`/api/playlist?name=${encodeURIComponent(name)}`);
    if (res.ok) {
      const data = await res.json();
      loadedPlaylistData = data.playlist;
      renderActivePlaylist(data.playlist);
    } else {
      if (listElem && showSkeleton) {
        listElem.innerHTML = '<div class="playback-empty" style="color: var(--rose);">Could not load playlist. Click to retry.</div>';
      }
    }
  } catch (e) {
    console.error('Failed to load playlist:', e);
    if (listElem && showSkeleton) {
      listElem.innerHTML = '<div class="playback-empty" style="color: var(--rose);">Network error loading playlist.</div>';
    }
  } finally {
    isPlaylistLoading = false;
    stopGlobalLoading('playlist_load');
  }
}

function filterPlaylistList(query) {
  playlistFilterQuery = (query || '').trim().toLowerCase();
  renderPlaylistNav(currentPlaylists);
}

function renderPlaylistNav(pls) {
  currentPlaylists = pls || [];
  const totalBadge = document.getElementById('playlists-total-badge');
  if (totalBadge && totalBadge.innerText !== String(currentPlaylists.length)) {
    totalBadge.innerText = currentPlaylists.length;
  }

  const container = document.getElementById('playlist-nav-list');
  if (!container) return;

  if (currentPlaylists.length === 0) {
    if (container.innerHTML !== '<div style="color: var(--text-muted); font-size: 0.82rem; padding: 12px 6px; text-align: center;">No playlists created yet. Click "+ New Playlist" to start!</div>') {
      container.innerHTML = '<div style="color: var(--text-muted); font-size: 0.82rem; padding: 12px 6px; text-align: center;">No playlists created yet. Click "+ New Playlist" to start!</div>';
    }
    document.getElementById('active-playlist-toolbar').style.display = 'none';
    document.getElementById('playlist-add-box').style.display = 'none';
    document.getElementById('playlist-tracks-container').innerHTML = '<div class="playback-empty">No active playlist selected.</div>';
    selectedPlaylistName = null;
    loadedPlaylistData = null;
    lastRenderedPlaylistsNavSignature = '';
    return;
  }

  const filtered = playlistFilterQuery
    ? currentPlaylists.filter(p => p.name.toLowerCase().includes(playlistFilterQuery))
    : currentPlaylists;

  if (!selectedPlaylistName || !currentPlaylists.some(p => p.name.toLowerCase() === selectedPlaylistName.toLowerCase())) {
    selectedPlaylistName = currentPlaylists[0].name;
  }

  const playlistsSignature = JSON.stringify(currentPlaylists.map(p => ({
    id: p.id,
    name: p.name,
    count: p.track_count,
    updated: p.updated_at
  }))) + '_' + (selectedPlaylistName || '') + '_' + playlistFilterQuery;

  if (playlistsSignature !== lastRenderedPlaylistsNavSignature) {
    lastRenderedPlaylistsNavSignature = playlistsSignature;
    if (filtered.length === 0) {
      container.innerHTML = `<div style="color: var(--text-muted); font-size: 0.82rem; padding: 12px 6px; text-align: center;">No playlist matches "${escapeHtml(playlistFilterQuery)}"</div>`;
    } else {
      container.innerHTML = filtered.map(p => {
        const isSel = (p.name.toLowerCase() === selectedPlaylistName.toLowerCase());
        return `
          <div class="playlist-nav-item ${isSel ? 'active' : ''}" onclick="selectPlaylist('${escapeHtml(p.name)}')">
            <div class="playlist-nav-left">
              <span class="material-symbols-rounded playlist-nav-icon">queue_music</span>
              <span class="playlist-nav-name" title="${escapeHtml(p.name)}">${escapeHtml(p.name)}</span>
            </div>
            <span class="playlist-nav-badge">${p.track_count || 0}</span>
          </div>
        `;
      }).join('');
    }
  }

  const activePl = currentPlaylists.find(p => p.name.toLowerCase() === (selectedPlaylistName || '').toLowerCase());
  const activeCount = activePl ? (activePl.track_count || 0) : 0;
  const activeUpdatedAt = activePl ? (activePl.updated_at || 0) : 0;

  const isDifferentName = !loadedPlaylistData || (loadedPlaylistData.name.toLowerCase() !== (selectedPlaylistName || '').toLowerCase());
  const isDataStale = !isDifferentName && loadedPlaylistData && (
    (loadedPlaylistData.tracks?.length !== activeCount) ||
    (loadedPlaylistData.updated_at !== activeUpdatedAt)
  );

  if (isDifferentName) {
    loadActivePlaylist(selectedPlaylistName, true);
  } else if (isDataStale) {
    loadActivePlaylist(selectedPlaylistName, false);
  }
}

function renderPlaylistTabs(pls) {
  renderPlaylistNav(pls);
}

function selectPlaylist(name) {
  if (selectedPlaylistName === name && loadedPlaylistData) return;
  selectedPlaylistName = name;
  renderPlaylistNav(currentPlaylists);
  loadActivePlaylist(name, true);
}

function renderActivePlaylist(pl) {
  if (!pl) return;
  const toolbar = document.getElementById('active-playlist-toolbar');
  const addBox = document.getElementById('playlist-add-box');
  const nameElem = document.getElementById('active-playlist-name');
  const countElem = document.getElementById('active-playlist-track-count');
  const listElem = document.getElementById('playlist-tracks-container');

  if (toolbar) toolbar.style.display = 'flex';
  if (addBox) addBox.style.display = 'flex';
  if (nameElem && nameElem.innerText !== pl.name) nameElem.innerText = pl.name;
  const countStr = `${pl.tracks?.length || 0} tracks`;
  if (countElem && countElem.innerText !== countStr) countElem.innerText = countStr;

  const tracks = pl.tracks || [];
  const plTracksSignature = (pl.name || '') + '_' + JSON.stringify(tracks.map(t => ({
    id: t.id,
    url: t.url,
    title: t.title,
    thumb: t.thumbnail
  })));

  if (listElem && plTracksSignature !== lastRenderedActivePlaylistSignature) {
    lastRenderedActivePlaylistSignature = plTracksSignature;
    if (tracks.length === 0) {
      listElem.innerHTML = '<div class="playback-empty">This playlist is empty. Add songs using the input below!</div>';
    } else {
      listElem.innerHTML = tracks.map((t, idx) => {
        const displayInfo = formatTrackDisplay(t.title, t.url);
        const safeThumb = escapeHtml(t.thumbnail || '');

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
          <li class="playback-item">
            <span class="track-badge badge-item-queued">#${idx + 1}</span>
            ${thumbHtml}
            <div class="playback-item-info">
              <div class="playback-item-title">${displayInfo.title}</div>
              ${displayInfo.url ? `<div class="playback-item-url">${displayInfo.url}</div>` : ''}
            </div>
            <div class="playback-item-actions">
              <button class="btn-item-action btn-item-play" title="Play directly" onclick="playSingleUrl('${escapeHtml(t.url)}')">
                <span class="material-symbols-rounded">play_arrow</span><span>Play</span>
              </button>
              <button class="btn-item-action btn-item-remove" title="Remove track from playlist" onclick="removePlaylistTrackItem(${idx})">
                <span class="material-symbols-rounded">close</span>
              </button>
            </div>
          </li>
        `;
      }).join('');
    }
  }
}

function openNewPlaylistPrompt() {
  const name = prompt('Enter a name for the new playlist:');
  if (name && name.trim()) {
    const clean = name.trim();
    const btn = document.getElementById('btn-new-playlist');
    setButtonLoading(btn, true);
    sendCommand({ action: 'playlist_create', name: clean });
    selectedPlaylistName = clean;
    loadedPlaylistData = null;
    showToast(`Created playlist "${clean}"`, 'success', 'library_add');
    setTimeout(() => {
      setButtonLoading(btn, false);
      updateStatus();
    }, 300);
  }
}

function renameActivePlaylist() {
  if (!selectedPlaylistName) return;
  const current = selectedPlaylistName;
  const newName = prompt(`Rename playlist "${current}" to:`, current);
  if (newName && newName.trim() && newName.trim() !== current) {
    const clean = newName.trim();
    sendCommand({ action: 'playlist_rename', playlist: current, new_name: clean });
    selectedPlaylistName = clean;
    loadedPlaylistData = null;
    showToast(`Renamed playlist to "${clean}"`, 'success', 'edit');
    setTimeout(() => {
      updateStatus();
      loadActivePlaylist(clean, true);
    }, 200);
  }
}

function deleteActivePlaylist() {
  if (!selectedPlaylistName) return;
  if (confirm(`Are you sure you want to delete playlist "${selectedPlaylistName}"?`)) {
    const target = selectedPlaylistName;
    const btn = document.getElementById('btn-pl-delete');
    setButtonLoading(btn, true);
    sendCommand({ action: 'playlist_delete', playlist: target });
    showToast(`Deleted playlist "${target}"`, 'info', 'delete');
    selectedPlaylistName = null;
    loadedPlaylistData = null;
    setTimeout(() => {
      setButtonLoading(btn, false);
      updateStatus();
    }, 300);
  }
}

function playActivePlaylist(shuffle = false) {
  if (!selectedPlaylistName) return;
  const btn = document.getElementById(shuffle ? 'btn-pl-play-shuffled' : 'btn-pl-play-ordered');
  setButtonLoading(btn, true);
  sendCommand({ action: 'playlist_play', playlist: selectedPlaylistName, shuffle });
  showToast(`Playing playlist "${selectedPlaylistName}" (${shuffle ? 'Shuffled' : 'Ordered'})`, 'success', shuffle ? 'shuffle' : 'play_arrow');
  setTimeout(() => setButtonLoading(btn, false), 500);
}

function queueActivePlaylist(shuffle = false) {
  if (!selectedPlaylistName) return;
  const btn = document.getElementById('btn-pl-queue');
  setButtonLoading(btn, true);
  sendCommand({ action: 'playlist_queue', playlist: selectedPlaylistName, shuffle });
  showToast(`Queued playlist "${selectedPlaylistName}"`, 'success', 'queue');
  setTimeout(() => setButtonLoading(btn, false), 500);
}

async function addTrackToActivePlaylist() {
  if (!selectedPlaylistName) return;
  const input = document.getElementById('playlist-add-input');
  const btn = document.getElementById('btn-pl-add-track');
  const val = input ? input.value.trim() : '';
  if (!val) {
    showToast('Please enter a YouTube URL or song name', 'warning', 'warning');
    return;
  }

  setButtonLoading(btn, true, 'Adding...');
  showToast(`Adding track to "${selectedPlaylistName}"...`, 'info', 'playlist_add');
  input.value = '';

  try {
    const res = await fetch('/api/playlist/add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playlist: selectedPlaylistName, url: val })
    });
    if (res.ok) {
      showToast(`Track added to "${selectedPlaylistName}"!`, 'success', 'check_circle');
      loadedPlaylistData = null;
      await loadActivePlaylist(selectedPlaylistName, false);
      updateStatus();
    } else {
      showToast('Failed to add track to playlist', 'error', 'error_outline');
    }
  } catch (err) {
    console.error('Playlist add error:', err);
    sendCommand({ action: 'playlist_add', playlist: selectedPlaylistName, url: val });
    setTimeout(() => {
      loadedPlaylistData = null;
      loadActivePlaylist(selectedPlaylistName, false);
      updateStatus();
    }, 500);
  } finally {
    setButtonLoading(btn, false);
  }
}

async function removePlaylistTrackItem(idx) {
  if (!selectedPlaylistName) return;
  try {
    const res = await fetch('/api/playlist/remove', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playlist: selectedPlaylistName, index: idx })
    });
    if (res.ok) {
      showToast('Removed track from playlist', 'info', 'close');
      loadedPlaylistData = null;
      await loadActivePlaylist(selectedPlaylistName, false);
      updateStatus();
    } else {
      sendCommand({ action: 'playlist_remove', playlist: selectedPlaylistName, index: idx });
      setTimeout(() => {
        loadedPlaylistData = null;
        loadActivePlaylist(selectedPlaylistName, false);
        updateStatus();
      }, 300);
    }
  } catch (e) {
    sendCommand({ action: 'playlist_remove', playlist: selectedPlaylistName, index: idx });
    setTimeout(() => {
      loadedPlaylistData = null;
      loadActivePlaylist(selectedPlaylistName, false);
      updateStatus();
    }, 300);
  }
}

function playSingleUrl(url) {
  showToast('Starting track playback...', 'info', 'play_arrow');
  sendCommand({ action: 'interrupt', url: url });
}

/* =========================================================================
   Universal Search Hub (Local Library & Web Results) with Skeletons & Errors
   ========================================================================= */
function renderSearchSkeletons(container, count = 3) {
  if (!container) return;
  let html = '';
  for (let i = 0; i < count; i++) {
    html += `
      <div class="skeleton-item">
        <div class="skeleton-box skeleton-thumb"></div>
        <div class="skeleton-lines">
          <div class="skeleton-box skeleton-line ${i % 2 === 0 ? 'full' : 'medium'}"></div>
          <div class="skeleton-box skeleton-line short"></div>
        </div>
      </div>
    `;
  }
  container.innerHTML = html;
}

async function executeUniversalSearch() {
  const input = document.getElementById('universal-search-input');
  const searchBtn = document.getElementById('btn-search-exec');
  const spinner = document.getElementById('search-input-spinner');
  const q = input ? input.value.trim() : '';
  if (!q) {
    showToast('Please enter a search query', 'warning', 'warning');
    return;
  }

  const modal = document.getElementById('search-modal-overlay');
  const queryDisplay = document.getElementById('search-query-display');
  const localList = document.getElementById('search-local-list');
  const webList = document.getElementById('search-web-list');
  const localCount = document.getElementById('search-local-count');
  const webCount = document.getElementById('search-web-count');
  const errorCard = document.getElementById('search-error-card');
  const errorMsg = document.getElementById('search-error-msg');

  if (modal) modal.style.display = 'flex';
  if (queryDisplay) queryDisplay.innerText = `"${q}"`;
  if (errorCard) errorCard.style.display = 'none';

  startGlobalLoading('search_query');
  if (spinner) spinner.style.display = 'block';
  setButtonLoading(searchBtn, true);

  if (localCount) localCount.innerText = 'Searching...';
  if (webCount) webCount.innerText = 'Searching...';

  renderSearchSkeletons(localList, 2);
  renderSearchSkeletons(webList, 4);

  try {
    const res = await fetch(`/api/search?q=${encodeURIComponent(q)}&count=6&web=1`);
    if (!res.ok) throw new Error(`Search request failed (HTTP ${res.status})`);
    const data = await res.json();

    const locals = data.local_results || [];
    const webs = data.web_results || [];

    if (localCount) localCount.innerText = `${locals.length} found`;
    if (webCount) webCount.innerText = `${webs.length} found`;

    // Render Local Matches
    if (localList) {
      if (locals.length === 0) {
        localList.innerHTML = '<div style="color: var(--text-muted); padding: 12px; font-size: 0.85rem; text-align: center;">No matching tracks in your playlists or queue.</div>';
      } else {
        localList.innerHTML = locals.map(item => {
          const safeTitle = escapeHtml(item.title || item.url || '');
          const safeUrl = escapeHtml(item.url || '');
          const safeSrc = escapeHtml(item.source_label || 'Local');
          const safeThumb = escapeHtml(item.thumbnail || '');

          const thumbHtml = safeThumb ? `
            <div class="playback-thumb-box" style="width: 38px; height: 38px;">
              <img class="playback-thumb-img" src="${safeThumb}" alt="thumb" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
              <div class="playback-thumb-fallback" style="display: none;"><span class="material-symbols-rounded">music_note</span></div>
            </div>
          ` : `
            <div class="playback-thumb-box" style="width: 38px; height: 38px;">
              <span class="material-symbols-rounded">music_note</span>
            </div>
          `;

          return `
            <li class="search-item">
              <div class="search-item-info">
                ${thumbHtml}
                <div class="search-item-text">
                  <div class="search-item-title" title="${safeTitle}">${safeTitle}</div>
                  <div class="search-item-source">
                    <span class="badge badge-server" style="font-size: 0.7rem; padding: 1px 6px;">${safeSrc}</span>
                  </div>
                </div>
              </div>
              <div class="search-item-actions">
                <button class="btn btn-primary" style="padding: 6px 12px; font-size: 0.78rem; min-height: 32px;" onclick="playSingleUrl('${safeUrl}'); closeSearchModal();" title="Play directly">
                  <span class="material-symbols-rounded" style="font-size: 16px;">play_arrow</span>
                  <span>Play Local</span>
                </button>
                <button class="btn btn-secondary" style="padding: 6px 12px; font-size: 0.78rem; min-height: 32px;" onclick="quickAddUrlToQueue('${safeUrl}', '${safeTitle}');" title="Add to upcoming queue">
                  <span class="material-symbols-rounded" style="font-size: 16px;">queue</span>
                  <span>Queue</span>
                </button>
              </div>
            </li>
          `;
        }).join('');
      }
    }

    // Render Web Matches
    if (webList) {
      if (webs.length === 0) {
        webList.innerHTML = '<div style="color: var(--text-muted); padding: 12px; font-size: 0.85rem; text-align: center;">No web search results found.</div>';
      } else {
        webList.innerHTML = webs.map(item => {
          const safeTitle = escapeHtml(item.title || item.url || '');
          const safeUrl = escapeHtml(item.url || '');
          const safeThumb = escapeHtml(item.thumbnail || (item.id ? `https://i.ytimg.com/vi/${item.id}/hqdefault.jpg` : ''));

          const thumbHtml = safeThumb ? `
            <div class="playback-thumb-box" style="width: 38px; height: 38px;">
              <img class="playback-thumb-img" src="${safeThumb}" alt="thumb" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
              <div class="playback-thumb-fallback" style="display: none;"><span class="material-symbols-rounded">public</span></div>
            </div>
          ` : `
            <div class="playback-thumb-box" style="width: 38px; height: 38px;">
              <span class="material-symbols-rounded">public</span>
            </div>
          `;

          return `
            <li class="search-item">
              <div class="search-item-info">
                ${thumbHtml}
                <div class="search-item-text">
                  <div class="search-item-title" title="${safeTitle}">${safeTitle}</div>
                  <div class="search-item-source">
                    <span class="badge badge-listeners" style="font-size: 0.7rem; padding: 1px 6px;">YouTube</span>
                  </div>
                </div>
              </div>
              <div class="search-item-actions">
                <button class="btn btn-accent" style="padding: 6px 12px; font-size: 0.78rem; min-height: 32px;" onclick="playSingleUrl('${safeUrl}'); closeSearchModal();" title="Play from web">
                  <span class="material-symbols-rounded" style="font-size: 16px;">bolt</span>
                  <span>Play Web</span>
                </button>
                <button class="btn btn-secondary" style="padding: 6px 12px; font-size: 0.78rem; min-height: 32px;" onclick="quickAddUrlToQueue('${safeUrl}', '${safeTitle}');" title="Add to upcoming queue">
                  <span class="material-symbols-rounded" style="font-size: 16px;">queue</span>
                  <span>Queue</span>
                </button>
                <button class="btn btn-secondary" style="padding: 6px 12px; font-size: 0.78rem; min-height: 32px;" onclick="addUrlToPlaylistPrompt('${safeUrl}', '${safeTitle}');" title="Save to Playlist">
                  <span class="material-symbols-rounded" style="font-size: 16px;">playlist_add</span>
                  <span>Save</span>
                </button>
              </div>
            </li>
          `;
        }).join('');
      }
    }

  } catch (err) {
    console.error('Search error:', err);
    if (errorCard) {
      if (errorMsg) errorMsg.innerText = `Search error: ${err.message || 'Unable to connect to search provider.'}`;
      errorCard.style.display = 'flex';
    }
    if (localList) localList.innerHTML = `<div style="color: var(--rose); padding: 10px;">Local search error: ${escapeHtml(err.message)}</div>`;
    if (webList) webList.innerHTML = `<div style="color: var(--rose); padding: 10px;">Web search error: ${escapeHtml(err.message)}</div>`;
    showToast('Search failed: ' + err.message, 'error', 'error_outline');
  } finally {
    stopGlobalLoading('search_query');
    if (spinner) spinner.style.display = 'none';
    setButtonLoading(searchBtn, false);
  }
}

function closeSearchModal() {
  const modal = document.getElementById('search-modal-overlay');
  if (modal) modal.style.display = 'none';
}

function quickAddUrlToQueue(url, title = '') {
  sendCommand({ action: 'playback_add', url: url, title: title });
  showToast(`Added "${title || url}" to upcoming queue`, 'success', 'queue');
}

async function addUrlToPlaylistPrompt(url, title = '') {
  if (currentPlaylists.length === 0) {
    const plName = prompt('Enter a name for a new playlist to save this track:');
    if (plName && plName.trim()) {
      const cleanName = plName.trim();
      sendCommand({ action: 'playlist_create', name: cleanName });
      setTimeout(async () => {
        try {
          await fetch('/api/playlist/add', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ playlist: cleanName, url: url, title: title })
          });
          showToast(`Saved to playlist "${cleanName}"`, 'success', 'playlist_add');
          loadedPlaylistData = null;
          updateStatus();
        } catch (e) {
          sendCommand({ action: 'playlist_add', playlist: cleanName, url: url, title: title });
        }
      }, 300);
    }
    return;
  }

  const plNames = currentPlaylists.map(p => p.name).join('\n• ');
  const target = prompt(`Save track to which playlist?\nAvailable playlists:\n• ${plNames}`, selectedPlaylistName || currentPlaylists[0].name);
  if (target && target.trim()) {
    const cleanTarget = target.trim();
    try {
      const res = await fetch('/api/playlist/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playlist: cleanTarget, url: url, title: title })
      });
      if (res.ok) {
        showToast(`Saved to playlist "${cleanTarget}"`, 'success', 'playlist_add');
        loadedPlaylistData = null;
        if (selectedPlaylistName && selectedPlaylistName.toLowerCase() === cleanTarget.toLowerCase()) {
          await loadActivePlaylist(cleanTarget, false);
        }
        updateStatus();
      } else {
        sendCommand({ action: 'playlist_add', playlist: cleanTarget, url: url, title: title });
        showToast(`Saved to playlist "${cleanTarget}"`, 'success', 'playlist_add');
      }
    } catch (e) {
      sendCommand({ action: 'playlist_add', playlist: cleanTarget, url: url, title: title });
      showToast(`Saved to playlist "${cleanTarget}"`, 'success', 'playlist_add');
    }
  }
}

/* =========================================================================
   UI State Rendering & Playback Updates
   ========================================================================= */
function applyStatusUpdate(data) {
  if (!data) return;

  currentState = data.state || 'stopped';
  currentMode = data.mode || 'silent';
  currentLoop = data.loop || 'yes';
  
  const playbackData = data.playback || {};
  currentPlaybackMode = playbackData.mode || data.queue?.mode || 'ordered';

  // Handle Playback Errors
  handlePlaybackErrorDisplay(data.last_error);

  // Playlists Library synchronization
  if (data.playlists) {
    renderPlaylistTabs(data.playlists);
  }

  // Volume Synchronization
  if (data.volume !== undefined) {
    const vol = typeof data.volume === 'object' ? parseInt(data.volume.saved || data.volume.level || 80, 10) : parseInt(data.volume, 10);
    if (!isNaN(vol)) {
      currentVolume = vol;
      updateVolumeSliderStyle(vol);
    }
  }

  // Listeners count
  const clientBadge = document.getElementById('client-count-badge');
  if (clientBadge) clientBadge.innerText = data.clients_connected || 0;

  const uptimeBadge = document.getElementById('uptime-badge');
  if (uptimeBadge) uptimeBadge.innerText = formatUptime(data.uptime_seconds || 0);

  // Security Badge
  if (data.security) {
    isSecurityEnabled = data.security.enabled;
    const secText = document.getElementById('security-status-text');
    if (secText) secText.innerText = isSecurityEnabled ? (isAuthenticated ? 'Protected (Verified)' : 'OTP Protected') : 'Public Access';
  }

  // Now Playing Title & URL
  const title = data.now_playing?.title || 'Idle (Continuous Live Silence)';
  const url = data.now_playing?.url || '';
  const thumb = data.now_playing?.thumbnail || '';

  const trackTitleElem = document.getElementById('track-title');
  if (trackTitleElem) trackTitleElem.innerText = title;

  const urlLink = document.getElementById('track-url-link');
  if (urlLink) {
    urlLink.innerText = url || 'No active track URL';
    urlLink.href = url || '#';
  }

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

  // Buffering Badge & Artwork Buffering Overlay
  const isBuffering = (currentState === 'playing') && !!data.is_buffering;
  const bufferingBadge = document.getElementById('buffering-badge');
  const artworkBuffering = document.getElementById('artwork-buffering-overlay');

  if (bufferingBadge) bufferingBadge.style.display = isBuffering ? 'inline-flex' : 'none';
  if (artworkBuffering) artworkBuffering.style.display = isBuffering ? 'flex' : 'none';

  // Visualizer & Play/Pause Button
  const playPauseIcon = document.getElementById('play-pause-icon');
  const playPauseText = document.getElementById('play-pause-text');

  if (currentState === 'playing') {
    if (visualizer) visualizer.classList.add('active');
    if (playPauseIcon) playPauseIcon.innerText = 'pause';
    if (playPauseText) playPauseText.innerText = 'Pause';
    const statState = document.getElementById('stat-state');
    if (statState) {
      statState.innerText = isBuffering ? 'BUFFERING' : 'PLAYING';
      statState.style.color = isBuffering ? 'var(--primary)' : 'var(--emerald)';
    }
    const statStateDesc = document.getElementById('stat-state-desc');
    if (statStateDesc) statStateDesc.innerText = isBuffering ? 'Buffering audio chunks...' : 'Audio decoding active';
  } else if (currentState === 'paused') {
    if (visualizer) visualizer.classList.remove('active');
    if (playPauseIcon) playPauseIcon.innerText = 'play_arrow';
    if (playPauseText) playPauseText.innerText = 'Resume';
    const statState = document.getElementById('stat-state');
    if (statState) {
      statState.innerText = 'PAUSED';
      statState.style.color = 'var(--amber)';
    }
    const statStateDesc = document.getElementById('stat-state-desc');
    if (statStateDesc) statStateDesc.innerText = 'Playback paused (silence stream)';
  } else {
    if (visualizer) visualizer.classList.remove('active');
    if (playPauseIcon) playPauseIcon.innerText = 'play_arrow';
    if (playPauseText) playPauseText.innerText = 'Play';
    const statState = document.getElementById('stat-state');
    if (statState) {
      statState.innerText = 'STOPPED';
      statState.style.color = 'var(--text-muted)';
    }
    const statStateDesc = document.getElementById('stat-state-desc');
    if (statStateDesc) statStateDesc.innerText = 'Broadcasting comfort silence';
  }

  // Mode Button & Stat
  const modeIcon = document.getElementById('mode-icon');
  if (currentMode === 'speaker') {
    if (modeIcon) modeIcon.innerText = 'volume_up';
    document.getElementById('mode-state-text').innerText = 'SPEAKER';
    document.getElementById('stat-mode').innerText = 'SPEAKER';
    document.getElementById('stat-mode-desc').innerText = 'Server speaker unmuted + stream';
  } else {
    if (modeIcon) modeIcon.innerText = 'volume_off';
    document.getElementById('mode-state-text').innerText = 'SILENT';
    document.getElementById('stat-mode').innerText = 'SILENT';
    document.getElementById('stat-mode-desc').innerText = 'HTTP stream broadcast only';
  }

  // Loop Button & Stat
  const loopIcon = document.getElementById('loop-icon');
  const loopText = document.getElementById('loop-state-text');
  const statLoop = document.getElementById('stat-loop');
  const statLoopDesc = document.getElementById('stat-loop-desc');

  const curL = (currentLoop || 'repeat').toLowerCase();
  if (curL === 'repeat-one' || curL === 'one' || curL === 'single') {
    if (loopIcon) loopIcon.innerText = 'repeat_one';
    if (loopText) loopText.innerText = 'REPEAT-ONE';
    if (statLoop) {
      statLoop.innerText = 'REPEAT-ONE';
      statLoop.style.color = 'var(--accent)';
    }
    if (statLoopDesc) statLoopDesc.innerText = 'Repeats single current track';
  } else if (curL === 'repeat' || curL === 'yes' || curL === 'all') {
    if (loopIcon) loopIcon.innerText = 'repeat';
    if (loopText) loopText.innerText = 'REPEAT';
    if (statLoop) {
      statLoop.innerText = 'REPEAT';
      statLoop.style.color = 'var(--primary)';
    }
    if (statLoopDesc) statLoopDesc.innerText = 'Loops all tracks from first';
  } else {
    if (loopIcon) loopIcon.innerText = 'repeat';
    if (loopText) loopText.innerText = 'OFF';
    if (statLoop) {
      statLoop.innerText = 'OFF';
      statLoop.style.color = 'var(--text-muted)';
    }
    if (statLoopDesc) statLoopDesc.innerText = 'Plays once then stops';
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

  if (pModeIcon && pModeText && pModeBtn) {
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
  if (listContainer) {
    const currentPlaybackSignature = JSON.stringify(allTracks.map(t => ({
      id: t.id,
      status: t.status,
      title: t.title,
      url: t.url,
      thumbnail: t.thumbnail
    }))) + '_' + currentPlaybackMode;

    if (currentPlaybackSignature !== lastRenderedPlaybackSignature) {
      lastRenderedPlaybackSignature = currentPlaybackSignature;
      if (allTracks.length === 0) {
        listContainer.innerHTML = '<div class="playback-empty">Playback list is currently empty. Add tracks below or use <code>./playback.py add</code></div>';
      } else {
        let upcomingIndex = 1;
        listContainer.innerHTML = allTracks.map((t, idx) => {
          const status = t.status || 'queued';
          let badgeHtml = '';
          let itemClass = '';
          let actionBtnHtml = '';

          const displayInfo = formatTrackDisplay(t.title, t.url);
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
                <div class="playback-item-title">${displayInfo.title}</div>
                ${displayInfo.url ? `<div class="playback-item-url">${displayInfo.url}</div>` : ''}
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
  }
}

async function updateStatus() {
  try {
    const res = await fetch('/status');
    if (res.ok) {
      const data = await res.json();
      applyStatusUpdate(data);
      showConnectionBanner(false);
    } else {
      showConnectionBanner(true, 'Stream Server returned an error status.');
    }
  } catch (e) {
    console.error('Status fetch error:', e);
    showConnectionBanner(true, 'Connection lost to Stream Server.');
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
