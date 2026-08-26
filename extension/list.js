// InstaGrow - List Page Script

let allUsers = [];
let followingList = [];
let followersList = [];
let actionType = '';
let sortKey = 'username';
let sortAsc = true;
let currentView = 'dual'; // 'dual' | 'list'

function showToast(msg, type = 'success') {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 4500);
}

// Load data
chrome.storage.local.get(['nonFollowers', 'followingList', 'followersList', 'listActionType'], (data) => {
  followingList = data.followingList || [];
  followersList = data.followersList || [];
  actionType = data.listActionType || '';

  const labelMap = {
    unfollow_nonfollowers: 'Geri Takip Etmeyenleri Çıkar (Tüm Liste)',
    unfollow_nonfollowers_tracked: '🕐 Geri Takip Etmeyenler (Takip Geçmişi)',
    unfollow_followers: 'Geri Takip Edenleri Çıkar',
    unfollow_private: 'Gizli Hesapları Çıkar',
    follow_followers: 'Takipçileri Takip Et',
    follow_following: 'Takip Edilenleri Takip Et',
    follow_likers: 'Beğenenleri Takip Et',
    follow_commenters: 'Yorum Yapanları Takip Et',
  };
  document.getElementById('actionTypeLabel').innerHTML = `İşlem: <span>${labelMap[actionType] || actionType}</span>`;

  // unfollow_nonfollowers ve unfollow_followers için: following/followers listelerinden hesapla
  if ((actionType === 'unfollow_nonfollowers' || actionType === 'unfollow_followers') && followingList.length > 0) {
    const followerIdSet = new Set(followersList.map(u => String(u.id)));
    const sourceList = followingList.filter(u => {
      const isFollowingBack = followerIdSet.has(String(u.id));
      if (actionType === 'unfollow_nonfollowers') return !isFollowingBack;
      if (actionType === 'unfollow_followers') return isFollowingBack;
      return true;
    });
    allUsers = sourceList.map((u, i) => ({
      ...u,
      is_following_back: followerIdSet.has(String(u.id)),
      _selected: true, _excluded: false, _note: '', _index: i
    }));
  } else {
    // tracked mod ve diğerleri: content.js'den gelen listeyi kullan (zaten hesaplanmış)
    allUsers = (data.nonFollowers || []).map((u, i) => ({
      ...u, _selected: true, _excluded: false, _note: '', _index: i
    }));
  }

  // dual view sadece tam liste modlarında anlamlı
  if (actionType !== 'unfollow_nonfollowers' && actionType !== 'unfollow_followers') {
    switchView('list');
  }

  renderDual();
  renderList();
  updateCounts();
});

// ─── DUAL VIEW ───────────────────────────────────────────────────────────────

function renderDual() {
  const followerIds = new Set(followersList.map(u => String(u.id)));

  renderPanel('followingList', followingList, followerIds, true,
    document.getElementById('searchFollowing').value.toLowerCase());
  renderPanel('followersList', followersList, new Set(followingList.map(u => String(u.id))), false,
    document.getElementById('searchFollowers').value.toLowerCase());

  document.getElementById('followingCount').textContent = `(${followingList.length})`;
  document.getElementById('followersCount').textContent = `(${followersList.length})`;
}

function renderPanel(containerId, users, matchSet, showMatchBadge, query) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const filtered = query
    ? users.filter(u => u.username.toLowerCase().includes(query))
    : users;

  if (filtered.length === 0) {
    container.innerHTML = '<div class="empty-state"><p>Veri yok</p></div>';
    return;
  }

  let html = '';
  filtered.forEach((u, i) => {
    const isMatched = matchSet.has(String(u.id));
    const hasNoPic = !u.profile_pic_url || u.profile_pic_url.includes('default_v0') || u.profile_pic_url === '';
    const avatarHtml = hasNoPic
      ? `<div class="avatar-placeholder">👤</div>`
      : `<img class="avatar" data-src="${u.profile_pic_url.replace(/&amp;/g, '&')}" alt="">`;

    html += `
      <div class="user-row ${isMatched ? 'matched' : ''}" data-id="${u.id}">
        <span class="num">${i + 1}</span>
        ${avatarHtml}
        <div class="user-info">
          <div class="user-name">
            <a href="https://www.instagram.com/${u.username}/" target="_blank">@${u.username}</a>
          </div>
          <div class="user-id">${u.id}</div>
        </div>
        ${isMatched && showMatchBadge ? '<span class="match-badge">✓ Takip Ediyor</span>' : ''}
      </div>`;
  });

  container.innerHTML = html;

  // Avatar lazy load
  container.querySelectorAll('img.avatar[data-src]').forEach(img => {
    loadAvatar(img, img.dataset.src);
  });
}

