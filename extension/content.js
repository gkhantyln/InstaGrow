// Çift enjeksiyon koruması: script zaten yüklüyse ikinci kopya hiçbir şey yapmasın
if (window.__instagrowLoaded) {
    throw new Error('InstaGrow content script zaten yüklü.');
}
window.__instagrowLoaded = true;

let isRunning = false;
let appState = { status: 'idle', scanned: 0, unfollowed: 0 };
let nonFollowers = []; // List of user IDs

// Query Hash Cache
let queryHashCache = {
    follow_following: null,
    follow_followers: null,
    follow_commenters: null,
    lastUpdated: null
};

// Dinamik Query Hash Çekme Sistemi
async function extractQueryHashesFromInstagram() {
    try {
        log('Query hash\'leri Instagram\'dan çekiliyor...', 'info');

        // Timeout ile fetch
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 8000); // 8 saniye timeout

        // Tarayıcının kendi User-Agent'ı kullanılır — sahte UA oturumun şüpheli işaretlenmesine yol açabilir
        const res = await fetch('https://www.instagram.com/', {
            signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (!res.ok) throw new Error('Instagram sayfası yüklenemedi');

        let html = await res.text();

        // HTML'de tüm hash'leri ara
        const allHashMatches = html.match(/"queryId":"([a-f0-9]{32})"/g) || [];
        const uniqueHashes = [...new Set(allHashMatches.map(h => h.match(/"queryId":"([a-f0-9]{32})"/)[1]))];

        log(`HTML'de ${uniqueHashes.length} benzersiz hash bulundu`, 'info');

        const hashes = {};

        // Bilinen operationName'leri ara
        const operationPatterns = [
            { name: 'follow_following', patterns: ['FollowingList', 'Following', 'edge_follow'] },
            { name: 'follow_followers', patterns: ['FollowersList', 'Followers', 'edge_followed_by'] },
            { name: 'follow_commenters', patterns: ['MediaToComments', 'Comments', 'edge_media_to_comment'] }
        ];

        for (const op of operationPatterns) {
            for (const pattern of op.patterns) {
                const regex = new RegExp(`"queryId":"([a-f0-9]{32})"[^}]{0,200}${pattern}`, 'i');
                const match = html.match(regex);
                if (match && match[1]) {
                    hashes[op.name] = match[1];
                    log(`${op.name} hash bulundu: ${match[1]}`, 'info');
                    break;
                }
            }
        }

        // Eğer hala hash'ler bulunamadıysa, ilk 3 hash'i kullan
        if (Object.keys(hashes).length < 3 && uniqueHashes.length >= 3) {
            if (!hashes.follow_following) hashes.follow_following = uniqueHashes[0];
            if (!hashes.follow_followers) hashes.follow_followers = uniqueHashes[1];
            if (!hashes.follow_commenters) hashes.follow_commenters = uniqueHashes[2];
            log('İlk 3 hash kullanılıyor (otomatik seçim)', 'info');
        }

        // Fallback: Bilinen hash'ler
        const fallbackHashes = {
            follow_following: '58712303d941c6855d4e888c5f0cd22f',
            follow_followers: '37479f2b8209594dde7facb0d904896a',
            follow_commenters: '33ba35852cb50da46f5b5e889df7d159'
        };

        // Cache'e kaydet
        queryHashCache = {
            follow_following: hashes.follow_following || fallbackHashes.follow_following,
            follow_followers: hashes.follow_followers || fallbackHashes.follow_followers,
            follow_commenters: hashes.follow_commenters || fallbackHashes.follow_commenters,
            lastUpdated: new Date().toISOString()
        };

        const foundCount = Object.values(hashes).filter(h => h).length;
        if (foundCount > 0) {
            log(`✓ Query hash'leri güncellendi: ${foundCount} yeni hash bulundu`, 'success');
        } else {
            log(`Yeni hash bulunamadı. Fallback hash\'ler kullanılıyor.`, 'warn');
        }

        // Cache'i storage'a kaydet
        chrome.storage.local.set({ queryHashCache });

        return queryHashCache;
    } catch (e) {
        if (e.name === 'AbortError') {
            log(`Hash çekme zaman aşımına uğradı. Fallback hash\'ler kullanılıyor.`, 'warn');
        } else {
            log(`Hash çekme hatası: ${e.message}. Fallback hash\'ler kullanılıyor.`, 'warn');
        }

        // Fallback hash'ler
        queryHashCache = {
            follow_following: '58712303d941c6855d4e888c5f0cd22f',
            follow_followers: '37479f2b8209594dde7facb0d904896a',
            follow_commenters: '33ba35852cb50da46f5b5e889df7d159',
            lastUpdated: new Date().toISOString()
        };

        chrome.storage.local.set({ queryHashCache });
        return queryHashCache;
    }
}

// Program başladığında hash'leri yükle
async function initializeQueryHashes() {
    try {
        // Önce storage'dan cache'i kontrol et
        chrome.storage.local.get(['queryHashCache'], async (data) => {
            if (data.queryHashCache && data.queryHashCache.lastUpdated) {
                const lastUpdate = new Date(data.queryHashCache.lastUpdated);
                const now = new Date();
                const hoursDiff = (now - lastUpdate) / (1000 * 60 * 60);
                
                // 24 saatten eski ise yenile
                if (hoursDiff < 24) {
                    queryHashCache = data.queryHashCache;
                    log('Query hash\'leri cache\'den yüklendi', 'info');
                    return;
                }
            }
            
            // Cache eski veya yok ise yeni çek (timeout ile)
            const timeoutPromise = new Promise((resolve) => {
                setTimeout(() => {
                    log('Hash çekme zaman aşımına uğradı. Fallback hash\'ler kullanılıyor.', 'warn');
                    resolve(false);
                }, 5000); // 5 saniye timeout
            });
            
            const hashPromise = extractQueryHashesFromInstagram();
            
            Promise.race([hashPromise, timeoutPromise]).catch(e => {
                log(`Hash başlatma hatası: ${e.message}`, 'error');
            });
        });
    } catch (e) {
        log(`Hash başlatma hatası: ${e.message}`, 'error');
    }
}

// Content script yüklendiğinde hash'leri başlat
initializeQueryHashes();

function updateState(newState) {
    appState = { ...appState, ...newState };
    chrome.runtime.sendMessage({ type: 'SAVE_STATE', state: appState });
}

function log(msg, type = 'info') {
    console.log(`[InstaGrow] ${msg}`);
    chrome.runtime.sendMessage({ type: 'ADD_LOG', msg, logType: type });
}

function getCookie(name) {
    const value = `; ${document.cookie}`;
    const parts = value.split(`; ${name}=`);
    if (parts.length === 2) return parts.pop().split(';').shift();
    return null;
}

function getUserId() {
    return getCookie('ds_user_id');
}

function getCsrfToken() {
    return getCookie('csrftoken');
}

async function sleep(ms) {
    const step = 250;
    let waited = 0;
    while (waited < ms && isRunning) {
        await new Promise(resolve => setTimeout(resolve, Math.min(step, ms - waited)));
        waited += step;
    }
}

async function getTargetUserId(username) {
    try {
        const res = await fetch(`https://www.instagram.com/api/v1/users/web_profile_info/?username=${username}`, {
            headers: {
                'x-ig-app-id': '936619743392459',
            }
        });
        if (!res.ok) return null;
        const data = await res.json();
        return data?.data?.user?.id || null;
    } catch (e) {
        return null;
    }
}

// Kullanıcı adı 'unknown' geldiğinde (bazı GraphQL/V1 yanıtları username döndürmez) ID'den geri çözer.
async function getUsernameById(userId, csrfToken) {
    try {
        const res = await fetch(`https://www.instagram.com/api/v1/users/${userId}/info/`, {
            headers: {
                'x-ig-app-id': '936619743392459',
                'x-csrftoken': csrfToken || ''
            }
        });
        if (!res.ok) return null;
        const data = await res.json();
        return data?.user?.username || null;
    } catch (e) {
        return null;
    }
}

async function fetchFollowersList(userId, csrfToken, onProgress, settings = {}) {
    // Followers için GraphQL endpoint - 50'şer çeker, V1 API'nin 12'şer kısıtlamasından iyi
    const users = [];
    const appId = '936619743392459';
    const cycleDelay = settings.searchCycleDelay || 1500;
    const pauseDelay = settings.searchCyclePauseDelay || 5000;
    const maxLimit = settings.maxFollowers || 0; // 0 = sınırsız
    const queryHash = queryHashCache.follow_followers || '37479f2b8209594dde7facb0d904896a';
    let endCursor = null;
    let hasNextPage = true;
    let cycleCount = 0;

    while (hasNextPage && isRunning && !(maxLimit > 0 && users.length >= maxLimit)) {
        // Kalan ihtiyaca göre first ayarla
        const remaining = maxLimit > 0 ? maxLimit - users.length : 50;
        const pageFirst = Math.min(remaining, 50);
        const vars = encodeURIComponent(JSON.stringify({ id: userId, first: pageFirst, ...(endCursor ? { after: endCursor } : {}) }));
        const url = `https://www.instagram.com/graphql/query/?query_hash=${queryHash}&variables=${vars}`;

        let res, data;
        try {
            res = await fetch(url, { headers: { 'x-ig-app-id': appId, 'x-csrftoken': csrfToken } });
            if (res.status === 429) {
                log('Followers rate limit. 30 saniye bekleniyor...', 'warn');
                await new Promise(r => setTimeout(r, 30000));
                continue;
            }
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            data = await res.json();
        } catch (e) {
            log(`Followers GraphQL hatası: ${e.message}. ${users.length} kişiyle devam ediliyor.`, 'warn');
            break;
        }

        const pageData = data?.data?.user?.edge_followed_by;
        if (!pageData) {
            log(`Followers GraphQL yanıtı geçersiz (sayfa ${cycleCount+1}). ${users.length} kişiyle devam ediliyor.`, 'warn');
            break; // null yerine mevcut users'u döndür
        }

        for (const edge of pageData.edges) {
            if (maxLimit > 0 && users.length >= maxLimit) break;
            const u = edge.node;
            const rawId = u.id || u.pk;
            if (!rawId) continue;
            users.push({
                id: String(rawId),
                username: u.username || '',
                is_private: u.is_private || false,
                profile_pic_url: u.profile_pic_url || ''
            });
        }

        hasNextPage = pageData.page_info.has_next_page;
        endCursor = pageData.page_info.end_cursor;
        cycleCount++;

        log(`followers listesi çekiliyor... (${users.length} kişi, bu sayfa: ${pageData.edges.length})`, 'info');
        if (onProgress) onProgress(users.length);

        if (hasNextPage && isRunning && !(maxLimit > 0 && users.length >= maxLimit)) {
            if (cycleCount % 5 === 0) {
                log(`5 döngü tamamlandı, ${pauseDelay}ms bekleniyor...`, 'info');
                await new Promise(r => setTimeout(r, pauseDelay));
            } else {
                await new Promise(r => setTimeout(r, cycleDelay + Math.random() * 500));
            }
        }
    }
    return users;
}

async function fetchFollowList(userId, type, csrfToken, onProgress, settings = {}) {
    const users = [];
    let nextMaxId = null;
    const appId = '936619743392459';
    const cycleDelay = settings.searchCycleDelay || 1500;
    const pauseDelay = settings.searchCyclePauseDelay || 5000;
    // type'a göre doğru limit al
    const maxLimit = type === 'following' ? (settings.maxFollowing || 0) : (settings.maxFollowers || 0);
    let cycleCount = 0;
    let retryCount = 0;
    const MAX_RETRIES = 3;

    do {
        // Limit dolmuşsa dur
        if (maxLimit > 0 && users.length >= maxLimit) {
            log(`${type} limiti (${maxLimit}) doldu, çekme durduruluyor.`, 'info');
            break;
        }
        // Kalan ihtiyaca göre count ayarla (gereksiz veri çekme)
        const remaining = maxLimit > 0 ? maxLimit - users.length : 200;
        const pageCount = Math.min(remaining, 200);
        let url = `https://www.instagram.com/api/v1/friendships/${userId}/${type}/?count=${pageCount}`;
        if (nextMaxId) url += `&max_id=${nextMaxId}`;

        let res, data;
        try {
            res = await fetch(url, {
                headers: {
                    'x-ig-app-id': appId,
                    'x-csrftoken': csrfToken
                }
            });

            if (res.status === 429) {
                log(`Rate limit (${type}). 30 saniye bekleniyor...`, 'warn');
                await new Promise(resolve => setTimeout(resolve, 30000));
                continue;
            }

            if (!res.ok) {
                throw new Error(`HTTP ${res.status}`);
            }

            data = await res.json();
            retryCount = 0;
        } catch (e) {
            retryCount++;
            if (retryCount >= MAX_RETRIES) {
                log(`${type} listesi çekilirken hata (${e.message}). ${users.length} kişiyle devam ediliyor.`, 'warn');
                break;
            }
            log(`${type} hatası: ${e.message}. Retry ${retryCount}/${MAX_RETRIES}...`, 'warn');
            await new Promise(resolve => setTimeout(resolve, 3000 * retryCount));
            continue;
        }

        const list = data.users || [];
        for (const u of list) {
            if (maxLimit > 0 && users.length >= maxLimit) break; // limit aşılmasın
            const rawId = u.pk || u.id || u.user_id;
            if (!rawId) continue;
            users.push({
                id: String(rawId),
                username: u.username || '',
                is_private: u.is_private || false,
                profile_pic_url: u.profile_pic_url || ''
            });
        }
        nextMaxId = data.next_max_id || null;
        cycleCount++;

        log(`${type} listesi çekiliyor... (${users.length} kişi, bu sayfa: ${list.length})`, 'info');
        if (onProgress) onProgress(users.length);

        if (nextMaxId && isRunning && !(maxLimit > 0 && users.length >= maxLimit)) {
            if (cycleCount % 5 === 0) {
                log(`5 döngü tamamlandı, ${pauseDelay}ms bekleniyor...`, 'info');
                await new Promise(resolve => setTimeout(resolve, pauseDelay));
            } else {
                await new Promise(resolve => setTimeout(resolve, cycleDelay + Math.random() * 500));
            }
        }
    } while (nextMaxId && isRunning && !(maxLimit > 0 && users.length >= maxLimit));

    return users;
}


async function scanTargetUsers(actionType, settings = {}) {
    if (isRunning) return;
    isRunning = true;
    updateState({ status: 'scanning', scanned: 0 });
    nonFollowers = [];
    log(`Tarama başlatılıyor (${actionType})...`, 'info');

    try {
        const userId = getUserId();
        if (!userId) {
            throw new Error("Kullanıcı ID bulunamadı. Lütfen Instagram'a giriş yapın.");
        }

        const csrfToken = getCsrfToken() || '';

        // --- TRACKED MOD: Sadece uygulama ile takip edilenleri kontrol et ---
        if (actionType === 'unfollow_nonfollowers_tracked') {
            chrome.storage.local.get(['followedByApp'], async (stored) => {
                const followedByApp = stored.followedByApp || [];
                if (followedByApp.length === 0) {
                    log('⚠️ Takip geçmişi bulunamadı. Önce bu uygulama ile birini takip edin.', 'warn');
                    isRunning = false;
                    updateState({ status: 'idle' });
                    return;
                }

                log(`Takip geçmişinde ${followedByApp.length} kişi var. Takipçiler çekiliyor...`, 'info');
                const followers = await fetchFollowersList(userId, csrfToken, null, settings);
                if (followers === null || followers.length === 0) {
                    log('Takipçi listesi çekilemedi. Tekrar deneyin.', 'error');
                    isRunning = false;
                    updateState({ status: 'idle' });
                    return;
                }

                const followerIdSet = new Set(followers.map(u => String(u.id)));
                const whitelistArr = settings.whitelist ? settings.whitelist.split(',').map(s => s.trim().toLowerCase().replace(/^@/, "")).filter(Boolean) : [];

                // followedByApp içinden geri takip etmeyenleri bul, en yeniden eskiye sırala
                const sorted = [...followedByApp].sort((a, b) => new Date(b.followedAt) - new Date(a.followedAt));
                const result = sorted.filter(u => {
                    if (followerIdSet.has(String(u.id))) return false; // geri takip ediyor
                    if (whitelistArr.includes(u.username.toLowerCase())) return false;
                    return true;
                }).map(u => ({
                    id: u.id,
                    username: u.username,
                    profile_pic_url: u.profile_pic_url || '',
                    is_private: u.is_private || false,
                    is_following_back: false,
                    followedAt: u.followedAt
                }));

                log(`Tarama tamamlandı. ${result.length} kişi geri takip etmiyor (${followedByApp.length} takipten).`, 'success');
                isRunning = false;
                updateState({ status: 'idle', scanned: result.length });
                chrome.storage.local.set({
                    nonFollowers: result,
                    followingList: result,
                    followersList: followers,
                    listActionType: 'unfollow_nonfollowers_tracked'
                }, () => {
                    chrome.runtime.sendMessage({ type: 'OPEN_LIST_PAGE' });
                });
            });
            return;
        }

        // --- UNFOLLOW NON-FOLLOWERS: V1 API ile following ve followers çek, farkı bul ---
        if (actionType === 'unfollow_nonfollowers' || actionType === 'unfollow_followers' || actionType === 'unfollow_private') {
            log('Takip ettikleriniz çekiliyor...', 'info');
            const following = await fetchFollowList(userId, 'following', csrfToken, null, settings);

            // unfollow_private için followers listesine gerek yok
            let followers = [];
            if (actionType !== 'unfollow_private') {
                log(`${following.length} takip edilen bulundu. 5 saniye bekleniyor...`, 'info');
                await new Promise(resolve => setTimeout(resolve, 5000));
                log('Şimdi takipçiler çekiliyor (GraphQL)...', 'info');
                followers = await fetchFollowersList(userId, csrfToken, null, settings);

                // GraphQL kısmi veri döndürmüş olabilir, kontrol et
                if (followers === null || followers.length === 0) {
                    log('GraphQL başarısız veya boş, V1 API ile deneniyor...', 'warn');
                    followers = await fetchFollowList(userId, 'followers', csrfToken, null, settings);
                } else {
                    log(`GraphQL ile ${followers.length} takipçi çekildi.`, 'info');
                }

                log(`${followers.length} takipçi bulundu. Liste hesaplanıyor...`, 'info');
            } else {
                log(`${following.length} takip edilen bulundu. Gizli hesaplar filtreleniyor...`, 'info');
            }            if (actionType === 'unfollow_private') {
                // Gizli hesaplar: followers'a gerek yok, direkt following'den filtrele
                const whitelistArr = settings.whitelist ? settings.whitelist.split(',').map(s => s.trim().toLowerCase().replace(/^@/, "")).filter(Boolean) : [];
                following.forEach(u => {
                    if (!u.is_private) return;
                    if (whitelistArr.includes(u.username.toLowerCase())) return;
                    nonFollowers.push(u);
                });
                updateState({ scanned: nonFollowers.length });
                log(`Tarama tamamlandı. ${nonFollowers.length} gizli hesap listelendi.`, 'success');
                isRunning = false;
                updateState({ status: 'idle' });
                chrome.storage.local.set({ nonFollowers, followingList: following, followersList: [], listActionType: actionType }, () => {
                    chrome.runtime.sendMessage({ type: 'OPEN_LIST_PAGE' });
                });
                return;
            }

            // unfollow_nonfollowers / unfollow_followers:
            // Ham listeleri kaydet, hesaplamayı list.js yapacak
            const totalNonFollowers = following.filter(u => !new Set(followers.map(f => String(f.id))).has(String(u.id))).length;
            log(`Tarama tamamlandı. ${totalNonFollowers} kişi geri takip etmiyor.`, 'success');
            isRunning = false;
            updateState({ status: 'idle', scanned: totalNonFollowers });
            chrome.storage.local.set({ nonFollowers: following, followingList: following, followersList: followers, listActionType: actionType }, () => {
                chrome.runtime.sendMessage({ type: 'OPEN_LIST_PAGE' });
            });
            return;
        }

        let targetUserId = userId;

        // If we are scanning followers/following of someone else, grab their ID from their profile page
        if (actionType === 'follow_followers' || actionType === 'follow_following') {
            const username = window.location.pathname.split('/').filter(Boolean)[0];
            const invalidUsernames = ['p', 'reel', 'tv', 'explore', 'stories', 'direct'];
            if (username && !invalidUsernames.includes(username)) {
                log(`@${username} için profil ID'si aranıyor...`, 'info');
                const scrapedId = await getTargetUserId(username);
                if (scrapedId) {
                    targetUserId = scrapedId;
                    log(`Profil ID'si bulundu: ${targetUserId}`, 'success');
                } else {
                    throw new Error(`@${username} kullanıcısının ID'si bulunamadı. Lütfen sayfayı yenileyip tekrar deneyin.`);
                }
            } else {
                throw new Error("Lütfen işlemi başlatmadan önce bir kullanıcının INSTAGRAM PROFİLİNE girin.");
            }
        }

        let hasNextPage = true;
        let endCursor = null;
        let totalFetched = 0;

        // For all other actions, use the robust GraphQL API approach
        let queryHash = '';
        let edgePath = '';
        let varsObj = {};

        if (actionType === 'follow_following') {
            queryHash = queryHashCache.follow_following || '58712303d941c6855d4e888c5f0cd22f';
            edgePath = 'edge_follow';
            varsObj = { id: targetUserId, first: 50 };
        } else if (actionType === 'follow_followers') {
            queryHash = queryHashCache.follow_followers || '37479f2b8209594dde7facb0d904896a';
            edgePath = 'edge_followed_by';
            varsObj = { id: targetUserId, first: 50 };
        } else if (actionType === 'follow_likers') {
            const shortcodeMatch = window.location.pathname.match(/\/(?:p|reel|tv)\/([^\/]+)/);
            if (!shortcodeMatch) {
                throw new Error("Lütfen işlemi başlatmadan önce bir GÖNDERİ ekranına girin veya gönderiye tıklayın.");
            }
            const shortcode = shortcodeMatch[1];
            log(`Beğenenler çekiliyor (${shortcode})...`, 'info');

            // GraphQL ile beğenenler çek
            queryHash = '1cb6ec562411f7b1d4a2c4a6cdee6db5'; // Likers query hash
            edgePath = 'edge_liked_by';
            varsObj = { shortcode: shortcode, first: 50 };

            // Önce V1 API dene - sayfalama yok ama hızlı (~100 kişi)
            // Sonra GraphQL ile devam et (sayfalama var, tüm listeyi çeker)
            try {
                const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
                let mediaId = BigInt(0);
                for (let i = 0; i < shortcode.length; i++) {
                    mediaId = (mediaId * BigInt(64)) + BigInt(alphabet.indexOf(shortcode[i]));
                }

                const url = `https://www.instagram.com/api/v1/media/${mediaId.toString(10)}/likers/`;
                const res = await fetch(url, {
                    headers: {
                        'x-ig-app-id': '936619743392459',
                        'x-csrftoken': getCsrfToken() || ''
                    }
                });

                if (res.ok) {
                    const data = await res.json();
                    const whitelistArr = settings.whitelist ? settings.whitelist.split(',').map(s => s.trim().toLowerCase().replace(/^@/, "")).filter(Boolean) : [];
                    const blacklistArr = settings.blacklist ? settings.blacklist.split(',').map(s => s.trim().toLowerCase().replace(/^@/, "")).filter(Boolean) : [];
                    const seenIds = new Set();

                    if (data.users && data.users.length > 0) {
                        data.users.forEach(u => {
                            const username = u.username || 'unknown';
                            const userId = u.pk || u.id;
                            if (!userId) return;
                            if (blacklistArr.includes(username.toLowerCase())) return;
                            if (settings.skipPrivate && u.is_private) return;
                            if (settings.skipNoPic && u.profile_pic_url && u.profile_pic_url.includes('default_v0')) return;
                            seenIds.add(String(userId));
                            nonFollowers.push({ id: userId, username: username, is_private: u.is_private || false, profile_pic_url: u.profile_pic_url || '' });
                        });
                        totalFetched += data.users.length;
                        updateState({ scanned: nonFollowers.length });
                        log(`V1 API'den ${data.users.length} beğenen çekildi. GraphQL ile devam ediliyor...`, 'info');
                    }

                    // V1 sonrası GraphQL ile kalan sayfaları çek (duplicate'leri atla)
                    // seenIds'i closure'a taşı - GraphQL loop'unda kullanılacak
                    // varsObj'e özel bir flag ekle
                    varsObj._seenIds = seenIds;
                }
            } catch (e) {
                log(`V1 API hatası: ${e.message}. GraphQL ile devam ediliyor...`, 'info');
            }

            // GraphQL ile tüm sayfaları çek
            hasNextPage = true;

        } else if (actionType === 'follow_commenters') {
            queryHash = queryHashCache.follow_commenters || '33ba35852cb50da46f5b5e889df7d159';
            edgePath = 'edge_media_to_comment';
            const shortcodeMatch = window.location.pathname.match(/\/(?:p|reel|tv)\/([^\/]+)/);
            if (!shortcodeMatch) {
                throw new Error("Lütfen işlemi başlatmadan önce bir GÖNDERİ ekranına girin veya gönderiye tıklayın.");
            }
            varsObj = { shortcode: shortcodeMatch[1], first: 50 };
        } else if (actionType === 'unfollow_nonfollowers' || actionType === 'unfollow_followers' || actionType === 'unfollow_private') {
            // Bu tipler yukarıda zaten işlendi ve return yapıldı, buraya düşmemeli
            return;
        } else {
            throw new Error("Bilinmeyen işlem türü: " + actionType);
        }

        // _seenIds'i varsObj'dan ayır - JSON.stringify'a girmemeli
        const likerSeenIds = varsObj._seenIds || new Set();
        delete varsObj._seenIds;

        while (hasNextPage && isRunning) {
            if (endCursor) {
                varsObj.after = endCursor;
            }
            const vars = encodeURIComponent(JSON.stringify(varsObj));
            const url = `https://www.instagram.com/graphql/query/?query_hash=${queryHash}&variables=${vars}`;

            log(`Veri çekiliyor... (${totalFetched} kişi bulundu)`, 'info');
            const csrfToken = getCsrfToken() || '';
            const res = await fetch(url, {
                headers: {
                    'x-ig-app-id': '936619743392459',
                    'x-csrftoken': csrfToken
                }
            });
            if (!res.ok) throw new Error(`HTTP Hatası: ${res.status}`);

            const data = await res.json();

            // Support both old nested user object and direct node
            let rootNode = null;
            if (actionType === 'follow_commenters' || actionType === 'follow_likers') {
                rootNode = data?.data?.shortcode_media;
            } else {
                rootNode = data?.data?.user;
            }

            if (!rootNode || !rootNode[edgePath]) {
                log("Instagram API bu veriyi reddetti veya yapı değişti. Kısıtlama yemiş olabilirsiniz.", 'error');
                throw new Error("Instagram'dan geçersiz yanıt alındı. Sayfayı yenileyip bekleyin.");
            }

            const pageData = rootNode[edgePath];
            hasNextPage = pageData.page_info.has_next_page;
            endCursor = pageData.page_info.end_cursor;

            const edges = pageData.edges;
            totalFetched += edges.length;

            const whitelistArr = settings.whitelist ? settings.whitelist.split(',').map(s => s.trim().toLowerCase().replace(/^@/, "")).filter(Boolean) : [];
            const blacklistArr = settings.blacklist ? settings.blacklist.split(',').map(s => s.trim().toLowerCase().replace(/^@/, "")).filter(Boolean) : [];

            edges.forEach(edge => {
                const node = edge.node;

                // For comments, the actual profile is inside owner
                const userNode = (actionType === 'follow_commenters') ? node.owner : node;
                const username = userNode.username || 'unknown';
                const userId = userNode.id || userNode.pk;

                if (!userId) {
                    log(`⚠️ @${username} için ID bulunamadı. Atlanıyor.`, 'warn');
                    return;
                }

                // V1 API'den zaten eklendiyse atla (sadece follow_likers için)
                if (actionType === 'follow_likers' && likerSeenIds.has(String(userId))) return;
                if (actionType === 'follow_likers') likerSeenIds.add(String(userId));

                // Blacklist check (For Follow actions)
                if (actionType !== 'unfollow_nonfollowers' && blacklistArr.includes(username.toLowerCase())) return;

                // Whitelist check (For Unfollow actions)
                if (actionType === 'unfollow_nonfollowers' && whitelistArr.includes(username.toLowerCase())) return;

                // Smart Filters
                if (settings.skipPrivate && userNode.is_private) return;
                if (settings.skipNoPic && userNode.profile_pic_url && userNode.profile_pic_url.includes('default_v0')) return;

                nonFollowers.push({ id: userId, username: username, is_private: userNode.is_private || false, profile_pic_url: userNode.profile_pic_url || '' });
            });

            updateState({ scanned: nonFollowers.length });

            if (hasNextPage && isRunning) {
                const cycleDelay = settings.searchCycleDelay || 1500;
                const pauseDelay = settings.searchCyclePauseDelay || 5000;
                const pageCount = Math.ceil(totalFetched / 50);
                if (pageCount > 0 && pageCount % 5 === 0) {
                    log(`5 döngü tamamlandı, ${pauseDelay / 1000}s bekleniyor...`, 'info');
                    await sleep(pauseDelay);
                } else {
                    await sleep(cycleDelay + Math.random() * 500);
                }
            }
        }

        if (isRunning) {
            log(`Tarama tamamlandı. Toplam ${nonFollowers.length} hedef kullanıcı listeye eklendi.`, 'success');
        } else {
            log(`Tarama durduruldu. ${nonFollowers.length} hedef kullanıcı listeye eklendi.`, 'info');
        }
        
        // Listeyi her durumda kaydet (tamamlandı veya durduruldu)
        if (nonFollowers.length > 0) {
            chrome.storage.local.set({ nonFollowers, listActionType: actionType }, () => {
                if (isRunning) {
                    chrome.runtime.sendMessage({ type: 'OPEN_LIST_PAGE' });
                }
            });
        }
    } catch (err) {
        log(`Hata: ${err.message}`, 'error');
    } finally {
        isRunning = false;
        updateState({ status: 'idle' });
    }
}

async function performAutoLike(username, csrfToken) {
    try {
        const res = await fetch(`https://www.instagram.com/api/v1/users/web_profile_info/?username=${username}`, {
            headers: { 'x-ig-app-id': '936619743392459' }
        });
        if (!res.ok) return;
        const data = await res.json();
        const edges = data?.data?.user?.edge_owner_to_timeline_media?.edges || [];

        let likedCount = 0;
        for (let i = 0; i < Math.min(2, edges.length); i++) {
            const mediaId = edges[i].node.id;
            const likeRes = await fetch(`https://www.instagram.com/web/likes/${mediaId}/like/`, {
                method: 'POST',
                headers: {
                    'x-csrftoken': csrfToken,
                    'content-type': 'application/x-www-form-urlencoded'
                }
            });
            if (likeRes.ok) likedCount++;
            await sleep(1000 + Math.random() * 1000); // Sleep between likes
        }
        if (likedCount > 0) {
            log(`@${username} için ${likedCount} gönderi beğenildi (Auto-Like)`, 'info');
        }
    } catch (e) {
        // Ignore errors for auto-like
    }
}

async function performAutoStoryView(userId, csrfToken) {
    try {
        const queryHash = 'c43d22dc0fa708cd1f29883ea57fe05f'; // Query hash for reel
        const vars = encodeURIComponent(JSON.stringify({ user_id: userId, include_chaining: false, include_reel: true, include_logged_out_extras: false }));
        const res = await fetch(`https://www.instagram.com/graphql/query/?query_hash=${queryHash}&variables=${vars}`, {
            headers: { 'x-ig-app-id': '936619743392459' }
        });
        if (!res.ok) return;
        const data = await res.json();

        const items = data?.data?.user?.reel?.items || [];
        if (items.length > 0) {
            const firstStory = items[0];
            const storyId = firstStory.id;

            // Mark as seen
            const body = new URLSearchParams({
                reelMediaId: storyId,
                reelMediaOwnerId: userId,
                reelId: userId,
                reelMediaTakenAt: firstStory.taken_at_timestamp,
                viewSeenAt: Math.floor(Date.now() / 1000)
            });

            const seenRes = await fetch(`https://www.instagram.com/api/v1/stories/reel/seen/`, {
                method: 'POST',
                body: body,
                headers: {
                    'x-csrftoken': csrfToken,
                    'x-ig-app-id': '936619743392459',
                    'content-type': 'application/x-www-form-urlencoded'
                }
            });

            if (seenRes.ok) {
                log(`@${userId} kullanıcısının hikayesi izlendi (Auto-Story)`, 'info');
            }
        }
    } catch (e) {
        // Ignore errors for auto-story
    }
}

function getSeenHeaders(csrfToken) {
    const headers = {
        'x-csrftoken': csrfToken,
        'x-ig-app-id': '936619743392459',
        'x-requested-with': 'XMLHttpRequest',
        'x-asbd-id': '129477',
        'content-type': 'application/x-www-form-urlencoded'
    };
    try {
        const claim = sessionStorage.getItem('www-claim-v2');
        if (claim) headers['x-ig-www-claim'] = claim;
    } catch (e) { /* sessionStorage erişilemezse claim'siz devam */ }
    return headers;
}

async function markStoryItemSeen(item, ownerId, csrfToken) {
    // item.id "mediaPk_userPk" formatında olabilir, sadece media pk gerekli
    const mediaPk = String(item.pk || item.id).split('_')[0];
    const takenAt = item.taken_at || item.taken_at_timestamp;
    const seenAt = Math.floor(Date.now() / 1000);
    const headers = getSeenHeaders(csrfToken);
    const formBody = new URLSearchParams({
        reelMediaId: mediaPk,
        reelMediaOwnerId: String(ownerId),
        reelId: String(ownerId),
        reelMediaTakenAt: takenAt,
        viewSeenAt: seenAt
    });

    // v2 media/seen, mobil API'nin signed_body biçimini bekler.
    // Web oturumlarında imza kontrolü yapılmadığı için "SIGNATURE." öneki yeterlidir.
    const seenPayload = JSON.stringify({
        reels: { [`${mediaPk}_${ownerId}`]: [`${takenAt}_${seenAt}`] },
        container_module: 'feed_timeline',
        live_vods: {},
        live_vods_skipped: {},
        nuxes: {},
        nuxes_skipped: {},
        reel_media_skipped: {}
    });

    // Sırayla denenen uç noktalar — ilki başarılı olursa diğerleri denenmez
    const attempts = [
        // 1) v2 media/seen (signed_body formatı)
        () => fetch(`https://www.instagram.com/api/v2/media/seen/?reel=1&live_vod=0`, {
            method: 'POST',
            body: new URLSearchParams({ signed_body: `SIGNATURE.${seenPayload}` }),
            headers
        }),
        // 2) v1 stories/reel/seen
        () => fetch(`https://www.instagram.com/api/v1/stories/reel/seen/`, {
            method: 'POST', body: formBody, headers
        }),
        // 3) Eski web uç noktası
        () => fetch(`https://www.instagram.com/stories/reel/seen`, {
            method: 'POST', body: formBody, headers
        })
    ];

    const statuses = [];
    for (const attempt of attempts) {
        try {
            const res = await attempt();
            if (res.ok) {
                // 200 dönse bile gövdedeki status'u doğrula — sahte "ok" durumlarını ele
                const data = await res.json().catch(() => null);
                if (!data || data.status === 'ok') return { ok: true };
                statuses.push(`200/${data.status}`);
            } else {
                statuses.push(res.status);
            }
        } catch (e) {
            statuses.push(e.message);
        }
    }
    return { ok: false, statuses };
}

// Anasayfa hikaye tepsisindeki (takip edilenlerin) tüm hikayelerini "görüldü" işaretle
async function viewAllFeedStories() {
    if (isRunning) {
        log('Zaten bir işlem çalışıyor. Önce durdurun.', 'warn');
        return;
    }
    isRunning = true;
    updateState({ status: 'processing' });
    log('Anasayfa hikayeleri çekiliyor...', 'info');

    try {
        const csrfToken = getCsrfToken();
        if (!csrfToken) throw new Error('CSRF token bulunamadı. Instagram\'a giriş yapın.');

        // 1) Hikaye tepsisini çek (takip edilen ve aktif hikayesi olan hesaplar)
        const trayRes = await fetch(`https://www.instagram.com/api/v1/feed/reels_tray/`, {
            headers: { 'x-ig-app-id': '936619743392459', 'x-csrftoken': csrfToken }
        });
        if (!trayRes.ok) throw new Error(`Hikaye tepsisi alınamadı (HTTP ${trayRes.status})`);
        const trayData = await trayRes.json();
        const tray = trayData?.tray || [];

        if (tray.length === 0) {
            log('Anasayfada izlenecek hikaye bulunamadı.', 'warn');
            return;
        }
        log(`${tray.length} hesabın aktif hikayesi bulundu.`, 'info');

        let viewedUsers = 0;
        let viewedItems = 0;

        // 2) Tüm hesapların hikaye içeriklerini toplu çek (Instagram web de böyle yapıyor)
        const itemsByOwner = {};
        const idsToFetch = tray.filter(r => !(r.items && r.items.length)).map(r => String(r.id));
        tray.forEach(r => { if (r.items && r.items.length) itemsByOwner[String(r.id)] = r.items; });

        const CHUNK = 20;
        for (let c = 0; c < idsToFetch.length; c += CHUNK) {
            if (!isRunning) break;
            const chunk = idsToFetch.slice(c, c + CHUNK);
            const params = chunk.map(id => `reel_ids=${id}`).join('&');
            try {
                const mediaRes = await fetch(`https://www.instagram.com/api/v1/feed/reels_media/?${params}`, {
                    headers: { 'x-ig-app-id': '936619743392459', 'x-csrftoken': csrfToken }
                });
                if (mediaRes.status === 429) {
                    log('Rate limit algılandı. 30 saniye bekleniyor...', 'warn');
                    await sleep(30000);
                    c -= CHUNK;
                    continue;
                }
                if (!mediaRes.ok) {
                    log(`Hikaye içerikleri alınamadı (HTTP ${mediaRes.status})`, 'warn');
                    continue;
                }
                const mediaData = await mediaRes.json();
                const reelsMap = mediaData?.reels || {};
                Object.keys(reelsMap).forEach(id => {
                    if (reelsMap[id]?.items?.length) itemsByOwner[String(id)] = reelsMap[id].items;
                });
                (mediaData?.reels_media || []).forEach(r => {
                    const id = String(r.id || r.user?.pk || '');
                    if (id && r.items?.length && !itemsByOwner[id]) itemsByOwner[id] = r.items;
                });
            } catch (e) {
                log(`Hikaye içerik hatası: ${e.message}`, 'warn');
            }
            if (c + CHUNK < idsToFetch.length && isRunning) await sleep(1000 + Math.random() * 1000);
        }

        for (const reel of tray) {
            if (!isRunning) break;
            const ownerId = String(reel.id);
            const username = reel.user?.username || ownerId;
            const lastSeen = reel.seen || 0; // en son izlenen hikayenin taken_at değeri

            const items = itemsByOwner[ownerId] || [];
            if (items.length === 0) {
                log(`@${username}: hikaye içeriği boş döndü, atlanıyor.`, 'warn');
                continue;
            }

            // Sadece henüz izlenmemiş hikayeleri işaretle
            const unseenItems = items.filter(it => (it.taken_at || it.taken_at_timestamp || 0) > lastSeen);
            if (unseenItems.length === 0) {
                log(`@${username}: ${items.length} hikaye zaten izlenmiş, atlanıyor.`, 'info');
                continue;
            }

            let userViewed = 0;
            let userFailed = 0;
            let lastFailStatuses = null;
            for (const item of unseenItems) {
                if (!isRunning) break;
                try {
                    const result = await markStoryItemSeen(item, ownerId, csrfToken);
                    if (result.ok) {
                        userViewed++;
                        viewedItems++;
                    } else {
                        userFailed++;
                        lastFailStatuses = result.statuses;
                    }
                } catch (e) {
                    userFailed++;
                    lastFailStatuses = [e.message];
                }
                await sleep(300 + Math.random() * 500);
            }
            if (userFailed > 0) {
                log(`@${username}: ${userFailed} hikaye işaretlenemedi (yanıtlar: ${(lastFailStatuses || []).join(', ')})`, 'warn');
            }

            if (userViewed > 0) {
                viewedUsers++;
                log(`@${username}: ${userViewed} hikaye izlendi (${viewedUsers}. hesap)`, 'success');
                updateState({ processed: (appState.processed || 0) + userViewed });
            }

            // Anti-ban: hesaplar arası bekleme
            if (isRunning) await sleep(1000 + Math.random() * 1500);
        }

        if (isRunning) {
            log(`✓ Tamamlandı: ${viewedUsers} hesabın toplam ${viewedItems} hikayesi izlendi.`, 'success');
        } else {
            log(`Durduruldu: ${viewedUsers} hesabın ${viewedItems} hikayesi izlenmişti.`, 'info');
        }
    } catch (err) {
        log(`Hikaye izleme hatası: ${err.message}`, 'error');
    } finally {
        isRunning = false;
        updateState({ status: 'idle' });
    }
}

// --- UI tabanlı hikaye izleme: oynatıcıyı gerçekten açıp gezdirir ---
function isElementVisible(el) {
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.right > 0
        && rect.top < window.innerHeight && rect.left < window.innerWidth;
}

function findStoryNextButtons() {
    const labels = ['İleri', 'Sonraki', 'Next'];
    const found = [];
    const candidates = document.querySelectorAll('button[aria-label], div[role="button"][aria-label], svg[aria-label]');
    for (const el of candidates) {
        const al = el.getAttribute('aria-label') || '';
        if (labels.some(l => al === l || al.startsWith(l))) {
            const btn = el.closest('button,[role="button"]') || el;
            if (isElementVisible(btn)) found.push(btn);
        }
    }
    return found;
}

function simulateClick(target, x, y) {
    const opts = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y, button: 0 };
    target.dispatchEvent(new PointerEvent('pointerdown', { ...opts, pointerId: 1, isPrimary: true }));
    target.dispatchEvent(new MouseEvent('mousedown', opts));
    target.dispatchEvent(new PointerEvent('pointerup', { ...opts, pointerId: 1, isPrimary: true }));
    target.dispatchEvent(new MouseEvent('mouseup', opts));
    target.dispatchEvent(new MouseEvent('click', opts));
}

