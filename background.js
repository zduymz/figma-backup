// Open dashboard in a new tab when extension icon is clicked
chrome.action.onClicked.addListener((tab) => {
  chrome.tabs.create({
    url: chrome.runtime.getURL('dashboard.html')
  });
});

// Track Figma tabs that are waiting for downloads
const figmaTabsWaitingForDownload = new Set();

// Listen for messages from content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'figma-save-initiated') {
    // Content script has initiated a save, track this tab
    if (sender.tab && sender.tab.id) {
      figmaTabsWaitingForDownload.add(sender.tab.id);
      console.log('Tracking Figma tab for download:', sender.tab.id);
    }
  }
});

// Track downloads from Figma tabs and close tabs when downloads complete
const downloadToTabMap = new Map(); // Map downloadId -> tabId

// Listen for download creation
chrome.downloads.onCreated.addListener((downloadItem) => {
  // Find the most recent Figma tab that's waiting for a download
  chrome.tabs.query({ url: 'https://www.figma.com/*' }, (tabs) => {
    // Sort tabs by last accessed time (most recent first)
    tabs.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));
    
    // Find the first tab that's waiting for a download
    for (const tab of tabs) {
      if (figmaTabsWaitingForDownload.has(tab.id)) {
        downloadToTabMap.set(downloadItem.id, tab.id);
        figmaTabsWaitingForDownload.delete(tab.id);
        console.log('Matched download to Figma tab:', tab.id, downloadItem.filename);
        break;
      }
    }
  });
});

// Listen for download completion
chrome.downloads.onChanged.addListener((downloadDelta) => {
  if (downloadDelta.state && downloadDelta.state.current === 'complete') {
    const downloadId = downloadDelta.id;
    const tabId = downloadToTabMap.get(downloadId);
    
    if (tabId) {
      console.log('Download completed, closing tab:', tabId);
      // Wait a moment before closing to ensure download is fully saved
      setTimeout(() => {
        chrome.tabs.remove(tabId, () => {
          if (chrome.runtime.lastError) {
            console.log('Tab already closed or error:', chrome.runtime.lastError.message);
          } else {
            console.log('Tab closed successfully');
          }
        });
        // Clean up the map
        downloadToTabMap.delete(downloadId);
      }, 1000);
    }
  }
  
  // Also handle interrupted downloads
  if (downloadDelta.state && downloadDelta.state.current === 'interrupted') {
    const downloadId = downloadDelta.id;
    const tabId = downloadToTabMap.get(downloadId);
    if (tabId) {
      figmaTabsWaitingForDownload.delete(tabId);
    }
    downloadToTabMap.delete(downloadId);
  }
});