// ─── LIST VIEW ────────────────────────────────────────────────────────────────

const tableBody = document.getElementById('tableBody');
const searchInput = document.getElementById('searchInput');
const filterPrivate = document.getElementById('filterPrivate');
const filterFollowBack = document.getElementById('filterFollowBack');
const filterExcluded = document.getElementById('filterExcluded');
const visibleCount = document.getElementById('visibleCount');

function getFiltered() {
  const q = searchInput.value.trim().toLowerCase();
  const priv = filterPrivate.value;
  const fb = filterFollowBack.value;
  const excl = filterExcluded.value;

  return allUsers.filter(u => {
    if (q && !u.username.toLowerCase().includes(q)) return false;
    if (priv === 'private' && !u.is_private) return false;
    if (priv === 'public' && u.is_private) return false;
    if (fb === 'yes' && u.is_following_back !== true) return false;
    if (fb === 'no' && u.is_following_back !== false) return false;
    if (excl === 'active' && u._excluded) return false;
    if (excl === 'excluded' && !u._excluded) return false;
    return true;
  }).sort((a, b) => {
    let va = a[sortKey] ?? '', vb = b[sortKey] ?? '';
    if (typeof va === 'boolean') va = va ? 1 : 0;
    if (typeof vb === 'boolean') vb = vb ? 1 : 0;
    if (va < vb) return sortAsc ? -1 : 1;
    if (va > vb) return sortAsc ? 1 : -1;
    return 0;
  });
}

// Tarama listesi boşsa işlem geçmişini rapor olarak göster
function renderHistoryFallback(emptyState) {
  chrome.storage.local.get(['actionOutputLogs'], (result) => {
    const logs = result.actionOutputLogs || [];
    if (logs.length === 0) {
      emptyState.innerHTML = '<h2>Liste boş</h2><p>Önce popup\'tan bir tarama başlatın.</p>';
      return;
    }

    // Özet: işlem türüne göre sayılar
    const counts = {};
    logs.forEach(l => { counts[l.action] = (counts[l.action] || 0) + 1; });
    const summaryHtml = Object.entries(counts)
      .map(([action, count]) => `<span style="display:inline-block;margin:4px 8px;padding:6px 12px;background:rgba(255,255,255,0.06);border-radius:8px;font-size:13px;">${action}: <strong>${count}</strong></span>`)
      .join('');

    // Son işlemler en üstte, en fazla 300 satır göster
    const recent = logs.slice(-300).reverse();
    const rowsHtml = recent.map((l, i) => `
      <tr style="border-bottom:1px solid rgba(255,255,255,0.05);">
        <td style="padding:6px 10px;color:var(--muted);font-size:12px;text-align:center;">${i + 1}</td>
        <td style="padding:6px 10px;font-size:13px;">${l.action}</td>
        <td style="padding:6px 10px;"><a href="https://www.instagram.com/${l.username}/" target="_blank" style="color:#3b82f6;text-decoration:none;font-size:13px;">@${l.username}</a></td>
        <td style="padding:6px 10px;font-size:12px;">${l.status === 'Başarılı' ? '✅' : '❌'} ${l.status}</td>
        <td style="padding:6px 10px;color:var(--muted);font-size:12px;white-space:nowrap;">${l.date || '—'}</td>
      </tr>`).join('');

    emptyState.innerHTML = `
      <h2 style="margin-bottom:6px;">İşlem Geçmişi Raporu</h2>
      <p style="margin-bottom:10px;">Tarama listesi boş; aşağıda son işlemler gösteriliyor (toplam ${logs.length} kayıt).</p>
      <div style="margin-bottom:14px;">${summaryHtml}</div>
      <div style="max-height:65vh;overflow-y:auto;border:1px solid rgba(255,255,255,0.08);border-radius:10px;">
        <table style="width:100%;border-collapse:collapse;text-align:left;">
          <thead>
            <tr style="position:sticky;top:0;background:#1a1d27;border-bottom:1px solid rgba(255,255,255,0.1);">
              <th style="padding:8px 10px;font-size:12px;">#</th>
              <th style="padding:8px 10px;font-size:12px;">İşlem</th>
              <th style="padding:8px 10px;font-size:12px;">Kullanıcı</th>
              <th style="padding:8px 10px;font-size:12px;">Durum</th>
              <th style="padding:8px 10px;font-size:12px;">Tarih</th>
            </tr>
          </thead>
          <tbody>${rowsHtml}</tbody>
        </table>
      </div>`;
  });
}

