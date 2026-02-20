document.addEventListener('DOMContentLoaded', () => {
  const actionTypeSelect = document.getElementById('actionType');
  const startScanBtn = document.getElementById('startScanBtn');
  const startActionBtn = document.getElementById('startActionBtn');
  const stopBtn = document.getElementById('stopBtn');
  const scannedCount = document.getElementById('scannedCount');
  const actionCount = document.getElementById('actionCount');
  const logContainer = document.getElementById('logContainer');
  const statusText = document.getElementById('statusText');
  const statusDot = document.getElementById('statusDot');
  const exportLogsBtn = document.getElementById('exportLogsBtn');
  const exportTxtBtn = document.getElementById('exportTxtBtn');
  const clearLogsBtn = document.getElementById('clearLogsBtn');

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
  const skipNoPic = document.getElementById('skipNoPic');
  const autoLike = document.getElementById('autoLike');
  const autoStory = document.getElementById('autoStory');

  // Load state and settings from storage
  chrome.storage.local.get(['appState', 'settings', 'logs'], (data) => {
    if (data.settings) {
      minDelay.value = data.settings.minDelay || 5;
      maxDelay.value = data.settings.maxDelay || 10;
      dailyLimit.value = data.settings.dailyLimit || 100;
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
  actionTypeSelect.addEventListener('change', saveSettings);
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
      startActionBtn.style.display = 'flex';
      stopBtn.style.display = 'none';
      actionTypeSelect.disabled = false;

      startActionBtn.disabled = !state.scanned || state.scanned === 0;
    } else if (state.status === 'scanning') {
      statusText.textContent = 'Taranıyor...';
      statusDot.className = 'dot running';
      startScanBtn.style.display = 'none';
      startActionBtn.style.display = 'none';
      stopBtn.style.display = 'flex';
      actionTypeSelect.disabled = true;
    } else if (state.status === 'processing') {
      statusText.textContent = 'İşleniyor...';
      statusDot.className = 'dot running';
      startScanBtn.style.display = 'none';
      startActionBtn.style.display = 'none';
      stopBtn.style.display = 'flex';
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
    sendCommandToContentScripts('START_SCAN', {
      actionType: actionTypeSelect.value,
      settings: {
        skipPrivate: skipPrivate ? skipPrivate.checked : false,
        skipNoPic: skipNoPic ? skipNoPic.checked : false,
        whitelist: whitelist ? whitelist.value : '',
        blacklist: blacklist ? blacklist.value : ''
      }
    });
  });

  startActionBtn.addEventListener('click', () => {
    sendCommandToContentScripts('START_ACTION', {
      actionType: actionTypeSelect.value,
      settings: {
        minDelay: parseInt(minDelay.value, 10),
        maxDelay: parseInt(maxDelay.value, 10),
        dailyLimit: parseInt(dailyLimit.value, 10),
        skipPrivate: skipPrivate ? skipPrivate.checked : false,
        skipNoPic: skipNoPic ? skipNoPic.checked : false,
        autoLike: autoLike ? autoLike.checked : false,
        autoStory: autoStory ? autoStory.checked : false,
        whitelist: whitelist ? whitelist.value : '',
        blacklist: blacklist ? blacklist.value : ''
      }
    });
  });

  stopBtn.addEventListener('click', () => {
    sendCommandToContentScripts('STOP');
  });

  // Export & Clear Logs Buttons
  if (exportLogsBtn) {
    exportLogsBtn.addEventListener('click', () => {
      chrome.storage.local.get(['actionOutputLogs'], (result) => {
        const logs = result.actionOutputLogs || [];
        if (logs.length === 0) {
          alert("Dışa aktarılacak işlem geçmişi bulunamadı.");
          return;
        }

        let csvContent = "data:text/csv;charset=utf-8,\uFEFF"; // Add BOM for Excel UTF-8 support
        csvContent += "Tarih,Islem,Kullanici Adi,ID,Durum\n";

        logs.forEach(log => {
          let row = `"${log.date || ''}","${log.action || ''}","${log.username || ''}","${log.userId || ''}","${log.status || ''}"`;
          csvContent += row + "\n";
        });

        const encodedUri = encodeURI(csvContent);
        const link = document.createElement("a");
        link.setAttribute("href", encodedUri);

        // Format date string for filename
        const d = new Date();
        const dateStr = `${d.getFullYear()}${(d.getMonth() + 1).toString().padStart(2, '0')}${d.getDate().toString().padStart(2, '0')}_${d.getHours().toString().padStart(2, '0')}${d.getMinutes().toString().padStart(2, '0')}`;

        link.setAttribute("download", `instagrow_islem_gecmisi_${dateStr}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      });
    });
  }

  if (exportTxtBtn) {
    exportTxtBtn.addEventListener('click', () => {
      chrome.storage.local.get(['actionOutputLogs'], (result) => {
        const logs = result.actionOutputLogs || [];
        if (logs.length === 0) {
          alert("Dışa aktarılacak işlem geçmişi bulunamadı.");
          return;
        }

        let txtContent = "Tarih | İşlem | Kullanıcı Adı | ID | Durum\n";
        txtContent += "--------------------------------------------------------\n";

        logs.forEach(log => {
          let row = `${log.date || ''} | ${log.action || ''} | @${log.username || ''} | ${log.userId || ''} | ${log.status || ''}`;
          txtContent += row + "\n";
        });

        const encodedUri = "data:text/plain;charset=utf-8," + encodeURIComponent(txtContent);
        const link = document.createElement("a");
        link.setAttribute("href", encodedUri);

        // Format date string for filename
        const d = new Date();
        const dateStr = `${d.getFullYear()}${(d.getMonth() + 1).toString().padStart(2, '0')}${d.getDate().toString().padStart(2, '0')}_${d.getHours().toString().padStart(2, '0')}${d.getMinutes().toString().padStart(2, '0')}`;

        link.setAttribute("download", `instagrow_islem_gecmisi_${dateStr}.txt`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      });
    });
  }

  if (clearLogsBtn) {
    clearLogsBtn.addEventListener('click', () => {
      if (confirm("Tüm indirilebilir işlem geçmişini (CSV verisini) silmek istediğinize emin misiniz?")) {
        chrome.storage.local.set({ actionOutputLogs: [] }, () => {
          alert("Geçmiş başarıyla temizlendi.");
        });
      }
    });
  }
});
