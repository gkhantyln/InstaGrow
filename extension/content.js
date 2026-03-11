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
    console.log(`[InstaCleaner] ${msg}`);
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

        if (actionType === 'follow_following' || actionType === 'unfollow_nonfollowers') {
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

            // GraphQL ile beğenenler çek (daha güvenilir)
            queryHash = '1cb6ec562411f7b1d4a2c4a6cdee6db5'; // Likers query hash
            edgePath = 'edge_liked_by';
            varsObj = { shortcode: shortcode, first: 50 };
            
            // Fallback: V1 API ile de dene
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

                    if (data.users && data.users.length > 0) {
                        data.users.forEach(u => {
                            const username = u.username || 'unknown';
                            const userId = u.pk || u.id;
                            
                            if (!userId) {
                                log(`⚠️ @${username} için ID bulunamadı. Atlanıyor.`, 'warn');
                                return;
                            }
                            
                            if (blacklistArr.includes(username.toLowerCase())) return;
                            if (settings.skipPrivate && u.is_private) return;
                            if (settings.skipNoPic && u.profile_pic_url && u.profile_pic_url.includes('default_v0')) return;

                            nonFollowers.push({ id: userId, username: username });
                        });
                        totalFetched += data.users.length;
                    }
                    updateState({ scanned: nonFollowers.length });
                    hasNextPage = false;
                    log(`V1 API'den ${data.users?.length || 0} beğenen çekildi`, 'success');
                    return; // V1 API başarılı, GraphQL'e geçme
                }
            } catch (e) {
                log(`V1 API hatası: ${e.message}. GraphQL deneniyor...`, 'info');
            }
            
            // GraphQL'e devam et
            hasNextPage = true;

        } else if (actionType === 'follow_commenters') {
            queryHash = queryHashCache.follow_commenters || '33ba35852cb50da46f5b5e889df7d159'; // Commenters
            edgePath = 'edge_media_to_comment';
            const shortcodeMatch = window.location.pathname.match(/\/(?:p|reel|tv)\/([^\/]+)/);
            if (!shortcodeMatch) {
                throw new Error("Lütfen işlemi başlatmadan önce bir GÖNDERİ ekranına girin veya gönderiye tıklayın.");
            }
            varsObj = { shortcode: shortcodeMatch[1], first: 50 };
        } else {
            throw new Error("Bilinmeyen işlem türü: " + actionType);
        }

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
            if (actionType === 'follow_commenters') {
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

                // Eğer ID bulunamadıysa, username'den ID çıkarmaya çalış
                if (!userId) {
                    log(`⚠️ @${username} için ID bulunamadı. Atlanıyor.`, 'warn');
                    return;
                }

                // Blacklist check (For Follow actions)
                if (actionType !== 'unfollow_nonfollowers' && blacklistArr.includes(username.toLowerCase())) return;

                // Whitelist check (For Unfollow actions)
                if (actionType === 'unfollow_nonfollowers' && whitelistArr.includes(username.toLowerCase())) return;

                // Smart Filters
                if (settings.skipPrivate && userNode.is_private) return;
                if (settings.skipNoPic && userNode.profile_pic_url && userNode.profile_pic_url.includes('default_v0')) return;

                if (actionType === 'unfollow_nonfollowers') {
                    if (userNode.follows_viewer === false || userNode.follows_viewer === undefined) {
                        nonFollowers.push({ id: userId, username: username });
                    }
                } else {
                    nonFollowers.push({ id: userId, username: username }); // Storing as object
                }
            });

            updateState({ scanned: nonFollowers.length });

            if (hasNextPage && isRunning) {
                // Sleep to avoid rate limits
                await sleep(1500 + Math.random() * 1000);
            }
        }

        if (isRunning) {
            log(`Tarama tamamlandı. Toplam ${nonFollowers.length} hedef kullanıcı listeye eklendi.`, 'success');
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
            if (actionType === 'unfollow_nonfollowers') {
                endpoint = `https://www.instagram.com/api/v1/friendships/delete/${userId}/`;
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
                const delay = Math.floor(Math.random() * (settings.maxDelay - settings.minDelay + 1) + settings.minDelay) * 1000;
                log(`${(delay / 1000).toFixed(1)} saniye bekleniyor...`, 'info');
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
    } else if (request.action === 'START_ACTION') {
        startAction(request.actionType, request.settings);
    } else if (request.action === 'STOP') {
        isRunning = false;
        log('İşlem durduruluyor...', 'info');
    } else if (request.action === 'REFRESH_HASHES') {
        extractQueryHashesFromInstagram().then(() => {
            sendResponse({ success: true });
        }).catch((e) => {
            log(`Hash güncelleme hatası: ${e.message}`, 'error');
            sendResponse({ success: false, error: e.message });
        });
        return true; // Async response için gerekli
    }
});