function renderList() {
  const filtered = getFiltered();
  visibleCount.textContent = filtered.length;
  const emptyState = document.getElementById('emptyState');
  const userTable = document.getElementById('userTable');
  const isTracked = actionType === 'unfollow_nonfollowers_tracked';

  // Takip tarihi sütununu göster/gizle
  const thFollowedAt = document.getElementById('thFollowedAt');
  if (thFollowedAt) thFollowedAt.style.display = isTracked ? '' : 'none';

  if (allUsers.length === 0) {
    emptyState.style.display = 'block';
    userTable.style.display = 'none';
    renderHistoryFallback(emptyState);
    return;
  }
  emptyState.style.display = 'none';
  userTable.style.display = 'table';

  tableBody.innerHTML = '';
  filtered.forEach((u, visIdx) => {
    const tr = document.createElement('tr');
    if (u._selected && !u._excluded) tr.classList.add('selected');
    if (u._excluded) tr.classList.add('excluded');

    const hasNoPic = !u.profile_pic_url || u.profile_pic_url.includes('default_v0') || u.profile_pic_url === '';
    const avatarHtml = hasNoPic
      ? `<div class="avatar-placeholder">👤</div>`
      : `<img class="avatar" data-src="${u.profile_pic_url}" alt="">`;

    const followedAtCell = isTracked
      ? `<td style="font-size:11px;color:var(--muted);white-space:nowrap">${u.followedAt ? new Date(u.followedAt).toLocaleString('tr-TR', {day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}) : '—'}</td>`
      : '';

    tr.innerHTML = `
      <td><input type="checkbox" data-idx="${u._index}" ${u._selected && !u._excluded ? 'checked' : ''}></td>
      <td style="color:var(--muted);text-align:center;font-size:12px">${visIdx + 1}</td>
      <td>${avatarHtml}</td>
      <td>
        <div class="username-cell">
          <a class="username-link" href="https://www.instagram.com/${u.username}/" target="_blank">@${u.username}</a>
        </div>
      </td>
      <td style="font-family:monospace;font-size:11px;color:var(--muted)">${u.id || '-'}</td>
      <td>${u.is_private ? '<span class="tag tag-private">🔒 Gizli</span>' : '<span class="tag tag-public">🌐 Açık</span>'}</td>
      <td>${u.is_following_back === true ? '<span class="tag tag-public">✅ Ediyor</span>' : u.is_following_back === false ? '<span class="tag tag-private">❌ Etmiyor</span>' : '<span class="tag tag-nopic">—</span>'}</td>
      ${followedAtCell}
      <td><input class="note-input" type="text" placeholder="Not..." data-idx="${u._index}" value="${u._note || ''}"></td>
      <td><button class="exclude-btn ${u._excluded ? 'excluded' : ''}" data-idx="${u._index}">${u._excluded ? 'Dahil Et' : 'Hariç Tut'}</button></td>
      <td><button class="remove-btn" data-idx="${u._index}" title="Kaldır">🗑️</button></td>
      <td><button class="manual-action-btn follow" data-userid="${u.id}" data-action="follow">+ Takip Et</button></td>
    `;
    tableBody.appendChild(tr);

    if (!hasNoPic) {
      const img = tr.querySelector('img.avatar');
      if (img) loadAvatar(img, img.dataset.src || u.profile_pic_url || '');
    }
  });

  tableBody.querySelectorAll('input[type="checkbox"]').forEach(cb => {
    cb.addEventListener('change', e => {
      allUsers[parseInt(e.target.dataset.idx)]._selected = e.target.checked;
      updateCounts();
    });
  });
  tableBody.querySelectorAll('.note-input').forEach(inp => {
    inp.addEventListener('input', e => {
      allUsers[parseInt(e.target.dataset.idx)]._note = e.target.value;
    });
  });
  tableBody.querySelectorAll('.exclude-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      const idx = parseInt(e.target.dataset.idx);
      allUsers[idx]._excluded = !allUsers[idx]._excluded;
      if (allUsers[idx]._excluded) allUsers[idx]._selected = false;
      renderList(); updateCounts();
    });
  });
  tableBody.querySelectorAll('.remove-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      allUsers.splice(parseInt(e.target.dataset.idx), 1);
      allUsers.forEach((u, i) => { u._index = i; });
      renderList(); updateCounts();
    });
  });
  tableBody.querySelectorAll('.manual-action-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      const b = e.currentTarget;
      manualAction(b.dataset.userid, b.dataset.action, b);
    });
  });
}

