// Store the loaded data
let projectsData = [];
let selectedFiles = new Set(); // Stores URLs
let fileProjectMap = new Map(); // Maps URL -> project name

// DOM elements
const dashboard = document.getElementById('dashboard');
const actions = document.getElementById('actions');
const downloadBtn = document.getElementById('downloadBtn');
const selectedCount = document.getElementById('selectedCount');
const downloadProgress = document.getElementById('downloadProgress');
const progressFill = document.getElementById('progressFill');
const progressText = document.getElementById('progressText');
const btnText = downloadBtn.querySelector('.btn-text');
const btnLoader = downloadBtn.querySelector('.btn-loader');

// API setup elements
const apiKeyInputWrapper = document.getElementById('apiKeyInputWrapper');
const apiKeyInput = document.getElementById('apiKeyInput');
const saveApiKeyBtn = document.getElementById('saveApiKeyBtn');
const apiActions = document.getElementById('apiActions');
const downloadProjectByIdBtn = document.getElementById('downloadProjectByIdBtn');
const downloadProjectsByTeamBtn = document.getElementById('downloadProjectsByTeamBtn');
const updateApiKeyBtn = document.getElementById('updateApiKeyBtn');
const emptyState = document.getElementById('emptyState');

// ID input elements
const projectIdInputWrapper = document.getElementById('projectIdInputWrapper');
const projectIdInput = document.getElementById('projectIdInput');
const confirmProjectIdBtn = document.getElementById('confirmProjectIdBtn');
const cancelProjectIdBtn = document.getElementById('cancelProjectIdBtn');
const teamIdInputWrapper = document.getElementById('teamIdInputWrapper');
const teamIdInput = document.getElementById('teamIdInput');
const confirmTeamIdBtn = document.getElementById('confirmTeamIdBtn');
const cancelTeamIdBtn = document.getElementById('cancelTeamIdBtn');

// Mode switcher elements
const modeToggle = document.getElementById('modeToggle');
const apiSetupSection = document.getElementById('apiSetupSection');
const jsonFileSection = document.getElementById('jsonFileSection');
const jsonFileInput = document.getElementById('jsonFileInput');

// Check if API key exists on load
async function checkApiKey() {
  const result = await chrome.storage.local.get('figmaApiKey');
  if (result.figmaApiKey) {
    // API key exists, show fetch button
    apiKeyInputWrapper.style.display = 'none';
    apiActions.style.display = 'flex';
    apiKeyInput.value = result.figmaApiKey; // Store in input for update
  } else {
    // No API key, show input
    apiKeyInputWrapper.style.display = 'flex';
    apiActions.style.display = 'none';
  }
}

// Fetch with rate limit handling (429 retry)
async function fetchWithRetry(url, options, maxRetries = 5) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const response = await fetch(url, options);
    
    // If rate limited (429), wait and retry
    if (response.status === 429) {
      const retryAfter = response.headers.get('Retry-After');
      let waitTime = 60; // Default to 60 seconds if no Retry-After header
      
      if (retryAfter) {
        // Retry-After can be in seconds (number) or HTTP date
        const retryAfterNum = parseInt(retryAfter, 10);
        if (!isNaN(retryAfterNum)) {
          waitTime = retryAfterNum;
        } else {
          // Try to parse as date
          const retryDate = new Date(retryAfter);
          if (!isNaN(retryDate.getTime())) {
            waitTime = Math.max(1, Math.ceil((retryDate.getTime() - Date.now()) / 1000));
          }
        }
      }
      
      console.log(`Rate limited (429). Waiting ${waitTime} seconds before retry (attempt ${attempt + 1}/${maxRetries})...`);
      
      // Update empty state to show waiting message
      if (emptyState) {
        emptyState.innerHTML = `<p>Rate limited. Waiting ${waitTime} seconds before retrying... (attempt ${attempt + 1}/${maxRetries})</p>`;
      }
      
      // Wait for the specified time
      await new Promise(resolve => setTimeout(resolve, waitTime * 1000));
      
      // Retry the request
      continue;
    }
    
    // If not rate limited, return the response
    return response;
  }
  
  // If we've exhausted retries, throw an error
  throw new Error('Rate limit exceeded. Maximum retries reached.');
}

