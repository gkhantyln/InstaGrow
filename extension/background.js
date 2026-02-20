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
        if (logs.length > 50) logs.shift(); // keep last 50
        chrome.storage.local.set({ logs });
        chrome.runtime.sendMessage({ type: 'LOG', msg, logType });
    });
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === 'SAVE_STATE') {
        chrome.storage.local.set({ appState: request.state });
        chrome.runtime.sendMessage({ type: 'UPDATE_STATE', state: request.state });
    } else if (request.type === 'ADD_LOG') {
        addLog(request.msg, request.logType);
    }
});