// ─── AVATAR ──────────────────────────────────────────────────────────────────

let avatarQueue = [], avatarLoading = 0;
const AVATAR_CONCURRENCY = 5;

function processAvatarQueue() {
  while (avatarLoading < AVATAR_CONCURRENCY && avatarQueue.length > 0) {
    const { img, url } = avatarQueue.shift();
    avatarLoading++;
    chrome.runtime.sendMessage({ type: 'FETCH_IMAGE', url }, res => {
      avatarLoading--;
      if (res && res.dataUrl && img.isConnected) {
        img.src = res.dataUrl;
        bindAvatarZoom(img);
      }
      processAvatarQueue();
    });
  }
}

function loadAvatar(img, url) {
  if (!url || url.includes('default_v0') || url === '') return;
  avatarQueue.push({ img, url: url.replace(/&amp;/g, '&') });
  processAvatarQueue();
}

// ─── MANUEL FOLLOW/UNFOLLOW ──────────────────────────────────────────────────

function manualAction(userId, action, btn) {
  btn.disabled = true;
  btn.textContent = '...';
  chrome.runtime.sendMessage({ type: 'MANUAL_FOLLOW_ACTION', userId, action }, (res) => {
    if (res && res.ok) {
      if (action === 'follow') {
        btn.textContent = '✓ Takip';
        btn.className = 'manual-action-btn unfollow';
        btn.dataset.action = 'unfollow';
      } else {
        btn.textContent = '+ Takip Et';
        btn.className = 'manual-action-btn follow';
        btn.dataset.action = 'follow';
      }
      btn.disabled = false;
      showToast(action === 'follow' ? '✅ Takip edildi.' : '🚫 Takipten çıkıldı.');
    } else {
      btn.disabled = false;
      btn.textContent = action === 'follow' ? '+ Takip Et' : '✓ Takip';
      showToast('Hata: Instagram sekmesi açık olmalı.', 'error');
    }
  });
}

// ─── AVATAR LIGHTBOX ─────────────────────────────────────────────────────────

const lightbox = document.getElementById('avatarLightbox');
const lbImg = document.getElementById('lbImg');
const lbName = document.getElementById('lbName');
let lbHideTimer = null;

function showLightbox(src, username) {
  clearTimeout(lbHideTimer);
  lbImg.src = src;
  lbName.textContent = username || '';
  lightbox.style.display = 'flex';
}

function hideLightbox() {
  lbHideTimer = setTimeout(() => { lightbox.style.display = 'none'; }, 80);
}

lightbox.addEventListener('mouseenter', () => clearTimeout(lbHideTimer));
lightbox.addEventListener('mouseleave', hideLightbox);
lightbox.addEventListener('click', () => { lightbox.style.display = 'none'; });

function bindAvatarZoom(img) {
  img.addEventListener('mouseenter', () => {
    if (!img.src || img.src === window.location.href) return;
    const row = img.closest('[data-id], tr');
    const link = row ? row.querySelector('a') : null;
    showLightbox(img.src, link ? link.textContent.trim() : '');
  });
  img.addEventListener('mouseleave', hideLightbox);
}

// ─── VIEW SWITCH ─────────────────────────────────────────────────────────────

function switchView(view) {
  currentView = view;
  document.getElementById('dualView').classList.toggle('hidden', view !== 'dual');
  document.getElementById('listView').classList.toggle('active', view === 'list');
  document.getElementById('tabDual').classList.toggle('active', view === 'dual');
  document.getElementById('tabList').classList.toggle('active', view === 'list');
}

document.getElementById('tabDual').addEventListener('click', () => switchView('dual'));
document.getElementById('tabList').addEventListener('click', () => switchView('list'));

// ─── COUNTS & BUTTONS ────────────────────────────────────────────────────────