// Save API key
saveApiKeyBtn.addEventListener('click', async () => {
  const apiKey = apiKeyInput.value.trim();
  if (!apiKey) {
    alert('Please enter a Figma API key');
    return;
  }
  
  await chrome.storage.local.set({ figmaApiKey: apiKey });
  console.log('API key saved');
  await checkApiKey();
});

// Update API key
updateApiKeyBtn.addEventListener('click', () => {
  apiKeyInputWrapper.style.display = 'flex';
  apiActions.style.display = 'none';
  projectIdInputWrapper.style.display = 'none';
  teamIdInputWrapper.style.display = 'none';
  apiKeyInput.value = '';
  apiKeyInput.focus();
});

// Show project ID input
downloadProjectByIdBtn.addEventListener('click', () => {
  projectIdInputWrapper.style.display = 'flex';
  teamIdInputWrapper.style.display = 'none';
  projectIdInput.value = '';
  projectIdInput.focus();
});

// Show team ID input
downloadProjectsByTeamBtn.addEventListener('click', () => {
  teamIdInputWrapper.style.display = 'flex';
  projectIdInputWrapper.style.display = 'none';
  teamIdInput.value = '';
  teamIdInput.focus();
});

// Cancel project ID input
cancelProjectIdBtn.addEventListener('click', () => {
  projectIdInputWrapper.style.display = 'none';
  projectIdInput.value = '';
});

// Cancel team ID input
cancelTeamIdBtn.addEventListener('click', () => {
  teamIdInputWrapper.style.display = 'none';
  teamIdInput.value = '';
});

// Confirm and fetch by project ID
confirmProjectIdBtn.addEventListener('click', async () => {
  const projectId = projectIdInput.value.trim();
  if (!projectId) {
    alert('Please enter a Project ID');
    return;
  }
  projectIdInputWrapper.style.display = 'none';
  await fetchProjectById(projectId);
});

// Confirm and fetch by team ID
confirmTeamIdBtn.addEventListener('click', async () => {
  const teamId = teamIdInput.value.trim();
  if (!teamId) {
    alert('Please enter a Team ID');
    return;
  }
  teamIdInputWrapper.style.display = 'none';
  await fetchProjectsByTeamId(teamId);
});

// Fetch project by ID
async function fetchProjectById(projectId) {
  const result = await chrome.storage.local.get('figmaApiKey');
  const apiKey = result.figmaApiKey;
  
  if (!apiKey) {
    alert('Please set up your Figma API key first');
    return;
  }

  emptyState.innerHTML = '<p>Fetching project and files...</p>';
  emptyState.style.display = 'block';

  try {
    // Fetch files for the project with rate limit handling
    const filesResponse = await fetchWithRetry(`https://api.figma.com/v1/projects/${projectId}/files`, {
      headers: {
        'X-Figma-Token': apiKey
      }
    });

    if (!filesResponse.ok) {
      const errorData = await filesResponse.json().catch(() => ({}));
      throw new Error(errorData.err || `Failed to fetch project: ${filesResponse.statusText}`);
    }

    const filesData = await filesResponse.json();
    const files = filesData.files || [];

    // Get project name (we need to get it from team projects or use a default)
    const projectName = `Project ${projectId}`;
    
    // Try to get project details
    try {
      // We need team ID to get project name, but we can try to infer from files
      // For now, use a generic name
    } catch (e) {
      // Ignore
    }

    projectsData = [{
      name: projectName,
      id: projectId,
      files: files
    }];

    selectedFiles.clear();
    fileProjectMap.clear();
    renderDashboard();
    updateSelectedCount();
    
    emptyState.style.display = 'none';
    actions.style.display = 'flex';

  } catch (error) {
    console.error('Error fetching project:', error);
    alert('Error fetching project: ' + error.message);
    emptyState.innerHTML = '<p>Error fetching project. Please check the Project ID and try again.</p>';
  }
}

