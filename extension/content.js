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

        const res = await fetch('https://www.instagram.com/', {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            },
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
                const whitelistArr = settings.whitelist ? settings.whitelist.split(',').map(s => s.trim().toLowerCase()).filter(Boolean) : [];

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
                const whitelistArr = settings.whitelist ? settings.whitelist.split(',').map(s => s.trim().toLowerCase()).filter(Boolean) : [];
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
                    const whitelistArr = settings.whitelist ? settings.whitelist.split(',').map(s => s.trim().toLowerCase()).filter(Boolean) : [];
                    const blacklistArr = settings.blacklist ? settings.blacklist.split(',').map(s => s.trim().toLowerCase()).filter(Boolean) : [];
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

            const whitelistArr = settings.whitelist ? settings.whitelist.split(',').map(s => s.trim().toLowerCase()).filter(Boolean) : [];
            const blacklistArr = settings.blacklist ? settings.blacklist.split(',').map(s => s.trim().toLowerCase()).filter(Boolean) : [];

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
            // Listeyi storage'a kaydet ve yeni sekmede aç
            chrome.storage.local.set({ nonFollowers, listActionType: actionType }, () => {
                chrome.runtime.sendMessage({ type: 'OPEN_LIST_PAGE' });
            });
        } else {
            log('Tarama kullanıcı tarafından durduruldu.', 'info');
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
        const isUnfollow = actionType === 'unfollow_nonfollowers' || actionType === 'unfollow_followers' || actionType === 'unfollow_private';
        const baseDelay = isUnfollow
            ? (settings.unfollowDelay || 2000)
            : Math.floor(Math.random() * (settings.maxDelay - settings.minDelay + 1) + settings.minDelay) * 1000;
        const pauseDelay = settings.unfollowPauseDelay || 10000;

        for (let i = 0; i < nonFollowers.length; i++) {
            if (!isRunning) break;
            if (processedToday >= settings.dailyLimit) {
                log('Günlük işlem limitine ulaşıldı. Yarına kadar durduruluyor.', 'info');
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
                    log(`${actionName} başarılı: @${username} (${processedToday}/${settings.dailyLimit})`, 'success');
                    updateState({ processed: appState.processed + 1 });

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
        } else {
            log('İşlem kullanıcı tarafından durduruldu.', 'info');
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
    if (request.action === 'START_SCAN') {
        scanTargetUsers(request.actionType, request.settings || {});
        sendResponse({ ok: true });
    } else if (request.action === 'START_ACTION') {
        sendResponse({ ok: true }); // hemen cevap ver, async işlem arka planda devam eder
        startAction(request.actionType, request.settings);
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