function updateCounts() {
  document.getElementById('totalCount').textContent = allUsers.length;
  document.getElementById('selectedCount').textContent = allUsers.filter(u => u._selected && !u._excluded).length;
  document.getElementById('excludedCount').textContent = allUsers.filter(u => u._excluded).length;
  const sel = allUsers.filter(u => u._selected && !u._excluded).length;
  const btn = document.getElementById('startActionBtn');
  btn.disabled = sel === 0;
  btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg> İşlemi Başlat (${sel})`;
}

// Sort
document.querySelectorAll('thead th[data-sort]').forEach(th => {
  th.addEventListener('click', () => {
    const key = th.dataset.sort;
    if (sortKey === key) sortAsc = !sortAsc; else { sortKey = key; sortAsc = true; }
    document.querySelectorAll('thead th').forEach(t => t.classList.remove('sorted'));
    th.classList.add('sorted');
    renderList();
  });
});

// Filters
searchInput.addEventListener('input', renderList);
filterPrivate.addEventListener('change', renderList);
filterFollowBack.addEventListener('change', renderList);
filterExcluded.addEventListener('change', renderList);

// Panel search
document.getElementById('searchFollowing').addEventListener('input', renderDual);
document.getElementById('searchFollowers').addEventListener('input', renderDual);

// Check all
document.getElementById('checkAll').addEventListener('change', e => {
  getFiltered().forEach(u => { if (!u._excluded) u._selected = e.target.checked; });
  renderList(); updateCounts();
});

document.getElementById('selectAllBtn').addEventListener('click', () => {
  allUsers.forEach(u => { if (!u._excluded) u._selected = true; });
  renderList(); updateCounts();
});
document.getElementById('deselectAllBtn').addEventListener('click', () => {
  allUsers.forEach(u => { u._selected = false; });
  renderList(); updateCounts();
});
document.getElementById('removeSelectedBtn').addEventListener('click', () => {
  const count = allUsers.filter(u => u._selected && !u._excluded).length;
  if (!count) return;
  allUsers = allUsers.filter(u => !(u._selected && !u._excluded));
  allUsers.forEach((u, i) => { u._index = i; });
  renderList(); updateCounts();
  showToast(`${count} kişi listeden kaldırıldı.`);
});

document.getElementById('saveBtn').addEventListener('click', () => {
  chrome.storage.local.set({ nonFollowers: allUsers }, () => showToast('Liste kaydedildi.'));
});

document.getElementById('startActionBtn').addEventListener('click', () => {
  const selected = allUsers.filter(u => u._selected && !u._excluded);
  if (!selected.length) return;
  const cleanList = selected.map(u => ({ id: u.id, username: u.username, is_private: u.is_private, profile_pic_url: u.profile_pic_url }));
  chrome.storage.local.get(['settings'], (data) => {
    const settings = data.settings || {};
    chrome.storage.local.set({ nonFollowers: cleanList }, () => {
      const payload = {
        action: 'START_ACTION',
        actionType,
        settings: {
          minDelay: settings.minDelay || 5,
          maxDelay: settings.maxDelay || 10,
          dailyLimit: settings.dailyLimit || 100,
          searchCycleDelay: settings.searchCycleDelay || 1500,
          searchCyclePauseDelay: settings.searchCyclePauseDelay || 5000,
          unfollowDelay: settings.unfollowDelay || 2000,
          unfollowPauseDelay: settings.unfollowPauseDelay || 10000,
          skipPrivate: settings.skipPrivate || false,
          skipNoPic: settings.skipNoPic || false,
          autoLike: settings.autoLike || false,
          autoStory: settings.autoStory || false,
          whitelist: settings.whitelist || '',
          blacklist: settings.blacklist || ''
        }
      };
      // Background üzerinden relay et — content script yoksa otomatik inject eder
      chrome.runtime.sendMessage({ type: 'RELAY_TO_INSTAGRAM', payload }, (res) => {
        if (!res || res.error) {
          const msg = res?.error === 'no_tab'
            ? 'Açık bir Instagram sekmesi bulunamadı. instagram.com\'u açıp tekrar deneyin.'
            : 'Instagram sekmesine bağlanılamadı. Instagram sekmesini yenileyip tekrar deneyin.';
          showToast(msg, 'error');
        } else {
          showToast(`${selected.length} kişi için işlem başlatıldı.`);
          document.getElementById('startActionBtn').disabled = true;
        }
      });
    });
  });
});

// ─── ACTION PROGRESS & RESULT ────────────────────────────────────────────────

const progressBand = document.getElementById('progressBand');
const progressBandText = document.getElementById('progressBandText');
const progressBarFill = document.getElementById('progressBarFill');
const progressCount = document.getElementById('progressCount');
const resultModal = document.getElementById('resultModal');

document.getElementById('resultCloseBtn').addEventListener('click', () => {
  resultModal.classList.remove('open');
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'ACTION_PROGRESS') {
    const { actionName, username, processed, total } = msg;
    const pct = total > 0 ? Math.round((processed / total) * 100) : 0;
    progressBand.classList.add('active');
    progressBandText.innerHTML = `<span class="prog-action">${actionName}</span>: <span class="prog-user">@${username}</span> işlendi`;
    progressBarFill.style.width = pct + '%';
    progressCount.textContent = `${processed} / ${total}`;

    // Tablodaki ilgili satırın manuel butonunu güncelle
    const btn = tableBody.querySelector(`.manual-action-btn[data-userid="${msg.userId}"]`);
    if (btn) {
      const isFollow = actionName === 'Takip Etme';
      btn.textContent = isFollow ? '✓ Takip' : '+ Takip Et';
      btn.className = `manual-action-btn ${isFollow ? 'unfollow' : 'follow'}`;
      btn.dataset.action = isFollow ? 'unfollow' : 'follow';
    }
  }

  if (msg.type === 'ACTION_COMPLETE') {
    progressBand.classList.remove('active');
    const { processed, total, stopped } = msg;
    document.getElementById('resultIcon').textContent = stopped ? '⏹️' : '✅';
    document.getElementById('resultTitle').textContent = stopped ? 'İşlem Durduruldu' : 'İşlem Tamamlandı';
    document.getElementById('resultStat').textContent = processed;
    document.getElementById('resultDesc').textContent = stopped
      ? `İşlem manuel olarak durduruldu. Toplam ${processed} kullanıcı işlendi.`
      : `${total} kullanıcıdan ${processed} tanesi başarıyla işlendi.`;
    resultModal.classList.add('open');
  }
});

// ─── EXPORT & CLEAR ──────────────────────────────────────────────────────────

function getDateStr() {
  const d = new Date();
  return `${d.getFullYear()}${(d.getMonth()+1).toString().padStart(2,'0')}${d.getDate().toString().padStart(2,'0')}_${d.getHours().toString().padStart(2,'0')}${d.getMinutes().toString().padStart(2,'0')}`;
}

document.getElementById('exportCsvBtn').addEventListener('click', () => {
  chrome.storage.local.get(['actionOutputLogs'], (result) => {
    const logs = result.actionOutputLogs || [];
    if (!logs.length) { showToast('Dışa aktarılacak işlem geçmişi bulunamadı.', 'error'); return; }
    let csv = "data:text/csv;charset=utf-8,\uFEFF";
    csv += "Tarih,Islem,Kullanici Adi,ID,Durum\n";
    logs.forEach(l => { csv += `"${l.date||''}","${l.action||''}","${l.username||''}","${l.userId||''}","${l.status||''}"\n`; });
    const a = document.createElement('a');
    a.href = encodeURI(csv);
    a.download = `instagrow_islem_gecmisi_${getDateStr()}.csv`;
    a.click();
  });
});

document.getElementById('exportTxtBtn').addEventListener('click', () => {
  chrome.storage.local.get(['actionOutputLogs'], (result) => {
    const logs = result.actionOutputLogs || [];
    if (!logs.length) { showToast('Dışa aktarılacak işlem geçmişi bulunamadı.', 'error'); return; }
    let txt = "Tarih | İşlem | Kullanıcı Adı | ID | Durum\n";
    txt += "--------------------------------------------------------\n";
    logs.forEach(l => { txt += `${l.date||''} | ${l.action||''} | @${l.username||''} | ${l.userId||''} | ${l.status||''}\n`; });
    const a = document.createElement('a');
    a.href = "data:text/plain;charset=utf-8," + encodeURIComponent(txt);
    a.download = `instagrow_islem_gecmisi_${getDateStr()}.txt`;
    a.click();
  });
});

document.getElementById('exportJsonBtn').addEventListener('click', () => {
  chrome.storage.local.get(['actionOutputLogs'], (result) => {
    const logs = result.actionOutputLogs || [];
    if (!logs.length) { showToast('Dışa aktarılacak işlem geçmişi bulunamadı.', 'error'); return; }
    const a = document.createElement('a');
    a.href = "data:application/json;charset=utf-8," + encodeURIComponent(JSON.stringify(logs, null, 2));
    a.download = `instagrow_islem_gecmisi_${getDateStr()}.json`;
    a.click();
  });
});

document.getElementById('clearLogsBtn').addEventListener('click', () => {
  if (confirm("Tüm işlem geçmişini silmek istediğinize emin misiniz?")) {
    chrome.storage.local.set({ actionOutputLogs: [] }, () => showToast('Geçmiş başarıyla temizlendi.'));
  }
});
