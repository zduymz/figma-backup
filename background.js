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

// Keep-alive mechanism to prevent service worker from going inactive
const KEEP_ALIVE_INTERVAL = 20 * 1000; // 20 seconds (before 30s timeout)
let keepAliveInterval = null;

function startKeepAlive() {
  if (keepAliveInterval) {
    console.log('Keep-alive already running');
    return; // Already running
  }
  
  console.log('Starting keep-alive mechanism to prevent service worker from going inactive');
  
  // Use setInterval with chrome.storage operations to keep service worker alive
  // This is more reliable than alarms for short intervals
  keepAliveInterval = setInterval(() => {
    // Check if we still have active operations
    const hasActiveOperations = urlQueue.length > 0 || openTabs.size > 0 || 
                                 figmaTabsWaitingForDownload.size > 0 || 
                                 downloadToTabMap.size > 0;
    
    if (!hasActiveOperations) {
      // No active operations, stop keep-alive
      console.log('No active operations, stopping keep-alive');
      stopKeepAlive();
      return;
    }
    
    // Do a lightweight operation to keep service worker alive
    // Using chrome.storage.local.get() is a good way to keep the service worker active
    chrome.storage.local.get('keepAlive', () => {
      if (chrome.runtime.lastError) {
        // Ignore errors, just keeping service worker alive
      }
      // Service worker stays active as long as there are pending callbacks
    });
    
    // Also use chrome.alarms as a backup (minimum 1 minute)
    try {
      chrome.alarms.create('keepAlive', { periodInMinutes: 1 });
    } catch (e) {
      // Ignore if already exists
    }
  }, KEEP_ALIVE_INTERVAL);
}

function stopKeepAlive() {
  if (keepAliveInterval) {
    clearInterval(keepAliveInterval);
    keepAliveInterval = null;
    console.log('Stopped keep-alive interval');
  }
  
  try {
    chrome.alarms.clear('keepAlive');
    console.log('Cleared keep-alive alarm');
  } catch (e) {
    // Ignore if alarm doesn't exist
  }
}

// Listen for alarm as a backup (fires every minute)
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'keepAlive') {
    // Check if we still have active operations
    const hasActiveOperations = urlQueue.length > 0 || openTabs.size > 0 || 
                                 figmaTabsWaitingForDownload.size > 0 || 
                                 downloadToTabMap.size > 0;
    
    if (!hasActiveOperations) {
      // No active operations, stop keep-alive
      console.log('No active operations detected by alarm, stopping keep-alive');
      stopKeepAlive();
    } else {
      // Do a lightweight operation to keep service worker active
      chrome.storage.local.get('keepAlive', () => {
        // Ignore result, just keeping service worker alive
      });
    }
  }
});

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
    
    // Start keep-alive to prevent service worker from going inactive
    startKeepAlive();
    
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
      console.log('Tracking Figma tab for download:', sender.tab.id, 'Title:', sender.tab.title || '[unknown title]');
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
      // Stop keep-alive since all operations are complete
      stopKeepAlive();
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
  
  // Get all tabs that have active downloads
  const tabsWithActiveDownloads = new Set();
  for (const tabId of downloadToTabMap.values()) {
    tabsWithActiveDownloads.add(tabId);
  }
  
  for (const [tabId, tabState] of tabStates.entries()) {
    // NEVER close tabs that have active downloads
    if (tabsWithActiveDownloads.has(tabId)) {
      console.log(`Tab ${tabId} has active download, skipping stuck check`);
      continue;
    }
    
    // NEVER close tabs that are waiting for downloads (they're in the process)
    if (figmaTabsWaitingForDownload.has(tabId)) {
      console.log(`Tab ${tabId} is waiting for download, skipping stuck check`);
      continue;
    }
    
    const timeSinceActivity = now - tabState.lastActivity;
    const timeSinceOpened = now - tabState.openedAt;
    
    // Different timeout logic based on state:
    // - 'opened': Tab opened but content script never started (shorter timeout)
    // - 'processing': Tab clicked save, waiting for download dialog (longer timeout)
    // - 'completed': Should already be closed, but if not, can close immediately
    
    if (tabState.state === 'completed') {
      // Completed tabs should have been closed, but if they're still here, close them
      stuckTabs.push({ tabId, tabState, reason: 'completed_but_not_closed' });
    } else if (tabState.state === 'opened') {
      // Tab opened but content script never started - give it 3 minutes
      const OPENED_STATE_TIMEOUT = 3 * 60 * 1000; // 3 minutes
      if (timeSinceOpened > OPENED_STATE_TIMEOUT) {
        stuckTabs.push({ tabId, tabState, reason: 'opened_state_timeout' });
      }
    } else if (tabState.state === 'processing') {
      // Tab is processing (clicked save, waiting for download) - give it more time
      // Downloads can take a while to start, especially with large files
      const PROCESSING_STATE_TIMEOUT = 10 * 60 * 1000; // 10 minutes
      if (timeSinceActivity > PROCESSING_STATE_TIMEOUT) {
        stuckTabs.push({ tabId, tabState, reason: 'processing_timeout' });
      }
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
      
      // Remove from download map if present
      for (const [downloadId, mappedTabId] of downloadToTabMap.entries()) {
        if (mappedTabId === tabId) {
          downloadToTabMap.delete(downloadId);
        }
      }
      
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
        
        // Update tab activity since download started
        if (tabStates.has(tab.id)) {
          const tabState = tabStates.get(tab.id);
          tabStates.set(tab.id, {
            ...tabState,
            lastActivity: Date.now(),
            state: 'processing' // Keep as processing until download completes
          });
        }
        
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
          
          // Check if all operations are complete
          if (openTabs.size === 0 && urlQueue.length === 0 && openedCount === totalFiles) {
            console.log('All downloads completed, stopping keep-alive');
            stopKeepAlive();
          }
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