// Fetch projects by team ID
async function fetchProjectsByTeamId(teamId) {
  const result = await chrome.storage.local.get('figmaApiKey');
  const apiKey = result.figmaApiKey;
  
  if (!apiKey) {
    alert('Please set up your Figma API key first');
    return;
  }

  emptyState.innerHTML = '<p>Fetching projects and files...</p>';
  emptyState.style.display = 'block';

  try {
    // Fetch projects for the team with rate limit handling
    const projectsResponse = await fetchWithRetry(`https://api.figma.com/v1/teams/${teamId}/projects`, {
      headers: {
        'X-Figma-Token': apiKey
      }
    });

    if (!projectsResponse.ok) {
      const errorData = await projectsResponse.json().catch(() => ({}));
      throw new Error(errorData.err || `Failed to fetch projects: ${projectsResponse.statusText}`);
    }

    const projectsResponseData = await projectsResponse.json();
    const projects = projectsResponseData.projects || [];

    if (projects.length === 0) {
      throw new Error('No projects found for this team');
    }

    // Fetch files for each project
    const allProjects = [];
    
    for (const project of projects) {
      try {
        // Update status for each project
        emptyState.innerHTML = `<p>Fetching files for project: ${project.name}...</p>`;
        
        const filesResponse = await fetchWithRetry(`https://api.figma.com/v1/projects/${project.id}/files`, {
          headers: {
            'X-Figma-Token': apiKey
          }
        });

        if (filesResponse.ok) {
          const filesData = await filesResponse.json();
          allProjects.push({
            name: project.name,
            id: project.id,
            team_id: teamId,
            files: filesData.files || []
          });
        } else {
          console.error(`Failed to fetch files for project ${project.name}: ${filesResponse.statusText}`);
        }
      } catch (error) {
        console.error(`Error fetching files for project ${project.name}:`, error);
      }
    }

    if (allProjects.length === 0) {
      throw new Error('No files found in any projects');
    }

    projectsData = allProjects;
    selectedFiles.clear();
    fileProjectMap.clear();
    renderDashboard();
    updateSelectedCount();
    
    emptyState.style.display = 'none';
    actions.style.display = 'flex';

  } catch (error) {
    console.error('Error fetching projects:', error);
    alert('Error fetching projects: ' + error.message);
    emptyState.innerHTML = '<p>Error fetching projects. Please check the Team ID and try again.</p>';
  }
}


// Allow Enter key to confirm in input fields
projectIdInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    confirmProjectIdBtn.click();
  }
});

teamIdInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    confirmTeamIdBtn.click();
  }
});

// Mode switching
let isApiMode = true; // true = API mode, false = JSON file mode

modeToggle.addEventListener('change', (e) => {
  isApiMode = !e.target.checked; // When checked, it's JSON mode
  switchMode(isApiMode);
});

function switchMode(apiMode) {
  // Hide all input boxes when switching modes
  projectIdInputWrapper.style.display = 'none';
  teamIdInputWrapper.style.display = 'none';
  projectIdInput.value = '';
  teamIdInput.value = '';
  
  if (apiMode) {
    // Show API mode UI
    apiSetupSection.style.display = 'block';
    jsonFileSection.style.display = 'none';
    emptyState.innerHTML = '<p>Please set up your Figma API key and download projects by ID or team ID</p>';
    emptyState.style.display = 'block';
    actions.style.display = 'none';
  } else {
    // Show JSON file mode UI
    apiSetupSection.style.display = 'none';
    jsonFileSection.style.display = 'block';
    emptyState.innerHTML = '<p>Please load a JSON file to view projects and files</p>';
    emptyState.style.display = 'block';
    actions.style.display = 'none';
    // Clear any existing data
    projectsData = [];
    selectedFiles.clear();
    fileProjectMap.clear();
    renderDashboard();
    updateSelectedCount();
  }
}

