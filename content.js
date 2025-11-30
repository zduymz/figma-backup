// Content script to automate Figma menu clicks
(function() {
  console.log('Figma Backup Content Script loaded!', window.location.href);
  
  // Random wait between min and max milliseconds
  function randomWait(min = 100, max = 1000) {
    const delay = Math.floor(Math.random() * (max - min + 1)) + min;
    return new Promise(resolve => setTimeout(resolve, delay));
  }

  // Wait for page to fully load
  function waitForPageLoad() {
    return new Promise((resolve) => {
      if (document.readyState === 'complete') {
        resolve();
      } else {
        window.addEventListener('load', resolve);
      }
    });
  }

  // Wait for an element by selector
  function waitForElement(selector, timeout = 10000) {
    return new Promise((resolve, reject) => {
      const element = document.querySelector(selector);
      if (element) {
        resolve(element);
        return;
      }

      const observer = new MutationObserver((mutations, obs) => {
        const element = document.querySelector(selector);
        if (element) {
          obs.disconnect();
          resolve(element);
        }
      });

      observer.observe(document.body, {
        childList: true,
        subtree: true
      });

      // Timeout after specified time
      setTimeout(() => {
        observer.disconnect();
        reject(new Error(`Element ${selector} not found within ${timeout}ms`));
      }, timeout);
    });
  }

  // Wait for an element with id starting with a prefix
  function waitForElementByIdPrefix(prefix, timeout = 10000) {
    return new Promise((resolve, reject) => {
      // Check if element already exists
      const existingElement = document.querySelector(`[id^="${prefix}"]`);
      if (existingElement) {
        resolve(existingElement);
        return;
      }

      const observer = new MutationObserver((mutations, obs) => {
        const element = document.querySelector(`[id^="${prefix}"]`);
        if (element) {
          obs.disconnect();
          resolve(element);
        }
      });

      observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['id']
      });

      // Timeout after specified time
      setTimeout(() => {
        observer.disconnect();
        reject(new Error(`Element with id starting with "${prefix}" not found within ${timeout}ms`));
      }, timeout);
    });
  }

  // Robust click function that dispatches proper events
  async function robustClick(element) {
    if (!element) {
      throw new Error('Element is null or undefined');
    }

    // Check if element is visible and enabled
    const rect = element.getBoundingClientRect();
    const isVisible = rect.width > 0 && rect.height > 0 && 
                      element.offsetParent !== null &&
                      window.getComputedStyle(element).visibility !== 'hidden' &&
                      window.getComputedStyle(element).display !== 'none';
    
    if (!isVisible) {
      console.warn('Element is not visible, scrolling into view...');
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      // Wait a bit for scroll to complete
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    performClick(element);
  }

  // Perform the actual click with proper event dispatching
  async function performClick(element) {
    // Try to focus the element first if it's focusable
    if (typeof element.focus === 'function') {
      try {
        element.focus();
      } catch (e) {
        // Ignore focus errors
      }
    }

    // Get element's position for mouse events
    const rect = element.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;

    // Dispatch mousedown
    const mousedownEvent = new MouseEvent('mousedown', {
      view: window,
      bubbles: true,
      cancelable: true,
      clientX: x,
      clientY: y,
      button: 0,
      buttons: 1,
      detail: 1
    });
    const mousedownResult = element.dispatchEvent(mousedownEvent);
    
    // Small delay to simulate real mouse behavior
    await new Promise(resolve => setTimeout(resolve, 10));
    
    // Dispatch mouseup
    const mouseupEvent = new MouseEvent('mouseup', {
      view: window,
      bubbles: true,
      cancelable: true,
      clientX: x,
      clientY: y,
      button: 0,
      buttons: 0,
      detail: 1
    });
    const mouseupResult = element.dispatchEvent(mouseupEvent);
    
    // Small delay before click
    await new Promise(resolve => setTimeout(resolve, 10));
    
    // Dispatch click
    const clickEvent = new MouseEvent('click', {
      view: window,
      bubbles: true,
      cancelable: true,
      clientX: x,
      clientY: y,
      button: 0,
      buttons: 0,
      detail: 1
    });
    const clickResult = element.dispatchEvent(clickEvent);

    // Also try the native click method as fallback
    if (!clickResult || element.onclick) {
      try {
        element.click();
      } catch (e) {
        console.warn('Native click() failed:', e);
      }
    }

    // Try pointer events as well (some modern frameworks use these)
    try {
      element.dispatchEvent(new PointerEvent('pointerdown', {
        bubbles: true,
        cancelable: true,
        clientX: x,
        clientY: y,
        pointerId: 1,
        button: 0,
        isPrimary: true
      }));
      await new Promise(resolve => setTimeout(resolve, 10));
      element.dispatchEvent(new PointerEvent('pointerup', {
        bubbles: true,
        cancelable: true,
        clientX: x,
        clientY: y,
        pointerId: 1,
        button: 0,
        isPrimary: true
      }));
    } catch (e) {
      // PointerEvent might not be available in all browsers
    }

    console.log('Click events dispatched on element:', element.id || element.className || element.tagName);
  }

  // Watch for WAF button and click it if visible
  function watchForWAFButton() {
    const checkWAFButton = async () => {
      const wafButton = document.querySelector('#WAF-open-popup-button');
      if (wafButton && wafButton.offsetParent !== null) {
        // Element is visible
        await robustClick(wafButton);
        console.log('Clicked WAF-open-popup-button');
        return true;
      }
      return false;
    };

    // Check immediately
    if (checkWAFButton()) {
      return;
    }

    // Watch for it to appear
    const observer = new MutationObserver(() => {
      checkWAFButton();
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['style', 'class']
    });

    // Also check periodically
    const interval = setInterval(() => {
      if (checkWAFButton()) {
        clearInterval(interval);
        observer.disconnect();
      }
    }, 500);

    // Stop watching after 30 seconds
    setTimeout(() => {
      clearInterval(interval);
      observer.disconnect();
    }, 30000);
  }

  // Main sequence of clicks
  async function runClickSequence() {
    try {
      console.log('Starting click sequence...');
      
      // Wait for page to fully load
      console.log('Waiting for page load...');
      await waitForPageLoad();
      console.log('Page loaded');
      
      // Wait a bit more for Figma to initialize
      console.log('Waiting for Figma to initialize...');
      await new Promise(resolve => setTimeout(resolve, 2000));
      console.log('Figma initialization wait complete');
      
      // Start watching for WAF button
      watchForWAFButton();
      console.log('WAF button watcher started');

      // Step 1: Click toggle-menu-button
      console.log('Step 1: Waiting for toggle-menu-button...');
      const toggleButton = await waitForElement('#toggle-menu-button', 15000);
      console.log('Found toggle-menu-button', toggleButton);
      console.log('Element details:', {
        id: toggleButton.id,
        className: toggleButton.className,
        tagName: toggleButton.tagName,
        visible: toggleButton.offsetParent !== null,
        disabled: toggleButton.disabled,
        style: window.getComputedStyle(toggleButton).display
      });
      await randomWait();
      robustClick(toggleButton);
      console.log('✓ Clicked toggle-menu-button');
      
      // Step 2: Click mainMenu-file-menu-*
      console.log('Step 2: Waiting for mainMenu-file-menu-*...');
    //   await randomWait();
      const fileMenuButton = await waitForElementByIdPrefix('mainMenu-file-menu-', 15000);
      console.log('Found mainMenu-file-menu-*', fileMenuButton);
      console.log('Element details:', {
        id: fileMenuButton.id,
        className: fileMenuButton.className,
        tagName: fileMenuButton.tagName,
        visible: fileMenuButton.offsetParent !== null
      });
    //   await randomWait();
      robustClick(fileMenuButton);
      console.log('✓ Clicked mainMenu-file-menu-*');
      
      // Step 3: Click mainMenu-save-as-*
      console.log('Step 3: Waiting for mainMenu-save-as-*...');
    //   await randomWait();
      const saveAsButton = await waitForElementByIdPrefix('mainMenu-save-as-', 15000);
      console.log('Found mainMenu-save-as-*', saveAsButton);
      console.log('Element details:', {
        id: saveAsButton.id,
        className: saveAsButton.className,
        tagName: saveAsButton.tagName,
        visible: saveAsButton.offsetParent !== null
      });
      await randomWait(1000,5000);
      robustClick(saveAsButton);
      console.log('✓ Clicked mainMenu-save-as-*');
      
      // Notify background script that save has been initiated
      try {
        chrome.runtime.sendMessage({ type: 'figma-save-initiated' });
        console.log('Notified background script of save initiation');
      } catch (e) {
        console.warn('Could not send message to background script:', e);
      }
      
    } catch (error) {
      console.error('✗ Error in click sequence:', error);
      console.error('Error details:', {
        message: error.message,
        stack: error.stack,
        url: window.location.href
      });
    }
  }

  // Run the sequence
  console.log('Content script initialized, starting sequence...');
  runClickSequence();
})();

