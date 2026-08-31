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
let currentPlaylists = [];
let selectedPlaylistName = null;
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
  if (currentMode === 'silent') {
    if (confirm('Switch to Speaker Sync Mode?\n\nThis will unmute the server speaker and output audio out loud in sync with the live stream.')) {
      sendCommand({ action: 'mode', mode: 'speaker' });
      showToast('Switched to Speaker Sync Mode', 'volume_up');
    }
  } else {
    sendCommand({ action: 'mode', mode: 'silent' });
    showToast('Switched to Silent Broadcast Mode (Speaker Muted)', 'volume_off');
  }
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
   Playlists Management
   ========================================================================= */
let playlistFilterQuery = '';

async function loadActivePlaylist(name) {
  if (!name) return;
  selectedPlaylistName = name;
  try {
    const res = await fetch(`/api/playlist?name=${encodeURIComponent(name)}`);
    if (res.ok) {
      const data = await res.json();
      renderActivePlaylist(data.playlist);
    }
  } catch (e) {
    console.error('Failed to load playlist:', e);
  }
}

function filterPlaylistList(query) {
  playlistFilterQuery = (query || '').trim().toLowerCase();
  renderPlaylistNav(currentPlaylists);
}

function renderPlaylistNav(pls) {
  currentPlaylists = pls || [];
  const totalBadge = document.getElementById('playlists-total-badge');
  if (totalBadge) totalBadge.innerText = currentPlaylists.length;

  const container = document.getElementById('playlist-nav-list');
  if (!container) return;

  if (currentPlaylists.length === 0) {
    container.innerHTML = '<div style="color: var(--text-muted); font-size: 0.82rem; padding: 12px 6px; text-align: center;">No playlists created yet. Click "+ New Playlist" to start!</div>';
    document.getElementById('active-playlist-toolbar').style.display = 'none';
    document.getElementById('playlist-add-box').style.display = 'none';
    document.getElementById('playlist-tracks-container').innerHTML = '<div class="playback-empty">No active playlist selected.</div>';
    selectedPlaylistName = null;
    return;
  }

  const filtered = playlistFilterQuery
    ? currentPlaylists.filter(p => p.name.toLowerCase().includes(playlistFilterQuery))
    : currentPlaylists;

  if (filtered.length === 0) {
    container.innerHTML = `<div style="color: var(--text-muted); font-size: 0.82rem; padding: 12px 6px; text-align: center;">No playlist matches "${escapeHtml(playlistFilterQuery)}"</div>`;
    return;
  }

  if (!selectedPlaylistName || !currentPlaylists.some(p => p.name.toLowerCase() === selectedPlaylistName.toLowerCase())) {
    selectedPlaylistName = currentPlaylists[0].name;
  }

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

  loadActivePlaylist(selectedPlaylistName);
}

function renderPlaylistTabs(pls) {
  renderPlaylistNav(pls);
}

