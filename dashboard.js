// Store the loaded data
let projectsData = [];
let selectedFiles = new Set(); // Stores URLs
let fileProjectMap = new Map(); // Maps URL -> project name

// DOM elements
const jsonFileInput = document.getElementById('jsonFileInput');
const dashboard = document.getElementById('dashboard');
const actions = document.getElementById('actions');
const downloadBtn = document.getElementById('downloadBtn');
const selectedCount = document.getElementById('selectedCount');

// Load JSON file
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

// Render dashboard with projects and files
function renderDashboard() {
  if (!projectsData || projectsData.length === 0) {
    dashboard.innerHTML = '<div class="empty-state"><p>No projects found in the JSON file</p></div>';
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

  // Store project name mapping in chrome.storage for content script
  const projectMap = Object.fromEntries(fileProjectMap);
  await chrome.storage.local.set({ fileProjectMap: projectMap });
  console.log('Stored project name mapping:', projectMap);

  // Open each selected URL in a new tab
  const urls = Array.from(selectedFiles);
  urls.forEach((url, index) => {
    // Add a small delay to avoid overwhelming the browser
    setTimeout(() => {
      chrome.tabs.create({ url: url });
    }, index * 100);
  });

  // Clear selection after opening
  selectedFiles.clear();
  fileProjectMap.clear();
  document.querySelectorAll('.file-checkbox').forEach(cb => {
    cb.checked = false;
  });
  updateSelectedCount();
});

// Utility function to escape HTML
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