function pressArrowRight() {
    const keyOpts = { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39, which: 39, bubbles: true, cancelable: true };
    const targets = [document.activeElement, document.body, document, window].filter(Boolean);
    for (const t of targets) {
        try {
            t.dispatchEvent(new KeyboardEvent('keydown', keyOpts));
            t.dispatchEvent(new KeyboardEvent('keyup', keyOpts));
        } catch (e) { /* window dispatch bazı ortamlarda atabilir */ }
    }
}

// Bir geçiş yöntemi dener, URL değişimiyle işe yarayıp yaramadığını doğrular.
// Başarılı yöntemin adını, hiçbiri işe yaramadıysa null döner.
async function advanceStoryVerified() {
    const changed = (before) => location.href !== before;

    // 1) Görünür "İleri" butonları (birden fazlaysa hepsi sırayla)
    for (const btn of findStoryNextButtons()) {
        const before = location.href;
        const r = btn.getBoundingClientRect();
        simulateClick(btn, Math.floor(r.left + r.width / 2), Math.floor(r.top + r.height / 2));
        await sleep(700);
        if (changed(before)) return 'ok butonu';
    }

    // 2) Klavye sağ ok
    {
        const before = location.href;
        pressArrowRight();
        await sleep(700);
        if (changed(before)) return 'klavye';
    }

    // 3) Hikaye görselinin sağ kenarına tıkla (dokunmatik "sonraki" bölgesi)
    const media = getActiveStoryMedia();
    if (media && isElementVisible(media)) {
        const before = location.href;
        const rect = media.getBoundingClientRect();
        const x = Math.floor(rect.right - 20);
        const y = Math.floor(rect.top + rect.height / 2);
        const target = document.elementFromPoint(x, y);
        if (target) {
            simulateClick(target, x, y);
            await sleep(700);
            if (changed(before)) return 'medya kenarı';
        }
    }

    return null;
}