// Load JSON file (Mode 2)
jsonFileInput.addEventListener('change', (event) => {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      projectsData = JSON.parse(e.target.result);
      selectedFiles.clear();
      fileProjectMap.clear();
      renderDashboard();
      updateSelectedCount();
    } catch (error) {
      alert('Error parsing JSON file: ' + error.message);
    }
  };
  reader.readAsText(file);
});

// Initialize on load
checkApiKey();
switchMode(true); // Start in API mode

// Render dashboard with projects and files
function renderDashboard() {
  if (!projectsData || projectsData.length === 0) {
    dashboard.innerHTML = '<div class="empty-state"><p>No projects found. Please fetch projects from Figma API.</p></div>';
    actions.style.display = 'none';
    return;
  }

  let html = '<div class="projects-container">';

  projectsData.forEach((project, projectIndex) => {
    const projectName = project.name || 'Unnamed Project';
    const files = project.files || [];
    const fileCount = files.length;

    // Create file checkboxes
    let filesHtml = '<div class="files-list">';
    files.forEach((file, fileIndex) => {
      const fileId = `${projectIndex}-${fileIndex}`;
      const fileName = file.name || 'Unnamed File';
      const fileKey = file.key || '';
      
      // Construct Figma URL
      const figmaUrl = `https://www.figma.com/design/${fileKey}`;
      
      filesHtml += `
        <div class="file-item">
          <input 
            type="checkbox" 
            class="file-checkbox" 
            id="file-${fileId}"
            data-url="${figmaUrl}"
            data-key="${fileKey}"
            data-project-index="${projectIndex}"
            data-project-name="${escapeHtml(projectName)}"
          />
          <label for="file-${fileId}" class="file-name">${escapeHtml(fileName)}</label>
        </div>
      `;
    });
    filesHtml += '</div>';

    html += `
      <div class="project-item collapsed" data-project-index="${projectIndex}">
        <div class="project-header">
          <button class="project-toggle" data-project-index="${projectIndex}">
            <span class="toggle-icon">▶</span>
          </button>
          <span class="project-name">${escapeHtml(projectName)}</span>
          <span class="project-file-count">(${fileCount} file${fileCount !== 1 ? 's' : ''})</span>
          <button class="select-all-btn" data-project-index="${projectIndex}">Select All</button>
        </div>
        <div class="project-content" data-project-index="${projectIndex}" style="display: none;">
          ${filesHtml}
        </div>
      </div>
    `;
  });

  html += '</div>';
  dashboard.innerHTML = html;

  // Attach event listeners
  attachCheckboxListeners();
  attachToggleListeners();
  attachSelectAllListeners();
  actions.style.display = 'flex';
}

// Attach event listeners to checkboxes
function attachCheckboxListeners() {
  const checkboxes = document.querySelectorAll('.file-checkbox');
  checkboxes.forEach(checkbox => {
    checkbox.addEventListener('change', (e) => {
      const url = e.target.dataset.url;
      const projectName = e.target.dataset.projectName;
      const fileKey = e.target.dataset.key;
      
      if (e.target.checked) {
        selectedFiles.add(url);
        // Store project name with file key for content script to retrieve
        if (fileKey && projectName) {
          fileProjectMap.set(fileKey, projectName);
        }
      } else {
        selectedFiles.delete(url);
        if (fileKey) {
          fileProjectMap.delete(fileKey);
        }
      }
      updateSelectedCount();
      updateSelectAllButton(e.target.dataset.projectIndex);
    });
  });
}

// Update select all button text based on selection state
function updateSelectAllButton(projectIndex) {
  const projectItem = document.querySelector(`.project-item[data-project-index="${projectIndex}"]`);
  if (!projectItem) return;
  
  const checkboxes = projectItem.querySelectorAll('.file-checkbox');
  const allSelected = checkboxes.length > 0 && Array.from(checkboxes).every(cb => cb.checked);
  const selectAllBtn = projectItem.querySelector('.select-all-btn');
  
  if (selectAllBtn) {
    selectAllBtn.textContent = allSelected ? 'Deselect All' : 'Select All';
  }
}

