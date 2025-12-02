// Open dashboard in a new tab when extension icon is clicked
chrome.action.onClicked.addListener((tab) => {
  chrome.tabs.create({
    url: chrome.runtime.getURL('dashboard.html')
  });
});

// Tab queue management
let urlQueue = [];
let openTabs = new Set(); // Track open tab IDs
const MAX_CONCURRENT_TABS = 10;
let totalFiles = 0;
let openedCount = 0;

// Listen for messages
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'start-download-queue') {
    urlQueue = message.urls;
    totalFiles = message.totalFiles;
    openedCount = 0;
    openTabs.clear();
    console.log(`Starting download queue with ${totalFiles} files, max ${MAX_CONCURRENT_TABS} concurrent tabs`);
    
    // Start opening tabs (up to the limit)
    openNextTabs();
  } else if (message.type === 'figma-save-initiated') {
    // Content script has initiated a save, track this tab
    if (sender.tab && sender.tab.id) {
      figmaTabsWaitingForDownload.add(sender.tab.id);
      console.log('Tracking Figma tab for download:', sender.tab.id);
    }
  }
});

// Open next tabs from queue (up to the limit)
async function openNextTabs() {
  // Calculate how many tabs we can still open
  const tabsToOpen = Math.min(MAX_CONCURRENT_TABS - openTabs.size, urlQueue.length);
  
  for (let i = 0; i < tabsToOpen; i++) {
    // Double-check we're still under the limit before opening
    if (openTabs.size >= MAX_CONCURRENT_TABS) {
      console.log(`Reached max concurrent tabs (${MAX_CONCURRENT_TABS}), stopping`);
      break;
    }
    
    if (urlQueue.length === 0) {
      break;
    }
    
    const url = urlQueue.shift();
    await openTab(url);
  }
}

// Open a single tab (returns a promise)
function openTab(url) {
  return new Promise((resolve) => {
    chrome.tabs.create({ url: url }, (tab) => {
      if (chrome.runtime.lastError) {
        console.error('Error opening tab:', chrome.runtime.lastError);
        openedCount++;
        notifyProgress();
        resolve(); // Resolve to continue with next tab
        return;
      }
      
      openTabs.add(tab.id);
      openedCount++;
      console.log(`Opened tab ${tab.id} (${openedCount}/${totalFiles}), ${openTabs.size} tabs open`);
      notifyProgress();
      resolve(); // Resolve after tab is created and tracked
    });
  });
}

// Notify dashboard of progress
function notifyProgress() {
  chrome.runtime.sendMessage({
    type: 'download-progress',
    opened: openedCount,
    total: totalFiles
  }).catch(() => {
    // Dashboard might be closed, ignore error
  });
}

// Listen for tab close events
chrome.tabs.onRemoved.addListener((tabId) => {
  if (openTabs.has(tabId)) {
    openTabs.delete(tabId);
    console.log(`Tab ${tabId} closed, ${openTabs.size} tabs remaining`);
    
    // Open next tab from queue if available
    if (urlQueue.length > 0) {
      openNextTabs();
    } else if (openTabs.size === 0 && openedCount === totalFiles) {
      // All tabs processed and closed
      console.log('All tabs processed and closed');
    }
  }
});

// Track Figma tabs that are waiting for downloads
const figmaTabsWaitingForDownload = new Set();

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
          // Remove from openTabs tracking (onRemoved will also fire, but this ensures cleanup)
          openTabs.delete(tabId);
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