function findViewStoryConfirmButton() {
    // Soğuk yüklemede çıkan "Hikayeyi görüntüle" / "View story" onay butonu
    const texts = ['hikayeyi görüntüle', 'view story'];
    const btns = document.querySelectorAll('button, div[role="button"]');
    for (const b of btns) {
        const t = (b.textContent || '').trim().toLowerCase();
        if (texts.includes(t)) return b;
    }
    return null;
}

function getStoryUsername() {
    const m = location.pathname.match(/^\/stories\/([^\/]+)/);
    return m ? m[1] : null;
}

function findStoryLikeButton() {
    const svgs = document.querySelectorAll('svg[aria-label]');
    for (const s of svgs) {
        const al = s.getAttribute('aria-label');
        if (al === 'Beğen' || al === 'Like') {
            const btn = s.closest('[role="button"],button');
            if (btn && isElementVisible(btn)) return btn;
        }
    }
    return null;
}

async function openStoryPlayer() {
    // Hikaye tepsisi sayfanın üstündedir — kaydırılmış olabiliriz
    window.scrollTo(0, 0);
    await sleep(800);
    // Tepside halka bul (her halka bir canvas içerir) ve tıkla
    let ringBtn = null;
    for (let attempt = 0; attempt < 10 && !ringBtn && isRunning; attempt++) {
        const canvases = document.querySelectorAll('canvas');
        for (const cv of canvases) {
            const btn = cv.closest('[role="button"], button');
            if (btn && btn.offsetParent !== null) { ringBtn = btn; break; }
        }
        if (!ringBtn) await sleep(1000);
    }
    if (!ringBtn) return false;
    ringBtn.click();

    let waited = 0;
    while (!location.pathname.startsWith('/stories/') && waited < 10000 && isRunning) {
        await sleep(500);
        waited += 500;
        const confirm = findViewStoryConfirmButton();
        if (confirm) confirm.click();
    }
    return location.pathname.startsWith('/stories/');
}