// Attach event listeners to toggle buttons
function attachToggleListeners() {
  const toggleButtons = document.querySelectorAll('.project-toggle');
  toggleButtons.forEach(button => {
    button.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleProject(button.dataset.projectIndex);
    });
  });

  // Also allow clicking the project header to toggle
  const projectHeaders = document.querySelectorAll('.project-header');
  projectHeaders.forEach(header => {
    header.addEventListener('click', (e) => {
      // Don't toggle if clicking the select all button
      if (e.target.closest('.select-all-btn')) {
        return;
      }
      const projectIndex = header.closest('.project-item').dataset.projectIndex;
      toggleProject(projectIndex);
    });
  });
}

// Toggle project collapse/expand
function toggleProject(projectIndex) {
  const projectItem = document.querySelector(`.project-item[data-project-index="${projectIndex}"]`);
  if (!projectItem) return;
  
  const projectContent = projectItem.querySelector('.project-content');
  const toggleIcon = projectItem.querySelector('.toggle-icon');
  
  projectItem.classList.toggle('collapsed');
  
  if (projectItem.classList.contains('collapsed')) {
    toggleIcon.textContent = '▶';
    projectContent.style.display = 'none';
  } else {
    toggleIcon.textContent = '▼';
    projectContent.style.display = 'block';
  }
}

// Attach event listeners to select all buttons
function attachSelectAllListeners() {
  const selectAllButtons = document.querySelectorAll('.select-all-btn');
  selectAllButtons.forEach(button => {
    button.addEventListener('click', (e) => {
      e.stopPropagation(); // Prevent triggering the project header toggle
      const projectIndex = button.dataset.projectIndex;
      const projectItem = document.querySelector(`.project-item[data-project-index="${projectIndex}"]`);
      const checkboxes = projectItem.querySelectorAll('.file-checkbox');
      
      // Check if all are selected
      const allSelected = checkboxes.length > 0 && Array.from(checkboxes).every(cb => cb.checked);
      
      // Toggle all checkboxes
      checkboxes.forEach(checkbox => {
        checkbox.checked = !allSelected;
        const url = checkbox.dataset.url;
        const projectName = checkbox.dataset.projectName;
        const fileKey = checkbox.dataset.key;
        
        if (!allSelected) {
          selectedFiles.add(url);
          // Store project name with file key
          if (fileKey && projectName) {
            fileProjectMap.set(fileKey, projectName);
          }
        } else {
          selectedFiles.delete(url);
          if (fileKey) {
            fileProjectMap.delete(fileKey);
          }
        }
      });
      
      // Update button text
      button.textContent = allSelected ? 'Select All' : 'Deselect All';
      updateSelectedCount();
    });
  });
}

// Update selected count display
function updateSelectedCount() {
  const count = selectedFiles.size;
  selectedCount.textContent = `${count} file${count !== 1 ? 's' : ''} selected`;
  downloadBtn.disabled = count === 0;
}