function selectPlaylist(name) {
  selectedPlaylistName = name;
  renderPlaylistNav(currentPlaylists);
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
  if (nameElem) nameElem.innerText = pl.name;
  if (countElem) countElem.innerText = `${pl.tracks?.length || 0} tracks`;

  const tracks = pl.tracks || [];
  if (tracks.length === 0) {
    listElem.innerHTML = '<div class="playback-empty">This playlist is empty. Add songs using the input below!</div>';
    return;
  }

  listElem.innerHTML = tracks.map((t, idx) => {
    const safeTitle = escapeHtml(t.title || t.url || '');
    const safeUrl = escapeHtml(t.url || '');
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
          <div class="playback-item-title">${safeTitle}</div>
          <div class="playback-item-url">${safeUrl}</div>
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

function openNewPlaylistPrompt() {
  const name = prompt('Enter a name for the new playlist:');
  if (name && name.trim()) {
    const clean = name.trim();
    sendCommand({ action: 'playlist_create', name: clean });
    selectedPlaylistName = clean;
    showToast(`Created playlist "${clean}"`, 'library_add');
    setTimeout(() => updateStatus(), 200);
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
    showToast(`Renamed playlist to "${clean}"`, 'edit');
    setTimeout(() => {
      updateStatus();
      loadActivePlaylist(clean);
    }, 200);
  }
}

function deleteActivePlaylist() {
  if (!selectedPlaylistName) return;
  if (confirm(`Are you sure you want to delete playlist "${selectedPlaylistName}"?`)) {
    const target = selectedPlaylistName;
    sendCommand({ action: 'playlist_delete', playlist: target });
    showToast(`Deleted playlist "${target}"`, 'delete');
    selectedPlaylistName = null;
    setTimeout(() => updateStatus(), 200);
  }
}

function playActivePlaylist(shuffle = false) {
  if (!selectedPlaylistName) return;
  sendCommand({ action: 'playlist_play', playlist: selectedPlaylistName, shuffle });
  showToast(`Playing playlist "${selectedPlaylistName}" (${shuffle ? 'Shuffled' : 'Ordered'})`, shuffle ? 'shuffle' : 'play_arrow');
}

function queueActivePlaylist(shuffle = false) {
  if (!selectedPlaylistName) return;
  sendCommand({ action: 'playlist_queue', playlist: selectedPlaylistName, shuffle });
  showToast(`Queued playlist "${selectedPlaylistName}"`, 'queue');
}

function addTrackToActivePlaylist() {
  if (!selectedPlaylistName) return;
  const input = document.getElementById('playlist-add-input');
  const val = input.value.trim();
  if (!val) return;

  sendCommand({ action: 'playlist_add', playlist: selectedPlaylistName, url: val });
  input.value = '';
  showToast(`Adding track to "${selectedPlaylistName}"...`, 'playlist_add');
  setTimeout(() => loadActivePlaylist(selectedPlaylistName), 400);
}

function removePlaylistTrackItem(idx) {
  if (!selectedPlaylistName) return;
  sendCommand({ action: 'playlist_remove', playlist: selectedPlaylistName, index: idx });
  showToast('Removed track from playlist', 'close');
  setTimeout(() => loadActivePlaylist(selectedPlaylistName), 300);
}

function playSingleUrl(url) {
  sendCommand({ action: 'interrupt', url: url });
  showToast('Starting track playback...', 'play_arrow');
}

/* =========================================================================
   Universal Search Hub (Local Library & Web Results)
   ========================================================================= */
async function executeUniversalSearch() {
  const input = document.getElementById('universal-search-input');
  const q = input ? input.value.trim() : '';
  if (!q) return;

  const modal = document.getElementById('search-modal-overlay');
  const queryDisplay = document.getElementById('search-query-display');
  const localList = document.getElementById('search-local-list');
  const webList = document.getElementById('search-web-list');
  const localCount = document.getElementById('search-local-count');
  const webCount = document.getElementById('search-web-count');

  if (modal) modal.style.display = 'flex';
  if (queryDisplay) queryDisplay.innerText = `"${q}"`;

  if (localList) localList.innerHTML = '<div style="color: var(--text-dim); padding: 10px; font-size: 0.85rem;">Searching your local playlists & queue...</div>';
  if (webList) webList.innerHTML = '<div style="color: var(--text-dim); padding: 10px; font-size: 0.85rem;">Searching YouTube online...</div>';

  try {
    const res = await fetch(`/api/search?q=${encodeURIComponent(q)}&count=5&web=1`);
    if (!res.ok) throw new Error('Search failed');
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
    if (localList) localList.innerHTML = `<div style="color: var(--rose); padding: 10px;">Search error: ${escapeHtml(err.message)}</div>`;
    if (webList) webList.innerHTML = `<div style="color: var(--rose); padding: 10px;">Search error: ${escapeHtml(err.message)}</div>`;
  }
}

function closeSearchModal() {
  const modal = document.getElementById('search-modal-overlay');
  if (modal) modal.style.display = 'none';
}

function quickAddUrlToQueue(url, title = '') {
  sendCommand({ action: 'playback_add', url: url, title: title });
  showToast(`Added "${title || url}" to upcoming queue`, 'queue');
}

function addUrlToPlaylistPrompt(url, title = '') {
  if (currentPlaylists.length === 0) {
    const plName = prompt('Enter a name for a new playlist to save this track:');
    if (plName && plName.trim()) {
      sendCommand({ action: 'playlist_create', name: plName.trim() });
      setTimeout(() => {
        sendCommand({ action: 'playlist_add', playlist: plName.trim(), url: url, title: title });
        showToast(`Saved to playlist "${plName.trim()}"`, 'playlist_add');
      }, 250);
    }
    return;
  }

  const plNames = currentPlaylists.map(p => p.name).join('\n• ');
  const target = prompt(`Save track to which playlist?\nAvailable playlists:\n• ${plNames}`, selectedPlaylistName || currentPlaylists[0].name);
  if (target && target.trim()) {
    sendCommand({ action: 'playlist_add', playlist: target.trim(), url: url, title: title });
    showToast(`Saved to playlist "${target.trim()}"`, 'playlist_add');
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