async function closeStoryPlayer() {
    const svgs = document.querySelectorAll('svg[aria-label]');
    for (const s of svgs) {
        const al = s.getAttribute('aria-label');
        if (al === 'Kapat' || al === 'Close') {
            const btn = s.closest('[role="button"],button');
            if (btn && isElementVisible(btn)) { btn.click(); break; }
        }
    }
    await sleep(800);
    if (location.pathname.startsWith('/stories/')) {
        const keyOpts = { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true };
        document.dispatchEvent(new KeyboardEvent('keydown', keyOpts));
        document.dispatchEvent(new KeyboardEvent('keyup', keyOpts));
        await sleep(800);
    }
    if (location.pathname.startsWith('/stories/')) {
        history.back(); // son çare: SPA geri tuşu oynatıcıyı kapatır
        await sleep(1000);
    }
    return !location.pathname.startsWith('/stories/');
}

// Aynı kullanıcının kalan hikayelerini izlemeden, karuseldeki sonraki kullanıcının
// önizleme kartına tıklayarak doğrudan diğer hesaba atlar
// Aktif (ortadaki, büyük) hikaye medyasını bul — /stories/ sayfasında dialog yok,
// bu yüzden konum ve boyuta göre tespit edilir
function getActiveStoryMedia() {
    let best = null;
    let bestArea = 0;
    const cx = window.innerWidth / 2;
    for (const el of document.querySelectorAll('img, video')) {
        const r = el.getBoundingClientRect();
        if (r.width < 100 || r.height < 100) continue;
        if (r.left > cx || r.right < cx) continue; // yatay merkezi kapsamalı
        const area = r.width * r.height;
        if (area > bestArea) { bestArea = area; best = el; }
    }
    return best;
}

