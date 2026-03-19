// Background service worker for handling overall limits, persistent state, and alarms.
// Currently acts as a relay, but could handle alarms for background processing in the future.

chrome.runtime.onInstalled.addListener(() => {
    chrome.storage.local.set({
        appState: { status: 'idle', scanned: 0, unfollowed: 0 },
        settings: { minDelay: 4, maxDelay: 8, dailyLimit: 100 },
        logs: []
    });
    console.log("InstaCleaner installed and initialized.");
});

function addLog(msg, logType) {
    chrome.storage.local.get(['logs'], (data) => {
        let logs = data.logs || [];
        logs.push({ msg, type: logType });
        if (logs.length > 50) logs.shift();
        chrome.storage.local.set({ logs });
        chrome.runtime.sendMessage({ type: 'LOG', msg, logType }).catch(() => {});
    });
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === 'SAVE_STATE') {
        chrome.storage.local.set({ appState: request.state });
        chrome.runtime.sendMessage({ type: 'UPDATE_STATE', state: request.state }).catch(() => {});
    } else if (request.type === 'ADD_LOG') {
        addLog(request.msg, request.logType);
    } else if (request.type === 'OPEN_LIST_PAGE') {
        chrome.tabs.create({ url: chrome.runtime.getURL('list.html') });
    } else if (request.type === 'FETCH_IMAGE') {
        // Background service worker host_permissions sayesinde direkt fetch yapabilir
        fetch(request.url)
            .then(res => res.blob())
            .then(blob => new Promise((resolve) => {
                const reader = new FileReader();
                reader.onloadend = () => resolve(reader.result);
                reader.readAsDataURL(blob);
            }))
            .then(dataUrl => sendResponse({ dataUrl }))
            .catch(() => sendResponse({ dataUrl: null }));
        return true; // async
    }
});