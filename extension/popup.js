document.addEventListener('DOMContentLoaded', () => {
  const actionTypeSelect = document.getElementById('actionType');
  const startScanBtn = document.getElementById('startScanBtn');
  const stopBtn = document.getElementById('stopBtn');
  const scannedCount = document.getElementById('scannedCount');
  const actionCount = document.getElementById('actionCount');
  const logContainer = document.getElementById('logContainer');
  const statusText = document.getElementById('statusText');
  const statusDot = document.getElementById('statusDot');
  const refreshHashBtn = document.getElementById('refreshHashBtn');

  const minDelay = document.getElementById('minDelay');
  const maxDelay = document.getElementById('maxDelay');
  const dailyLimit = document.getElementById('dailyLimit');

  const whitelist = document.getElementById('whitelist');
  const blacklist = document.getElementById('blacklist');

  // Accordion Setup
  const accordions = document.querySelectorAll('.accordion-section');
  chrome.storage.local.get(['accordionState'], (result) => {
    const state = result.accordionState || {};
    accordions.forEach(acc => {
      // By default premium is collapsed inside HTML, others open. Override if saved state exists.
      if (state[acc.id] === 'collapsed') {
        acc.classList.add('collapsed');
      } else if (state[acc.id] === 'open') {
        acc.classList.remove('collapsed');
      }

      const header = acc.querySelector('.accordion-header');
      if (header) {
        header.addEventListener('click', () => {
          acc.classList.toggle('collapsed');

          // Save state
          chrome.storage.local.get(['accordionState'], (res) => {
            const currentState = res.accordionState || {};
            currentState[acc.id] = acc.classList.contains('collapsed') ? 'collapsed' : 'open';
            chrome.storage.local.set({ accordionState: currentState });
          });
        });
      }
    });
  });

  // Load state and settings from storage
  const skipPrivate = document.getElementById('skipPrivate');
  const skipNoPic = document.getElementById('skipNoPic');
  const autoLike = document.getElementById('autoLike');
  const autoStory = document.getElementById('autoStory');

  const searchCycleDelay = document.getElementById('searchCycleDelay');
  const searchCyclePauseDelay = document.getElementById('searchCyclePauseDelay');
  const unfollowDelay = document.getElementById('unfollowDelay');
  const unfollowPauseDelay = document.getElementById('unfollowPauseDelay');
  const maxFollowing = document.getElementById('maxFollowing');
  const maxFollowers = document.getElementById('maxFollowers');

  // Load state and settings from storage
  chrome.storage.local.get(['appState', 'settings', 'logs'], (data) => {
    if (data.settings) {
      minDelay.value = data.settings.minDelay || 5;
      maxDelay.value = data.settings.maxDelay || 10;
      dailyLimit.value = data.settings.dailyLimit || 100;
      if (searchCycleDelay) searchCycleDelay.value = data.settings.searchCycleDelay || 1500;
      if (searchCyclePauseDelay) searchCyclePauseDelay.value = data.settings.searchCyclePauseDelay || 5000;
      if (unfollowDelay) unfollowDelay.value = data.settings.unfollowDelay || 2000;
      if (unfollowPauseDelay) unfollowPauseDelay.value = data.settings.unfollowPauseDelay || 10000;
      if (maxFollowing) maxFollowing.value = data.settings.maxFollowing || 0;
      if (maxFollowers) maxFollowers.value = data.settings.maxFollowers || 0;
      if (data.settings.selectedAction) {
        actionTypeSelect.value = data.settings.selectedAction;
      }

      if (skipPrivate) skipPrivate.checked = data.settings.skipPrivate || false;
      if (skipNoPic) skipNoPic.checked = data.settings.skipNoPic || false;
      if (autoLike) autoLike.checked = data.settings.autoLike || false;
      if (autoStory) autoStory.checked = data.settings.autoStory || false;
      if (whitelist) whitelist.value = data.settings.whitelist || '';
      if (blacklist) blacklist.value = data.settings.blacklist || '';
    }

    if (data.logs) {
      data.logs.forEach(log => appendLog(log.msg, log.type));
    }

    if (data.appState) {
      updateUI(data.appState);
    }
  });

  // Save settings when changed
  const saveSettings = () => {
    chrome.storage.local.set({
      settings: {
        minDelay: parseInt(minDelay.value, 10),
        maxDelay: parseInt(maxDelay.value, 10),
        dailyLimit: parseInt(dailyLimit.value, 10),
        searchCycleDelay: parseInt(searchCycleDelay ? searchCycleDelay.value : 1500, 10),
        searchCyclePauseDelay: parseInt(searchCyclePauseDelay ? searchCyclePauseDelay.value : 5000, 10),
        unfollowDelay: parseInt(unfollowDelay ? unfollowDelay.value : 2000, 10),
        unfollowPauseDelay: parseInt(unfollowPauseDelay ? unfollowPauseDelay.value : 10000, 10),
        maxFollowing: parseInt(maxFollowing ? maxFollowing.value : 0, 10),
        maxFollowers: parseInt(maxFollowers ? maxFollowers.value : 0, 10),
        selectedAction: actionTypeSelect.value,
        skipPrivate: skipPrivate ? skipPrivate.checked : false,
        skipNoPic: skipNoPic ? skipNoPic.checked : false,
        autoLike: autoLike ? autoLike.checked : false,
        autoStory: autoStory ? autoStory.checked : false,
        whitelist: whitelist ? whitelist.value : '',
        blacklist: blacklist ? blacklist.value : ''
      }
    });
  };
  minDelay.addEventListener('change', saveSettings);
  maxDelay.addEventListener('change', saveSettings);
  dailyLimit.addEventListener('change', saveSettings);
  if (searchCycleDelay) searchCycleDelay.addEventListener('change', saveSettings);
  if (searchCyclePauseDelay) searchCyclePauseDelay.addEventListener('change', saveSettings);
  if (unfollowDelay) unfollowDelay.addEventListener('change', saveSettings);
  if (unfollowPauseDelay) unfollowPauseDelay.addEventListener('change', saveSettings);
  if (maxFollowing) maxFollowing.addEventListener('change', saveSettings);
  if (maxFollowers) maxFollowers.addEventListener('change', saveSettings);
  // Aksiyon bilgi mesajları
  const actionInfoBox = document.getElementById('actionInfoBox');
  const actionInfoMap = {
    unfollow_nonfollowers: {
      color: '#f59e0b',
      bg: 'rgba(245,158,11,0.08)',
      border: 'rgba(245,158,11,0.3)',
      text: '📋 Tüm Liste Modu: Şu an takip ettiğin herkesi tarar, takipçi listende olmayanları gösterir. Limit ayarlarına dikkat edin.'
    },
    unfollow_nonfollowers_tracked: {
      color: '#10b981',
      bg: 'rgba(16,185,129,0.08)',
      border: 'rgba(16,185,129,0.3)',
      text: '🕐 Takip Geçmişi Modu: Sadece bu uygulama ile takip ettiğin kişileri tarar. Seni geri takip etmeyenler listelenir. Takip geçmişi yoksa liste boş gelir.'
    },
    unfollow_followers: {
      color: '#ef4444',
      bg: 'rgba(239,68,68,0.08)',
      border: 'rgba(239,68,68,0.3)',
      text: '⚠️ Dikkat: Bu mod seni takip eden kişileri çıkarır. Takipçi sayınız azalır.'
    },
    unfollow_private: {
      color: '#8b92a5',
      bg: 'rgba(139,146,165,0.08)',
      border: 'rgba(139,146,165,0.3)',
      text: '🔒 Gizli Hesap Modu: Takip ettiğin gizli (private) hesapları listeler ve çıkarmanıza olanak tanır.'
    }
  };

  function updateActionInfo(val) {
    if (!actionInfoBox) return;
    const info = actionInfoMap[val];
    if (info) {
      actionInfoBox.style.display = 'block';
      actionInfoBox.style.color = info.color;
      actionInfoBox.style.background = info.bg;
      actionInfoBox.style.borderColor = info.border;
      actionInfoBox.textContent = info.text;
    } else {
      actionInfoBox.style.display = 'none';
    }
  }

  updateActionInfo(actionTypeSelect.value);
  actionTypeSelect.addEventListener('change', () => {
    updateActionInfo(actionTypeSelect.value);
    saveSettings();
  });
  if (skipPrivate) skipPrivate.addEventListener('change', saveSettings);
  if (skipNoPic) skipNoPic.addEventListener('change', saveSettings);
  if (autoLike) autoLike.addEventListener('change', saveSettings);
  if (autoStory) autoStory.addEventListener('change', saveSettings);
  if (whitelist) whitelist.addEventListener('input', saveSettings);
  if (blacklist) blacklist.addEventListener('input', saveSettings);

  function appendLog(msg, type = 'info') {
    const div = document.createElement('div');
    div.className = `log-entry log-${type}`;
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    div.textContent = `[${time}] ${msg}`;
    logContainer.appendChild(div);
    logContainer.scrollTop = logContainer.scrollHeight;
  }

  function updateUI(state) {
    scannedCount.textContent = state.scanned || 0;
    actionCount.textContent = state.processed || 0;

    if (state.status === 'idle') {
      statusText.textContent = 'Hazır';
      statusDot.className = 'dot';
      startScanBtn.style.display = 'flex';
      stopBtn.style.display = 'none';
      stopBtn.disabled = false;
      actionTypeSelect.disabled = false;
    } else if (state.status === 'scanning') {
      statusText.textContent = 'Taranıyor...';
      statusDot.className = 'dot running';
      startScanBtn.style.display = 'none';
      stopBtn.style.display = 'flex';
      stopBtn.disabled = false;
      actionTypeSelect.disabled = true;
    } else if (state.status === 'processing') {
      statusText.textContent = 'İşleniyor...';
      statusDot.className = 'dot running';
      startScanBtn.style.display = 'none';
      stopBtn.style.display = 'flex';
      stopBtn.disabled = false;
      actionTypeSelect.disabled = true;
    }
  }

  // Listen for real-time updates from background/content
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'UPDATE_STATE') {
      updateUI(message.state);
    } else if (message.type === 'LOG') {
      appendLog(message.msg, message.logType);
    }
  });

  function sendCommandToContentScripts(actionMsg, payload = {}) {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      if (!tabs[0] || !tabs[0].url.includes('instagram.com')) {
        appendLog('Lütfen önce bir Instagram sayfası açın!', 'error');
        return;
      }
      chrome.tabs.sendMessage(tabs[0].id, {
        action: actionMsg,
        ...payload
      });
    });
  }

  // Action Buttons
  startScanBtn.addEventListener('click', () => {
    const actionType = actionTypeSelect.value;
    sendCommandToContentScripts('START_SCAN', {
      actionType,
      settings: {
        skipPrivate: skipPrivate ? skipPrivate.checked : false,
        skipNoPic: skipNoPic ? skipNoPic.checked : false,
        whitelist: whitelist ? whitelist.value : '',
        blacklist: blacklist ? blacklist.value : '',
        searchCycleDelay: parseInt(searchCycleDelay ? searchCycleDelay.value : 1500, 10),
        searchCyclePauseDelay: parseInt(searchCyclePauseDelay ? searchCyclePauseDelay.value : 5000, 10),
        maxFollowing: parseInt(maxFollowing ? maxFollowing.value : 0, 10),
        maxFollowers: parseInt(maxFollowers ? maxFollowers.value : 0, 10)
      }
    });
  });

  stopBtn.addEventListener('click', () => {
    sendCommandToContentScripts('STOP');
  });

  // Listeyi Gör Butonu
  const openListBtn = document.getElementById('openListBtn');
  if (openListBtn) {
    openListBtn.addEventListener('click', () => {
      chrome.tabs.create({ url: chrome.runtime.getURL('list.html') });
    });
  }

  // Hash Güncelleme Butonu
  if (refreshHashBtn) {
    refreshHashBtn.addEventListener('click', async () => {
      refreshHashBtn.disabled = true;
      const originalText = refreshHashBtn.innerHTML;
      refreshHashBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right: 2px; animation: spin 1s linear infinite;"><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36M20.49 15a9 9 0 0 1-14.85 3.36"></path></svg>Güncelleniyor...';
      try {
        chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
          if (!tabs[0]) {
            appendLog('Aktif sekme bulunamadı.', 'error');
            refreshHashBtn.disabled = false;
            refreshHashBtn.innerHTML = originalText;
            return;
          }
          chrome.tabs.sendMessage(tabs[0].id, { action: 'REFRESH_HASHES' }, (response) => {
            if (chrome.runtime.lastError) {
              appendLog('Content script\'e bağlanılamadı. Sayfayı yenileyip tekrar deneyin.', 'error');
            } else if (response && response.success) {
              appendLog('Query hash\'leri başarıyla güncellendi!', 'success');
            } else {
              appendLog('Hash güncelleme başarısız. Fallback hash\'ler kullanılıyor.', 'warn');
            }
            refreshHashBtn.disabled = false;
            refreshHashBtn.innerHTML = originalText;
          });
        });
      } catch (e) {
        appendLog(`Hash güncelleme hatası: ${e.message}`, 'error');
        refreshHashBtn.disabled = false;
        refreshHashBtn.innerHTML = originalText;
      }
    });
  }

  const clearVisibleLogsBtn = document.getElementById('clearVisibleLogsBtn');
  if (clearVisibleLogsBtn) {
    clearVisibleLogsBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      logContainer.innerHTML = '';
      chrome.storage.local.set({ logs: [] });
    });
  }
});