async function skipToNextUser(skipUser) {
    const media = getActiveStoryMedia();
    if (!media || !isElementVisible(media)) return false;
    const rect = media.getBoundingClientRect();
    const centerY = rect.top + rect.height / 2;

    // Aktif hikayenin sağındaki en yakın önizleme görselini (sonraki kullanıcının kartı) bul
    let best = null;
    let bestLeft = Infinity;
    for (const el of document.querySelectorAll('img, canvas, video')) {
        if (el === media) continue;
        const r = el.getBoundingClientRect();
        if (r.width < 20 || r.height < 20) continue;                 // simge boyutundaki öğeleri ele
        if (r.left <= rect.right + 5) continue;                       // aktif hikayenin sağında olmalı
        if (r.left >= window.innerWidth) continue;                    // ekran içinde olmalı
        if (Math.abs((r.top + r.height / 2) - centerY) > rect.height / 2) continue; // dikeyde ortada olmalı
        if (r.left < bestLeft) { best = el; bestLeft = r.left; }
    }
    if (!best) return false;

    const r = best.getBoundingClientRect();
    const x = Math.floor(r.left + r.width / 2);
    const y = Math.floor(r.top + r.height / 2);

    // Önce görselin üstündeki gerçek hedefe tam olay dizisiyle tıkla
    const target = document.elementFromPoint(x, y) || best;
    simulateClick(target, x, y);
    await sleep(900);
    if (!location.pathname.startsWith('/stories/')) return true;
    if (getStoryUsername() !== skipUser) return true;

    // İkinci deneme: öğenin kendisine ve üst kapsayıcısına doğrudan click()
    if (typeof best.click === 'function') best.click();
    const wrapper = best.closest('div');
    if (wrapper && typeof wrapper.click === 'function') wrapper.click();
    await sleep(900);
    return !location.pathname.startsWith('/stories/') || getStoryUsername() !== skipUser;
}

// Hikaye izleme/beğenme işlemlerini dışa aktarılabilir geçmişe kaydet (list.html → CSV/TXT/JSON)
function recordStoryAction(action, username) {
    chrome.storage.local.get(['actionOutputLogs'], (stored) => {
        let logs = stored.actionOutputLogs || [];
        logs.push({
            action,
            username: username || 'bilinmiyor',
            userId: '',
            status: 'Başarılı',
            date: new Date().toLocaleString('tr-TR')
        });
        if (logs.length > 5000) logs.shift();
        chrome.storage.local.set({ actionOutputLogs: logs });
    });
}

// İşlemler "Takip Ettiklerin" akışında yapılır — önerilen (Senin için) akışında değil.
// Doğru akışta değilsek yönlendirir; sayfa yüklenince pendingKey ile otomatik devam edilir.
function ensureFollowingFeed(pendingKey, taskName) {
    const onHome = location.pathname === '/';
    const isFollowingVariant = location.search.includes('variant=following');
    if (onHome && isFollowingVariant) return true;
    chrome.storage.local.set({ [pendingKey]: Date.now() });
    log(`"Takip Ettiklerin" akışına yönlendiriliyor, ${taskName} otomatik başlayacak...`, 'info');
    location.assign('https://www.instagram.com/?variant=following');
    return false;
}