// Download button click handler
downloadBtn.addEventListener('click', async () => {
  if (selectedFiles.size === 0) {
    alert('Please select at least one file to download');
    return;
  }

  // Get URLs before clearing (we need them for the download)
  const urls = Array.from(selectedFiles);
  const totalFiles = urls.length;
  const projectMapToStore = Object.fromEntries(fileProjectMap);

  // Reset all selections immediately
  selectedFiles.clear();
  fileProjectMap.clear();
  document.querySelectorAll('.file-checkbox').forEach(cb => {
    cb.checked = false;
  });
  
  // Reset all "Select All" buttons
  document.querySelectorAll('.select-all-btn').forEach(btn => {
    btn.textContent = 'Select All';
  });
  
  updateSelectedCount();

  // Disable button and show loading state
  downloadBtn.disabled = true;
  btnText.style.display = 'none';
  btnLoader.style.display = 'inline-block';
  downloadProgress.style.display = 'block';
  
  // Store project name mapping in chrome.storage for content script
  await chrome.storage.local.set({ fileProjectMap: projectMapToStore });
  console.log('Stored project name mapping:', projectMapToStore);

  // Update progress function
  const updateProgress = (current, total) => {
    const percentage = Math.round((current / total) * 100);
    progressFill.style.width = `${percentage}%`;
    progressText.textContent = `Opening ${current} of ${total} files...`;
  };

  // Send URLs to background script for queued processing
  console.log('Sending download queue message:', { urls: urls.length, totalFiles });
  
  try {
    chrome.runtime.sendMessage({
      type: 'start-download-queue',
      urls: urls,
      totalFiles: totalFiles
    }, (response) => {
      if (chrome.runtime.lastError) {
        console.error('Error sending message to background script:', chrome.runtime.lastError);
        alert('Error starting download: ' + chrome.runtime.lastError.message);
        // Reset button state on error
        downloadBtn.disabled = false;
        btnText.style.display = 'inline';
        btnLoader.style.display = 'none';
        downloadProgress.style.display = 'none';
        return;
      }
      console.log('Message sent successfully, response:', response);
    });
  } catch (error) {
    console.error('Error sending message:', error);
    alert('Error starting download: ' + error.message);
    downloadBtn.disabled = false;
    btnText.style.display = 'inline';
    btnLoader.style.display = 'none';
    downloadProgress.style.display = 'none';
    return;
  }

  // Listen for progress updates from background script
  const progressListener = (message, sender, sendResponse) => {
    console.log('Received message in dashboard:', message);
    
    if (message.type === 'download-progress') {
      console.log(`Progress update: ${message.opened}/${message.total}`);
      updateProgress(message.opened, message.total);
      
      if (message.opened === message.total) {
        // All files processed
        setTimeout(() => {
          progressText.textContent = `✓ All ${totalFiles} files opened! Downloads will start automatically.`;
          progressFill.style.width = '100%';
          
          // Reset after a delay
          setTimeout(() => {
            // Reset button state
            downloadBtn.disabled = false;
            btnText.style.display = 'inline';
            btnLoader.style.display = 'none';
            downloadProgress.style.display = 'none';
            progressFill.style.width = '0%';
            
            // Remove progress listener
            chrome.runtime.onMessage.removeListener(progressListener);
          }, 3000);
        }, 500);
      }
    }
    
    // No response needed - just receiving progress updates
    // Don't return true since we're not sending an async response
  };

  chrome.runtime.onMessage.addListener(progressListener);
  
  // Track opened count locally for timeout check
  let localOpenedCount = 0;
  
  // Add timeout to detect if tabs aren't opening
  const timeoutId = setTimeout(() => {
    chrome.runtime.sendMessage({ type: 'ping' }, (response) => {
      if (chrome.runtime.lastError) {
        console.error('Background script not responding:', chrome.runtime.lastError);
        alert('Background script error. Please reload the extension and try again.');
        // Reset button state
        downloadBtn.disabled = false;
        btnText.style.display = 'inline';
        btnLoader.style.display = 'none';
        downloadProgress.style.display = 'none';
      } else {
        console.log('Background script status:', response);
        if (response && response.openTabs === 0 && response.queueLength > 0) {
          console.warn('Background script reports no tabs opened but queue has items');
          alert('Tabs are not opening. Please check the browser console for errors.');
        }
      }
    });
  }, 5000);
  
  // Clear timeout if progress updates come in
  const originalProgressListener = progressListener;
  const wrappedProgressListener = (message, sender, sendResponse) => {
    if (message.type === 'download-progress') {
      localOpenedCount = message.opened;
      clearTimeout(timeoutId);
    }
    return originalProgressListener(message, sender, sendResponse);
  };
  
  chrome.runtime.onMessage.removeListener(progressListener);
  chrome.runtime.onMessage.addListener(wrappedProgressListener);
});

// Utility function to escape HTML
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}


