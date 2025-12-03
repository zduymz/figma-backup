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

// Track tab states and timestamps
const tabStates = new Map(); // Map tabId -> { state: 'opened'|'processing'|'completed', openedAt: timestamp, lastActivity: timestamp }
const TAB_TIMEOUT = 5 * 60 * 1000; // 5 minutes timeout for stuck tabs
const STUCK_CHECK_INTERVAL = 30 * 1000; // Check for stuck tabs every 30 seconds

// Listen for messages
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('Background script received message:', message.type, message);
  
  if (message.type === 'start-download-queue') {
    console.log('Processing start-download-queue message');
    console.log('URLs received:', message.urls?.length || 0);
    console.log('Total files:', message.totalFiles);
    
    if (!message.urls || message.urls.length === 0) {
      console.error('No URLs provided in start-download-queue message');
      sendResponse({ error: 'No URLs provided' });
      return;
    }
    
    urlQueue = message.urls;
    totalFiles = message.totalFiles;
    openedCount = 0;
    openTabs.clear();
    tabStates.clear();
    figmaTabsWaitingForDownload.clear();
    downloadToTabMap.clear();
    
    console.log(`Starting download queue with ${totalFiles} files, max ${MAX_CONCURRENT_TABS} concurrent tabs`);
    console.log('URL queue:', urlQueue);
    
    // Start opening tabs (up to the limit)
    openNextTabs().catch(error => {
      console.error('Error in openNextTabs:', error);
    });
    
    sendResponse({ success: true, message: 'Queue started' });
    return true; // Keep channel open for async response
  } else if (message.type === 'ping') {
    console.log('Ping received, background script is alive');
    sendResponse({ status: 'alive', openTabs: openTabs.size, queueLength: urlQueue.length });
    return true;
  } else if (message.type === 'figma-save-initiated') {
    // Content script has initiated a save, track this tab
    if (sender.tab && sender.tab.id) {
      figmaTabsWaitingForDownload.add(sender.tab.id);
      // Update tab state to processing
      if (tabStates.has(sender.tab.id)) {
        tabStates.set(sender.tab.id, {
          ...tabStates.get(sender.tab.id),
          state: 'processing',
          lastActivity: Date.now()
        });
      }
      console.log('Tracking Figma tab for download:', sender.tab.id);
    }
  } else if (message.type === 'content-script-ready') {
    // Content script has loaded and is ready
    if (sender.tab && sender.tab.id) {
      if (tabStates.has(sender.tab.id)) {
        tabStates.set(sender.tab.id, {
          ...tabStates.get(sender.tab.id),
          lastActivity: Date.now()
        });
      }
      console.log('Content script ready for tab:', sender.tab.id);
    }
  }
});

// Open next tabs from queue (up to the limit)
async function openNextTabs() {
  console.log('openNextTabs called:', {
    openTabs: openTabs.size,
    maxTabs: MAX_CONCURRENT_TABS,
    queueLength: urlQueue.length
  });
  
  // Calculate how many tabs we can still open
  const tabsToOpen = Math.min(MAX_CONCURRENT_TABS - openTabs.size, urlQueue.length);
  console.log(`Can open ${tabsToOpen} tabs`);
  
  if (tabsToOpen === 0) {
    console.log('Cannot open more tabs - either at limit or queue is empty');
    return;
  }
  
  for (let i = 0; i < tabsToOpen; i++) {
    // Double-check we're still under the limit before opening
    if (openTabs.size >= MAX_CONCURRENT_TABS) {
      console.log(`Reached max concurrent tabs (${MAX_CONCURRENT_TABS}), stopping`);
      break;
    }
    
    if (urlQueue.length === 0) {
      console.log('Queue is empty, stopping');
      break;
    }
    
    const url = urlQueue.shift();
    console.log(`Opening tab ${i + 1}/${tabsToOpen}: ${url}`);
    
    try {
      await openTab(url);
    } catch (error) {
      console.error(`Error opening tab for URL ${url}:`, error);
      // Continue with next tab even if this one fails
    }
  }
  
  console.log(`Finished opening tabs. Open tabs: ${openTabs.size}, Queue remaining: ${urlQueue.length}`);
}

// Open a single tab (returns a promise)
function openTab(url) {
  return new Promise((resolve, reject) => {
    console.log(`Attempting to open tab with URL: ${url}`);
    
    chrome.tabs.create({ url: url }, (tab) => {
      if (chrome.runtime.lastError) {
        const error = chrome.runtime.lastError.message;
        console.error('Error opening tab:', error);
        openedCount++;
        notifyProgress();
        reject(new Error(error)); // Reject to handle error
        return;
      }
      
      if (!tab || !tab.id) {
        console.error('Tab created but no tab ID returned');
        openedCount++;
        notifyProgress();
        reject(new Error('No tab ID returned'));
        return;
      }
      
      openTabs.add(tab.id);
      openedCount++;
      
      // Track tab state
      tabStates.set(tab.id, {
        state: 'opened',
        openedAt: Date.now(),
        lastActivity: Date.now(),
        url: url
      });
      
      console.log(`✓ Successfully opened tab ${tab.id} (${openedCount}/${totalFiles}), ${openTabs.size} tabs open`);
      notifyProgress();
      resolve(tab); // Resolve after tab is created and tracked
    });
  });
}