// opts.managed: karma mod içinden adım olarak çağrıldı (isRunning yönetimi dışarıda)
// opts.actionLimit: bu çağrıda en fazla bu kadar işlem yap, sonra dur
async function viewAllFeedStoriesUI(opts = {}) {
    const managed = !!opts.managed;
    if (!managed) {
        if (isRunning) {
            log('Zaten bir işlem çalışıyor. Önce durdurun.', 'warn');
            return 0;
        }
        if (!ensureFollowingFeed('pendingStoryView', 'hikaye izleme')) return 0;
        isRunning = true;
        updateState({ status: 'processing' });
    }
    log('Hikaye tepsisi aranıyor...', 'info');
    let sessionActions = 0;

    try {
        const opened = await openStoryPlayer();
        if (!opened) {
            throw new Error('Hikaye oynatıcı açılamadı. Anasayfada aktif hikaye olduğundan emin olun.');
        }

        // Ayarları oku
        const storedSettings = await new Promise(r => chrome.storage.local.get(['settings'], r));
        const s = storedSettings.settings || {};
        // Ortak ayarlar: İşlem Arası Süre, Parti Boyutu, Dinlenme, Günlük Limit
        const minSec = Math.max(1, parseInt(s.minDelay, 10) || 5);
        const maxSec = Math.max(minSec, parseInt(s.maxDelay, 10) || 10);
        const maxPerUser = Math.max(0, parseInt(s.storyMaxPerUser, 10) || 0);   // 0 = sınırsız
        const likesPerUser = Math.max(0, parseInt(s.storyLikesPerUser, 10) || 0); // 0 = beğeni kapalı
        const batchSize = Math.max(0, parseInt(s.storyBatchSize, 10) || 0);     // 0 = dinlenme yok
        const restMin = Math.max(1, parseInt(s.storyRestMinutes, 10) || 5);
        const dailyLimit = Math.max(1, parseInt(s.dailyLimit, 10) || 100);
        const storyBlacklist = parseUserList(s.blacklist);

        let dailyCount = await getDailyCount();
        log(`Bugün bu hesapta ${dailyCount}/${dailyLimit} işlem yapıldı.`, 'info');
        if (dailyCount >= dailyLimit) {
            log('Günlük toplam işlem limiti dolu. Yarın tekrar deneyin veya limiti artırın.', 'warn');
            return 0;
        }
        const countAction = () => { dailyCount++; sessionActions++; incrementDailyCount(1); };

        log(`Hikaye oynatıcı açıldı. Her hikayede ${minSec}-${maxSec} sn beklenip geçilecek...`, 'success');
        if (maxPerUser > 0) log(`Kişi başı en fazla ${maxPerUser} hikaye izlenecek.`, 'info');
        if (likesPerUser > 0) log(`Kişi başı ilk ${likesPerUser} hikaye beğenilecek.`, 'info');
        if (batchSize > 0) log(`Her ${batchSize} işlemde ${restMin} dk dinlenilecek.`, 'info');

        const startTime = Date.now();
        const MAX_DURATION = 2 * 60 * 60 * 1000; // güvenlik: dinlenmeler dahil en fazla 2 saat
        let advanced = 0;
        let manualFailWarned = false;
        let lastRestAt = 0;
        let lastProgressLog = 0;
        let currentUser = getStoryUsername();
        let perUserCount = 1;
        let perUserLiked = 0;

        // URL değişince kullanıcı takibini güncelle
        const registerPosition = () => {
            const u = getStoryUsername();
            if (u && u !== currentUser) {
                currentUser = u;
                perUserCount = 1;
                perUserLiked = 0;
            } else {
                perUserCount++;
            }
        };

        while (isRunning && (Date.now() - startTime) < MAX_DURATION) {
            if (!location.pathname.startsWith('/stories/')) break;

            if (dailyCount >= dailyLimit) {
                log(`Günlük toplam işlem limiti (${dailyLimit}) doldu. Hikaye izleme sonlandırılıyor.`, 'warn');
                break;
            }

            if (opts.actionLimit && sessionActions >= opts.actionLimit) {
                log(`Bu adımın hikaye limiti (${opts.actionLimit}) doldu.`, 'info');
                break;
            }

            // Kara listedeki kullanıcının hikayeleri hiç izlenmeden atlanır
            if (storyBlacklist.length > 0 && currentUser && storyBlacklist.includes(currentUser.toLowerCase())) {
                const skipUser = currentUser;
                const jumped = await skipToNextUser(skipUser);
                if (!location.pathname.startsWith('/stories/')) break;
                if (!jumped) {
                    let guard = 0;
                    while (isRunning && getStoryUsername() === skipUser && location.pathname.startsWith('/stories/') && guard < 40) {
                        await advanceStoryVerified();
                        guard++;
                        await sleep(300);
                    }
                    if (!location.pathname.startsWith('/stories/')) break;
                }
                registerPosition();
                log(`@${skipUser}: kara listede, hikayeleri atlandı.`, 'info');
                continue;
            }

            // Kişi başı hikaye limiti dolduysa kalanları izlemeden sonraki kullanıcıya atla.
            // Not: perUserCount o an ekranda olan hikayeyi de sayar; bu yüzden ">" ile karşılaştırılır
            // ki limit kadar hikaye gerçekten izlensin (örn. limit 1 → 1 hikaye izlenir, 2.'de atlanır).
            if (maxPerUser > 0 && perUserCount > maxPerUser) {
                const skipUser = currentUser;
                const jumped = await skipToNextUser(skipUser);
                if (!location.pathname.startsWith('/stories/')) break;
                if (!jumped) {
                    // Önizleme kartı bulunamadı — yedek yöntem: hızlı geçiş
                    let guard = 0;
                    while (isRunning && getStoryUsername() === skipUser && location.pathname.startsWith('/stories/') && guard < 40) {
                        await advanceStoryVerified();
                        guard++;
                        await sleep(300);
                    }
                    if (!location.pathname.startsWith('/stories/')) break;
                }
                registerPosition();
                log(`@${skipUser}: kişi başı limit (${maxPerUser}) doldu, sonraki hesaba geçildi (${jumped ? 'kart tıklama' : 'hızlı geçiş'}).`, 'info');
                continue;
            }

            // Rastgele bekleme: min-max saniye arası.
            // Beğeni, hikaye açılır açılmaz değil, beklemenin %20-%80'i arasında rastgele bir anda yapılır.
            const waitMs = (minSec + Math.random() * (maxSec - minSec)) * 1000;
            const beforeWait = location.href;
            const willLike = likesPerUser > 0 && perUserLiked < likesPerUser;
            if (willLike) {
                const likeAt = 0.2 + Math.random() * 0.6;
                await sleep(waitMs * likeAt);
                if (!isRunning) break;
                if (location.href === beforeWait && location.pathname.startsWith('/stories/')) {
                    const likeBtn = findStoryLikeButton();
                    if (likeBtn) {
                        likeBtn.click();
                        perUserLiked++;
                        log(`@${currentUser}: hikaye beğenildi (${perUserLiked}/${likesPerUser})`, 'info');
                        recordStoryAction('Hikaye Beğeni', currentUser);
                        countAction();
                    }
                }
                await sleep(waitMs * (1 - likeAt));
            } else {
                await sleep(waitMs);
            }
            if (!isRunning) break;
            if (!location.pathname.startsWith('/stories/')) break;

            if (location.href !== beforeWait) {
                // Bekleme sırasında hikaye kendi kendine geçmiş
                advanced++;
                recordStoryAction('Hikaye İzleme', currentUser);
                countAction();
                registerPosition();
            } else if (maxPerUser > 0 && perUserCount >= maxPerUser) {
                // Bu kullanıcıdan izlenecek son hikaye izlendi — "ileri" yerine
                // doğrudan sonraki kullanıcının kartına tıkla (2. hikaye hiç açılmaz)
                const skipUser = currentUser;
                const jumped = await skipToNextUser(skipUser);
                advanced++;
                recordStoryAction('Hikaye İzleme', skipUser);
                countAction();
                if (!location.pathname.startsWith('/stories/')) break;
                if (!jumped) {
                    await advanceStoryVerified(); // yedek: normal geçiş (üstteki limit kontrolü toparlar)
                }
                registerPosition();
                log(`@${skipUser}: kişi başı limit (${maxPerUser}) doldu, sonraki hesaba geçildi (${jumped ? 'kart tıklama' : 'hızlı geçiş'}).`, 'info');
            } else {
                const method = await advanceStoryVerified();
                if (method) {
                    advanced++;
                    if (advanced === 1) log(`Geçiş yöntemi doğrulandı: ${method}`, 'info');
                    recordStoryAction('Hikaye İzleme', currentUser);
                countAction();
                    registerPosition();
                } else if (location.pathname.startsWith('/stories/')) {
                    // Hiçbir yöntem işe yaramadı — doğal akışa bırak
                    if (!manualFailWarned) {
                        log('Otomatik geçiş yapılamıyor; hikayeler kendi süresinde izlenecek.', 'warn');
                        manualFailWarned = true;
                    }
                    const naturalBefore = location.href;
                    let naturalWait = 0;
                    while (isRunning && location.href === naturalBefore && location.pathname.startsWith('/stories/') && naturalWait < 20000) {
                        await sleep(500);
                        naturalWait += 500;
                    }
                    if (location.href !== naturalBefore && location.pathname.startsWith('/stories/')) {
                        advanced++;
                        recordStoryAction('Hikaye İzleme', currentUser);
                countAction();
                        registerPosition();
                    }
                } else {
                    break;
                }
            }

            if (advanced > 0 && advanced % 10 === 0 && advanced !== lastProgressLog) {
                lastProgressLog = advanced;
                log(`${advanced} hikaye gezildi, devam ediyor...`, 'info');
            }
            updateState({ processed: (appState.processed || 0) + 1 });

            // Parti dolduysa oynatıcıyı kapat, dinlen, tekrar başla (karma mod adımında dinlenme dışarıda)
            if (batchSize > 0 && !managed && advanced > 0 && advanced % batchSize === 0 && advanced !== lastRestAt) {
                lastRestAt = advanced;
                log(`${advanced} hikaye izlendi. ${restMin} dk dinleniliyor...`, 'info');
                await closeStoryPlayer();
                await sleep(restMin * 60 * 1000);
                if (!isRunning) break;
                log('Dinlenme bitti, hikaye izlemeye devam ediliyor...', 'info');
                const reopened = await openStoryPlayer();
                if (!reopened) {
                    log('İzlenecek yeni hikaye halkası bulunamadı, işlem tamamlandı.', 'info');
                    break;
                }
                currentUser = getStoryUsername();
                perUserCount = 1;
                perUserLiked = 0;
            }
        }

        if (location.pathname.startsWith('/stories/')) {
            log(`Hikaye izleme durduruldu (${advanced} hikaye gezildi).`, 'info');
        } else {
            log(`✓ Tüm hikayeler izlendi (${advanced} hikaye gezildi). Oynatıcı kapandı.`, 'success');
        }
    } catch (err) {
        log(`Hikaye izleme hatası: ${err.message}`, 'error');
    } finally {
        if (managed) {
            // Karma mod adımı: oynatıcı açık kaldıysa kapat, isRunning'e dokunma
            if (location.pathname.startsWith('/stories/')) await closeStoryPlayer();
        } else {
            isRunning = false;
            updateState({ status: 'idle' });
        }
    }
    return sessionActions;
}

// --- Anasayfa gönderilerini beğenme (UI tabanlı) ---
function getPostUsername(article) {
    const reserved = ['explore', 'reels', 'direct', 'stories', 'p', 'reel', 'tv', 'accounts'];
    const links = article.querySelectorAll('a[href]');
    for (const link of links) {
        let href = link.getAttribute('href') || '';
        try { if (href.startsWith('http')) href = new URL(href).pathname; } catch (e) { continue; }
        const m = href.match(/^\/([A-Za-z0-9._]{2,30})\/?$/);
        if (m && !reserved.includes(m[1])) return m[1];
    }
    return null;
}

// Gönderi şu an beğenilmiş mi? (dolu kalp: "Beğenmekten vazgeç" / "Unlike")
function isPostLiked(article) {
    for (const el of article.querySelectorAll('svg[aria-label]')) {
        const al = (el.getAttribute('aria-label') || '').toLowerCase();
        if (al.includes('vazgeç') || al.includes('unlike')) return true;
    }
    return false;
}

// --- Hesap bazlı günlük işlem sayacı ---
// dailyStats: { "<hesapId>": { date: "YYYY-MM-DD", count: N } }
function todayStr() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function getDailyCount() {
    return new Promise(resolve => {
        const uid = getUserId() || 'unknown';
        chrome.storage.local.get(['dailyStats'], (d) => {
            const st = (d.dailyStats || {})[uid];
            resolve(st && st.date === todayStr() ? st.count : 0);
        });
    });
}

function incrementDailyCount(n = 1) {
    const uid = getUserId() || 'unknown';
    chrome.storage.local.get(['dailyStats'], (d) => {
        const stats = d.dailyStats || {};
        const st = stats[uid];
        const count = (st && st.date === todayStr() ? st.count : 0) + n;
        stats[uid] = { date: todayStr(), count };
        chrome.storage.local.set({ dailyStats: stats });
    });
}

