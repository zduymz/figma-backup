// Store the loaded data
let projectsData = [];
let selectedFiles = new Set();

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

  let html = '<div class="table-container"><table><thead><tr><th>Project Name</th><th>Files</th></tr></thead><tbody>';

  projectsData.forEach((project, projectIndex) => {
    const projectName = project.name || 'Unnamed Project';
    const files = project.files || [];

    // Create file checkboxes
    let filesHtml = '<div class="files-list">';
    files.forEach((file, fileIndex) => {
      const fileId = `${projectIndex}-${fileIndex}`;
      const fileName = file.name || 'Unnamed File';
      const fileKey = file.key || '';
      
      // Construct Figma URL
      const figmaUrl = `https://www.figma.com/file/${fileKey}/${encodeURIComponent(fileName)}`;
      
      filesHtml += `
        <div class="file-item">
          <input 
            type="checkbox" 
            class="file-checkbox" 
            id="file-${fileId}"
            data-url="${figmaUrl}"
            data-key="${fileKey}"
          />
          <label for="file-${fileId}" class="file-name">${escapeHtml(fileName)}</label>
        </div>
      `;
    });
    filesHtml += '</div>';

    html += `
      <tr>
        <td class="project-name">${escapeHtml(projectName)}</td>
        <td>${filesHtml}</td>
      </tr>
    `;
  });

  html += '</tbody></table></div>';
  dashboard.innerHTML = html;

  // Attach event listeners to checkboxes
  attachCheckboxListeners();
  actions.style.display = 'flex';
}

// Attach event listeners to checkboxes
function attachCheckboxListeners() {
  const checkboxes = document.querySelectorAll('.file-checkbox');
  checkboxes.forEach(checkbox => {
    checkbox.addEventListener('change', (e) => {
      const url = e.target.dataset.url;
      if (e.target.checked) {
        selectedFiles.add(url);
      } else {
        selectedFiles.delete(url);
      }
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
downloadBtn.addEventListener('click', () => {
  if (selectedFiles.size === 0) {
    alert('Please select at least one file to download');
    return;
  }

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