// Notify dashboard of progress
function notifyProgress() {
  console.log(`Notifying progress: ${openedCount}/${totalFiles}`);
  try {
    // Send message without callback - we're just broadcasting progress updates
    // No response is expected from the dashboard
    chrome.runtime.sendMessage({
      type: 'download-progress',
      opened: openedCount,
      total: totalFiles
    });
    
    // Check for errors after sending (but don't use callback)
    if (chrome.runtime.lastError) {
      // Dashboard might be closed, this is expected and can be ignored
      console.log('Note: Dashboard may not be listening:', chrome.runtime.lastError.message);
    }
  } catch (error) {
    console.error('Exception in notifyProgress:', error);
  }
}

// Listen for tab close events
chrome.tabs.onRemoved.addListener((tabId) => {
  if (openTabs.has(tabId)) {
    openTabs.delete(tabId);
    tabStates.delete(tabId);
    figmaTabsWaitingForDownload.delete(tabId);
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

// Listen for tab updates (refresh, navigation, etc.)
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!openTabs.has(tabId)) return;
  
  // If tab is being refreshed or navigated
  if (changeInfo.status === 'loading' && tabStates.has(tabId)) {
    const tabState = tabStates.get(tabId);
    // If tab was processing and now reloading, it might be stuck
    if (tabState.state === 'processing') {
      console.log(`Tab ${tabId} is reloading while processing, may be stuck`);
      // Reset state to opened so timeout can catch it
      tabStates.set(tabId, {
        ...tabState,
        state: 'opened',
        lastActivity: Date.now()
      });
    }
  }
  
  // Update last activity when tab completes loading
  if (changeInfo.status === 'complete' && tabStates.has(tabId)) {
    const tabState = tabStates.get(tabId);
    tabStates.set(tabId, {
      ...tabState,
      lastActivity: Date.now()
    });
  }
});

// Check for stuck tabs periodically
function checkStuckTabs() {
  const now = Date.now();
  const stuckTabs = [];
  
  for (const [tabId, tabState] of tabStates.entries()) {
    const timeSinceActivity = now - tabState.lastActivity;
    const timeSinceOpened = now - tabState.openedAt;
    
    // Consider a tab stuck if:
    // 1. It's been open for more than TAB_TIMEOUT
    // 2. No activity for more than TAB_TIMEOUT
    // 3. It's in 'opened' state for too long (content script never started)
    if (timeSinceOpened > TAB_TIMEOUT || 
        (timeSinceActivity > TAB_TIMEOUT && tabState.state !== 'completed')) {
      stuckTabs.push({ tabId, tabState, reason: timeSinceOpened > TAB_TIMEOUT ? 'timeout' : 'no_activity' });
    }
  }
  
  // Close stuck tabs and open next ones
  for (const { tabId, tabState, reason } of stuckTabs) {
    console.log(`Tab ${tabId} is stuck (${reason}), closing and opening next...`);
    chrome.tabs.remove(tabId, () => {
      if (chrome.runtime.lastError) {
        console.log(`Tab ${tabId} already closed:`, chrome.runtime.lastError.message);
      } else {
        console.log(`Force closed stuck tab ${tabId}`);
      }
      // Cleanup
      openTabs.delete(tabId);
      tabStates.delete(tabId);
      figmaTabsWaitingForDownload.delete(tabId);
      
      // Open next tab from queue
      if (urlQueue.length > 0) {
        openNextTabs();
      }
    });
  }
}

// Start periodic check for stuck tabs
setInterval(checkStuckTabs, STUCK_CHECK_INTERVAL);

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
      
      // Mark tab as completed
      if (tabStates.has(tabId)) {
        tabStates.set(tabId, {
          ...tabStates.get(tabId),
          state: 'completed',
          lastActivity: Date.now()
        });
      }
      
      // Wait a moment before closing to ensure download is fully saved
      setTimeout(() => {
        chrome.tabs.remove(tabId, () => {
          if (chrome.runtime.lastError) {
            console.log('Tab already closed or error:', chrome.runtime.lastError.message);
            // Still clean up even if already closed
            openTabs.delete(tabId);
            tabStates.delete(tabId);
          } else {
            console.log('Tab closed successfully');
          }
          // Clean up the map
          downloadToTabMap.delete(downloadId);
        });
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