function parseUserList(str) {
    // Virgülle ayrılmış kullanıcı adları; baştaki @ isteğe bağlı
    return (str || '').split(',')
        .map(x => x.trim().toLowerCase().replace(/^@/, ''))
        .filter(Boolean);
}

async function likeFeedPosts(opts = {}) {
    const managed = !!opts.managed;
    if (!managed) {
        if (isRunning) {
            log('Zaten bir işlem çalışıyor. Önce durdurun.', 'warn');
            return 0;
        }
        if (!ensureFollowingFeed('pendingFeedLike', 'gönderi beğenme')) return 0;
        isRunning = true;
        updateState({ status: 'processing' });
    }
    let sessionLiked = 0;

    try {
        const storedSettings = await new Promise(r => chrome.storage.local.get(['settings'], r));
        const s = storedSettings.settings || {};
        // Ortak ayarlar: İşlem Arası Süre, Parti Boyutu, Dinlenme, Günlük Limit
        const minSec = Math.max(2, parseInt(s.minDelay, 10) || 5);
        const maxSec = Math.max(minSec, parseInt(s.maxDelay, 10) || 10);
        const batch = Math.max(0, parseInt(s.storyBatchSize, 10) || 0); // 0 = parti yok, kesintisiz
        // Karma mod adımında hedef, adım limiti kadardır
        const target = opts.actionLimit ? opts.actionLimit : (batch > 0 ? batch : Infinity);
        const restMinutes = Math.max(1, parseInt(s.storyRestMinutes, 10) || 5);
        const dailyLimit = Math.max(1, parseInt(s.dailyLimit, 10) || 100);
        const blacklistArr = parseUserList(s.blacklist);

        let dailyCount = await getDailyCount();
        log(`Bugün bu hesapta ${dailyCount}/${dailyLimit} işlem yapıldı.`, 'info');
        if (dailyCount >= dailyLimit) {
            log('Günlük toplam işlem limiti dolu. Yarın tekrar deneyin veya limiti artırın.', 'warn');
            return 0;
        }

        log(`Anasayfa gönderileri beğeniliyor. Aralık: ${minSec}-${maxSec} sn`, 'info');
        if (blacklistArr.length > 0) log(`Kara listedeki ${blacklistArr.length} kullanıcı atlanacak.`, 'info');
        if (batch > 0) log(`Her ${batch} beğeniden sonra ${restMinutes} dk dinlenip yeni tura başlanacak.`, 'info');

        const processed = new Set();
        let skippedLiked = 0;
        let totalLiked = 0;
        let round = 1;
        let exhausted = false;
        const overallStart = Date.now();
        const OVERALL_MAX = 4 * 60 * 60 * 1000; // dinlenmeler dahil en fazla 4 saat

        while (isRunning && !exhausted && dailyCount < dailyLimit && (Date.now() - overallStart) < OVERALL_MAX) {

        let liked = 0;
        let idleRounds = 0;
        const startTime = Date.now();
        const MAX_DURATION = 30 * 60 * 1000; // tur başına en fazla 30 dk

        while (isRunning && liked < target && dailyCount < dailyLimit && idleRounds < 5 && (Date.now() - startTime) < MAX_DURATION) {
            let actedThisRound = false;
            const articles = document.querySelectorAll('article');

            for (const article of articles) {
                if (!isRunning || liked >= target) break;
                if (processed.has(article)) continue;
                processed.add(article);

                const username = getPostUsername(article) || 'bilinmiyor';

                // Kara listedeki kullanıcıların gönderileri atlanır
                if (blacklistArr.includes(username.toLowerCase())) {
                    log(`@${username}: kara listede, gönderisi atlandı.`, 'info');
                    continue;
                }

                // Zaten beğenilmişse atla
                if (isPostLiked(article)) {
                    skippedLiked++;
                    continue;
                }
                const svg = article.querySelector('section svg[aria-label="Beğen"], section svg[aria-label="Like"]');
                if (!svg) continue;
                const btn = svg.closest('[role="button"], button');
                if (!btn) continue;

                // Gönderiyi ekrana getir — doğal görünüm için
                article.scrollIntoView({ behavior: 'smooth', block: 'center' });
                await sleep(800 + Math.random() * 700);
                if (!isRunning) break;

                // Tam fare olay dizisiyle tıkla (düz click() React tarafından yutulabiliyor)
                const br = btn.getBoundingClientRect();
                simulateClick(btn, Math.floor(br.left + br.width / 2), Math.floor(br.top + br.height / 2));
                await sleep(1000);

                // Beğeninin gerçekten işlendiğini doğrula (kalp doluya döndü mü?)
                // Gönderi bloğu React tarafından yeniden oluşturulduysa eski referans
                // kopuk kalır ve durum okunamaz — tıklama yapıldığı için başarılı say
                let confirmed = !article.isConnected || isPostLiked(article);

                // Yedek: gönderi görseline çift tıklayarak beğen
                if (!confirmed) {
                    const mediaEl = article.querySelector('video, img[srcset], div[role="button"] img');
                    if (mediaEl) {
                        mediaEl.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, view: window }));
                        await sleep(1000);
                        confirmed = isPostLiked(article);
                    }
                }
                if (confirmed) {
                    liked++;
                    sessionLiked++;
                    dailyCount++;
                    incrementDailyCount(1);
                    actedThisRound = true;
                    log(`@${username}: gönderi beğenildi (${batch > 0 ? `${liked}/${batch}` : liked}, bugün ${dailyCount}/${dailyLimit})`, 'success');
                    recordStoryAction('Gönderi Beğeni', username);
                    updateState({ processed: (appState.processed || 0) + 1 });
                } else {
                    log(`@${username}: beğeni işlenmedi, atlanıyor.`, 'warn');
                }

                if (liked < target && isRunning) {
                    const delay = (minSec + Math.random() * (maxSec - minSec)) * 1000;
                    await sleep(delay);
                }
            }

            if (!isRunning || liked >= target) break;

            // Yeni gönderi yüklenmesi için aşağı kaydır
            idleRounds = actedThisRound ? 0 : idleRounds + 1;
            window.scrollBy(0, window.innerHeight * 1.5);
            await sleep(1500 + Math.random() * 1000);
        }

        totalLiked += liked;

        if (dailyCount >= dailyLimit) {
            log(`Günlük toplam işlem limiti (${dailyLimit}) doldu. İşlem sonlandırılıyor.`, 'warn');
            break;
        }

        if (managed) break; // karma mod adımı tek turdur; dinlenme dışarıda yapılır

        if (liked >= target) {
            log(`✓ Tur ${round} tamamlandı: ${liked} gönderi beğenildi (toplam ${totalLiked}).`, 'success');
        } else if (!isRunning) {
            log(`Durduruldu: bu turda ${liked}, toplam ${totalLiked} gönderi beğenildi.`, 'info');
            break;
        } else {
            log(`Akışta beğenilecek yeni gönderi kalmadı (toplam ${totalLiked} beğeni).`, 'info');
            exhausted = true;
            break;
        }

        log(`${restMinutes} dk dinleniliyor, sonra yeni beğeni turu başlayacak...`, 'info');
        window.scrollTo(0, 0); // dinlenme sonrası yeni gönderiler için başa dön
        await sleep(restMinutes * 60 * 1000);
        round++;

        }

        log(`Gönderi beğenme bitti: toplam ${totalLiked} beğeni (${skippedLiked} gönderi zaten beğeniliydi).`, 'info');
    } catch (err) {
        log(`Gönderi beğenme hatası: ${err.message}`, 'error');
    } finally {
        if (!managed) {
            isRunning = false;
            updateState({ status: 'idle' });
        }
    }
    return sessionLiked;
}

// --- Karma Mod: her turda N hikaye izle + M gönderi beğen, dinlen, tekrarla ---
async function runComboMode() {
    if (isRunning) {
        log('Zaten bir işlem çalışıyor. Önce durdurun.', 'warn');
        return;
    }
    if (!ensureFollowingFeed('pendingCombo', 'karma mod')) return;

    isRunning = true;
    updateState({ status: 'processing' });

    try {
        const stored = await new Promise(r => chrome.storage.local.get(['settings'], r));
        const s = stored.settings || {};
        const comboStories = Math.max(0, parseInt(s.comboStories, 10) || 10);
        const comboLikes = Math.max(0, parseInt(s.comboLikes, 10) || 5);
        const restMin = Math.max(1, parseInt(s.storyRestMinutes, 10) || 5);
        const dailyLimit = Math.max(1, parseInt(s.dailyLimit, 10) || 100);

        if (comboStories === 0 && comboLikes === 0) {
            log('Karma mod için hikaye veya beğeni sayısı ayarlayın (ikisi de 0).', 'warn');
            return;
        }

        log(`Karma mod başladı: tur başına ${comboStories} hikaye + ${comboLikes} beğeni, aralarda ${restMin} dk dinlenme.`, 'success');

        let round = 1;
        const overallStart = Date.now();
        const OVERALL_MAX = 6 * 60 * 60 * 1000; // güvenlik: dinlenmeler dahil en fazla 6 saat

        while (isRunning && (Date.now() - overallStart) < OVERALL_MAX) {
            const dailyCount = await getDailyCount();
            if (dailyCount >= dailyLimit) {
                log(`Günlük toplam işlem limiti (${dailyLimit}) doldu. Karma mod sonlandırılıyor.`, 'warn');
                break;
            }

            let roundActions = 0;

            if (comboStories > 0 && isRunning) {
                log(`— Karma tur ${round}: hikaye adımı (${comboStories} hikaye) —`, 'info');
                roundActions += await viewAllFeedStoriesUI({ managed: true, actionLimit: comboStories }) || 0;
            }

            if (comboLikes > 0 && isRunning) {
                log(`— Karma tur ${round}: beğeni adımı (${comboLikes} gönderi) —`, 'info');
                roundActions += await likeFeedPosts({ managed: true, actionLimit: comboLikes }) || 0;
            }

            if (!isRunning) break;

            if (roundActions === 0) {
                log('Bu turda hiç işlem yapılamadı (içerik tükendi). Karma mod sonlandırılıyor.', 'info');
                break;
            }

            log(`✓ Karma tur ${round} bitti (${roundActions} işlem). ${restMin} dk dinleniliyor...`, 'success');
            await sleep(restMin * 60 * 1000);
            round++;
        }

        log('Karma mod tamamlandı.', 'success');
    } catch (err) {
        log(`Karma mod hatası: ${err.message}`, 'error');
    } finally {
        isRunning = false;
        updateState({ status: 'idle' });
    }
}

