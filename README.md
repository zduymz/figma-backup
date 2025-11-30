# Figma Backup Dashboard Chrome Extension

A Chrome extension that allows you to load a JSON file containing Figma projects and files, then open selected files in new tabs.

## Features

- Load JSON files with project and file information
- Display projects and files in a clean dashboard with two columns
- Select multiple files using checkboxes
- Open all selected files in new tabs with one click

## Installation

1. Open Chrome and navigate to `chrome://extensions/`
2. Enable "Developer mode" (toggle in the top right)
3. Click "Load unpacked"
4. Select the `figma-backup` folder
5. The extension icon should now appear in your Chrome toolbar

## Usage

1. Click the extension icon in your Chrome toolbar
2. Click "Load JSON File" and select your JSON file
3. The dashboard will display all projects and their files in a table
4. Check the boxes next to the files you want to open
5. Click "Download Selected" to open all selected files in new tabs

## JSON File Format

The extension expects a JSON file with the following structure:

```json
[
  {
    "name": "Project Name",
    "files": [
      {
        "key": "figma-file-key",
        "name": "File Name",
        "thumbnail_url": "...",
        "last_modified": "..."
      }
    ],
    "id": "...",
    "team_id": "..."
  }
]
```

## File Structure

- `manifest.json` - Chrome extension configuration
- `popup.html` - Main UI
- `popup.css` - Styling
- `popup.js` - Extension logic
- `icon16.png`, `icon48.png`, `icon128.png` - Extension icons (you'll need to add these)

## Notes

- The extension constructs Figma URLs using the format: `https://www.figma.com/file/{key}/{name}`
- Files are opened with a 100ms delay between each to avoid overwhelming the browser
- The extension requires the "tabs" permission to open new tabs