// Anasayfaya yönlendirme sonrası otomatik devam
chrome.storage.local.get(['pendingStoryView', 'pendingFeedLike', 'pendingCombo'], (data) => {
    if (data.pendingStoryView) {
        chrome.storage.local.remove('pendingStoryView');
        if ((Date.now() - data.pendingStoryView) < 90000 && location.pathname === '/') {
            setTimeout(() => viewAllFeedStoriesUI(), 3000);
            return;
        }
    }
    if (data.pendingFeedLike) {
        chrome.storage.local.remove('pendingFeedLike');
        if ((Date.now() - data.pendingFeedLike) < 90000 && location.pathname === '/') {
            setTimeout(() => likeFeedPosts(), 3000);
            return;
        }
    }
    if (data.pendingCombo) {
        chrome.storage.local.remove('pendingCombo');
        if ((Date.now() - data.pendingCombo) < 90000 && location.pathname === '/') {
            setTimeout(() => runComboMode(), 3000);
        }
    }
});

async function startAction(actionType, settings) {
    if (isRunning) return;

    // Storage'dan listeyi oku — liste sayfasından tetiklenince nonFollowers burada boş olabilir
    const stored = await new Promise(resolve => chrome.storage.local.get(['nonFollowers'], resolve));
    if (stored.nonFollowers && stored.nonFollowers.length > 0) {
        nonFollowers = stored.nonFollowers;
    }

    if (nonFollowers.length === 0) {
        log('İşlem yapılacak kullanıcı yok. Önce tarama yapın.', 'error');
        return;
    }

    isRunning = true;
    updateState({ status: 'processing' });
    log(`İşlem başlatıldı (${actionType}). Günlük limit: ${settings.dailyLimit}`, 'info');

    try {
        const csrfToken = getCsrfToken();
        if (!csrfToken) {
            throw new Error("CSRF token bulunamadı.");
        }

        let processedToday = 0;
        const dailyDone = await getDailyCount();
        if (dailyDone > 0) {
            log(`Bugün bu hesapta ${dailyDone}/${settings.dailyLimit} işlem yapılmış.`, 'info');
        }
        const isUnfollow = actionType === 'unfollow_nonfollowers' || actionType === 'unfollow_followers' || actionType === 'unfollow_private';
        const baseDelay = isUnfollow
            ? (settings.unfollowDelay || 2000)
            : Math.floor(Math.random() * (settings.maxDelay - settings.minDelay + 1) + settings.minDelay) * 1000;
        const pauseDelay = settings.unfollowPauseDelay || 10000;

        for (let i = 0; i < nonFollowers.length; i++) {
            if (!isRunning) break;
            if (processedToday + dailyDone >= settings.dailyLimit) {
                log('Günlük işlem limitine ulaşıldı (hesap bazlı sayaç dahil). Yarına kadar durduruluyor.', 'info');
                break;
            }

            let targetUser = nonFollowers[i];
            let userId = targetUser.id;
            let username = targetUser.username;
            let endpoint = '';
            let actionName = '';

            // ID kontrolü
            if (!userId || userId === 'unknown') {
                log(`⚠️ @${username} için geçerli ID bulunamadı. Atlanıyor.`, 'warn');
                continue;
            }

            // Toplama sırasında kullanıcı adı çözülememişse (bazı API yanıtları username döndürmez),
            // profil bilgisini ID'den çekip gerçek adı bulmayı dene (yalnızca burada, tek seferlik).
            if (!username || username === 'unknown') {
                const resolved = await getUsernameById(userId, csrfToken);
                if (resolved) {
                    username = resolved;
                    targetUser.username = resolved;
                    nonFollowers[i].username = resolved;
                } else {
                    log(`⚠️ ID: ${userId} için kullanıcı adı çözülemedi (hesap silinmiş/kısıtlı olabilir).`, 'warn');
                }
            }

            // For DOM scraper fallback, userId might be a string username
            if (actionType === 'unfollow_nonfollowers' || actionType === 'unfollow_followers' || actionType === 'unfollow_private' || actionType === 'unfollow_nonfollowers_tracked') {
                endpoint = `https://www.instagram.com/api/v1/friendships/destroy/${userId}/`;
                actionName = 'Takipten Çıkarma';
            } else {
                endpoint = `https://www.instagram.com/api/v1/friendships/create/${userId}/`;
                actionName = 'Takip Etme';

                // --- PREMIUM FEATURES: Auto-Like & Auto-Story ---
                if (settings.autoLike && isRunning) {
                    await performAutoLike(username, csrfToken);
                }
                if (settings.autoStory && isRunning) {
                    await performAutoStoryView(userId, csrfToken);
                }
                // ------------------------------------------------
            }

            let res = null;
            let actionStatus = 'Başarısız';
            
            try {
                // Doğru endpoint: /api/v1/friendships/create/ veya /delete/
                res = await fetch(endpoint, {
                    method: 'POST',
                    headers: {
                        'x-csrftoken': csrfToken,
                        'x-ig-app-id': '936619743392459',
                        'content-type': 'application/x-www-form-urlencoded'
                    }
                });

                if (res.ok) {
                    actionStatus = 'Başarılı';
                    processedToday++;
                    incrementDailyCount(1);
                    log(`${actionName} başarılı: @${username} (${processedToday}/${settings.dailyLimit})`, 'success');
                    updateState({ processed: appState.processed + 1 });

                    // list.html'e progress bildir
                    chrome.runtime.sendMessage({
                        type: 'ACTION_PROGRESS',
                        actionName,
                        username,
                        userId,
                        status: 'success',
                        processed: processedToday,
                        total: nonFollowers.length
                    });

                    // Takip işlemiyse geçmişe kaydet
                    if (actionType !== 'unfollow_nonfollowers' && actionType !== 'unfollow_followers' && actionType !== 'unfollow_private' && actionType !== 'unfollow_nonfollowers_tracked') {
                        chrome.storage.local.get(['followedByApp'], (stored) => {
                            const list = stored.followedByApp || [];
                            // Zaten varsa güncelle, yoksa ekle
                            const existing = list.findIndex(u => String(u.id) === String(userId));
                            const entry = { id: String(userId), username, followedAt: new Date().toISOString() };
                            if (existing >= 0) list[existing] = entry; else list.push(entry);
                            chrome.storage.local.set({ followedByApp: list });
                        });
                    }
                    // Tracked modda unfollow edilince geçmişten de çıkar
                    if (actionType === 'unfollow_nonfollowers_tracked') {
                        chrome.storage.local.get(['followedByApp'], (stored) => {
                            const list = (stored.followedByApp || []).filter(u => String(u.id) !== String(userId));
                            chrome.storage.local.set({ followedByApp: list });
                        });
                    }
                } else {
                    log(`${actionName} başarısız: @${username} (ID: ${userId}, HTTP ${res.status})`, 'error');
                    if (res.status === 429) {
                        log(`Instagram kısıtlaması (Rate Limit) algılandı. İşlem durduruluyor.`, 'error');
                        break;
                    }
                }
            } catch (e) {
                log(`${actionName} hatası: @${username} (${e.message})`, 'error');
            }

            // Save log to persistent storage for export
            chrome.storage.local.get(['actionOutputLogs'], (stored) => {
                let logs = stored.actionOutputLogs || [];
                logs.push({
                    action: actionName,
                    username: username,
                    userId: userId,
                    status: actionStatus,
                    date: new Date().toLocaleString('tr-TR')
                });
                if (logs.length > 5000) logs.shift(); // Keep max 5000
                chrome.storage.local.set({ actionOutputLogs: logs });
            });

            // Anti-ban random delay
            if (i < nonFollowers.length - 1 && isRunning) {
                let delay;
                if (isUnfollow) {
                    // Her 5 işlemde bir uzun mola
                    if ((processedToday > 0) && (processedToday % 5 === 0)) {
                        delay = pauseDelay;
                        log(`5 işlem tamamlandı, ${(delay / 1000).toFixed(1)} saniye bekleniyor...`, 'info');
                    } else {
                        delay = baseDelay + Math.floor(Math.random() * 500);
                        log(`${(delay / 1000).toFixed(1)} saniye bekleniyor...`, 'info');
                    }
                } else {
                    delay = Math.floor(Math.random() * (settings.maxDelay - settings.minDelay + 1) + settings.minDelay) * 1000;
                    log(`${(delay / 1000).toFixed(1)} saniye bekleniyor...`, 'info');
                }
                await sleep(delay);
            }
        }

        if (isRunning) {
            log('İşlem süreci tamamlandı veya limite ulaşıldı.', 'success');
            chrome.runtime.sendMessage({ type: 'ACTION_COMPLETE', processed: processedToday, total: nonFollowers.length });
        } else {
            log('İşlem kullanıcı tarafından durduruldu.', 'info');
            chrome.runtime.sendMessage({ type: 'ACTION_COMPLETE', processed: processedToday, total: nonFollowers.length, stopped: true });
        }
    } catch (err) {
        log(`Hata: ${err.message}`, 'error');
    } finally {
        isRunning = false;
        updateState({ status: 'idle' });
    }
}

// Listen for messages from the popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === 'PING') {
        sendResponse({ ok: true });
    } else if (request.type === 'MANUAL_FOLLOW_ACTION') {
        const { userId, action } = request; // action: 'follow' | 'unfollow'
        const endpoint = action === 'follow'
            ? `https://www.instagram.com/api/v1/friendships/create/${userId}/`
            : `https://www.instagram.com/api/v1/friendships/destroy/${userId}/`;
        fetch(endpoint, {
            method: 'POST',
            headers: {
                'x-ig-app-id': '936619743392459',
                'x-csrftoken': getCsrfToken() || '',
                'content-type': 'application/x-www-form-urlencoded'
            }
        }).then(r => r.json())
          .then(data => sendResponse({ ok: true, data }))
          .catch(e => sendResponse({ ok: false, error: e.message }));
        return true; // async
    } else if (request.action === 'START_SCAN') {
        scanTargetUsers(request.actionType, request.settings || {});
        sendResponse({ ok: true });
    } else if (request.action === 'START_ACTION') {
        sendResponse({ ok: true }); // hemen cevap ver, async işlem arka planda devam eder
        startAction(request.actionType, request.settings);
    } else if (request.action === 'VIEW_ALL_STORIES') {
        sendResponse({ ok: true });
        viewAllFeedStoriesUI();
    } else if (request.action === 'LIKE_FEED_POSTS') {
        sendResponse({ ok: true });
        likeFeedPosts();
    } else if (request.action === 'COMBO_MODE') {
        sendResponse({ ok: true });
        runComboMode();
    } else if (request.action === 'STOP') {
        isRunning = false;
        log('İşlem durduruluyor...', 'info');
        sendResponse({ ok: true });
    } else if (request.action === 'REFRESH_HASHES') {
        extractQueryHashesFromInstagram().then(() => {
            sendResponse({ success: true });
        }).catch((e) => {
            log(`Hash güncelleme hatası: ${e.message}`, 'error');
            sendResponse({ success: false, error: e.message });
        });
        return true;
    }
});
