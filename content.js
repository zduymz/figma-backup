// Content script to automate Figma menu clicks
(function() {
  console.log('Figma Backup Content Script loaded!', window.location.href);
  
  // ============================================
  // CONFIGURATION: CSS Selectors
  // Update these if Figma changes their UI
  // ============================================
  const SELECTORS = {
    // Main menu button (hamburger menu)
    toggleMenuButton: 'button[aria-label="Main menu"]',
    
    // File menu button - find by text in menuitem
    fileMenuSelector: 'li[role="menuitem"]',
    fileMenuText: 'File',
    
    // Save As button - find by text in menuitem
    saveAsMenuSelector: 'li[role="menuitem"]',
    saveAsMenuText: 'Save local copy',
    
    // WAF popup button (appears after clicking Save As)
    wafOpenPopupButton: '#WAF-open-popup-button',
    
    // WAF validation CAPTCHA button
    captchaVerifyButton: '#amzn-captcha-verify-button'
  };
  
  // ============================================
  
  // Notify background script that content script is ready
  try {
    chrome.runtime.sendMessage({ type: 'content-script-ready' });
  } catch (e) {
    // Ignore if background script not available
  }
  
  // Check if we're on the WAF validation page
  function isWAFValidationPage() {
    return window.location.href.includes('figma.com/waf-validation-captcha');
  }

  // Handle WAF validation CAPTCHA page
  async function handleWAFValidation() {
    if (!isWAFValidationPage()) {
      return false;
    }

    console.log('Detected WAF validation page, waiting for CAPTCHA button...');
    
    try {
      // Wait for the CAPTCHA button to appear
      const captchaButton = await waitForElement(SELECTORS.captchaVerifyButton, 30000);
      console.log('Found CAPTCHA button:', captchaButton);
      
      // Click the button
      await robustClick(captchaButton);
      console.log(`✓ Clicked ${SELECTORS.captchaVerifyButton}`);
      
      // Wait for page to redirect/load after clicking
      // console.log('Waiting for page to process CAPTCHA...');
      // await new Promise(resolve => setTimeout(resolve, 3000));
      
      return true;
    } catch (error) {
      console.error('Error handling WAF validation:', error);
      return false;
    }
  }
  
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

  // Wait for a menu item by selector and text content
  function waitForMenuItemByText(selector, text, timeout = 10000) {
    return new Promise((resolve, reject) => {
      // Helper function to find the element
      const findElement = () => {
        const elements = document.querySelectorAll(selector);
        return Array.from(elements).find(el => el.innerText.trim().startsWith(text));
      };

      // Check if element already exists
      const existingElement = findElement();
      if (existingElement) {
        resolve(existingElement);
        return;
      }

      const startTime = Date.now();
      const observer = new MutationObserver(() => {
        const element = findElement();
        if (element) {
          observer.disconnect();
          resolve(element);
        } else if (Date.now() - startTime > timeout) {
          observer.disconnect();
          reject(new Error(`Menu item with text "${text}" not found within ${timeout}ms`));
        }
      });

      observer.observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true
      });

      // Check again after a short delay in case element appears synchronously
      setTimeout(() => {
        const element = findElement();
        if (element) {
          observer.disconnect();
          resolve(element);
        }
      }, 100);

      // Timeout after specified time
      setTimeout(() => {
        observer.disconnect();
        const element = findElement();
        if (!element) {
          reject(new Error(`Menu item with text "${text}" not found within ${timeout}ms`));
        }
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
    let clicked = false;
    
    const checkWAFButton = async () => {
      if (clicked) return true; // Already clicked, don't check again
      
      const wafButton = document.querySelector(SELECTORS.wafOpenPopupButton);
      console.log('Checking for WAF button:', {
        found: !!wafButton,
        visible: wafButton ? wafButton.offsetParent !== null : false,
        display: wafButton ? window.getComputedStyle(wafButton).display : 'N/A',
        visibility: wafButton ? window.getComputedStyle(wafButton).visibility : 'N/A'
      });
      
      if (wafButton) {
        // Check if element is actually visible
        const isVisible = wafButton.offsetParent !== null &&
                         window.getComputedStyle(wafButton).display !== 'none' &&
                         window.getComputedStyle(wafButton).visibility !== 'hidden' &&
                         wafButton.getBoundingClientRect().width > 0 &&
                         wafButton.getBoundingClientRect().height > 0;
        
        if (isVisible) {
          console.log('WAF button is visible, clicking...');
          clicked = true;
          await robustClick(wafButton);
          console.log(`✓ Clicked ${SELECTORS.wafOpenPopupButton}`);
          return true;
        }
      }
      return false;
    };

    // Check immediately
    checkWAFButton().then(clicked => {
      if (clicked) return;
    });

    // Watch for it to appear
    const observer = new MutationObserver(() => {
      if (!clicked) {
        checkWAFButton().then(clicked => {
          if (clicked) {
            observer.disconnect();
            clearInterval(interval);
          }
        });
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['style', 'class', 'id']
    });

    // Also check periodically
    const interval = setInterval(() => {
      if (!clicked) {
        checkWAFButton().then(clicked => {
          if (clicked) {
            clearInterval(interval);
            observer.disconnect();
          }
        });
      } else {
        clearInterval(interval);
        observer.disconnect();
      }
    }, 500);

    // Stop watching after 60 seconds
    setTimeout(() => {
      if (!clicked) {
        console.log('WAF button watcher stopped after 60 seconds');
      }
      clearInterval(interval);
      observer.disconnect();
    }, 60000);
  }

  // Wait for tab to become active/visible
  function waitForTabActive() {
    return new Promise((resolve) => {
      // Check if tab is already visible
      if (!document.hidden) {
        console.log('Tab is already active');
        resolve();
        return;
      }

      console.log('Tab is not active, waiting for it to become active...');
      
      // Listen for visibility change
      const handleVisibilityChange = () => {
        if (!document.hidden) {
          console.log('Tab became active');
          document.removeEventListener('visibilitychange', handleVisibilityChange);
          resolve();
        }
      };

      document.addEventListener('visibilitychange', handleVisibilityChange);
      
      // Also check periodically in case the event doesn't fire
      const checkInterval = setInterval(() => {
        if (!document.hidden) {
          console.log('Tab became active (polling)');
          clearInterval(checkInterval);
          document.removeEventListener('visibilitychange', handleVisibilityChange);
          resolve();
        }
      }, 500);
    });
  }

  // Main sequence of clicks
  async function runClickSequence() {
    try {
      console.log('Starting click sequence...');
      
      // Wait for tab to be active/visible
      await waitForTabActive();
      console.log('Tab is active, proceeding...');
      
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
      console.log(`Step 1: Waiting for ${SELECTORS.toggleMenuButton}...`);
      const toggleButton = await waitForElement(SELECTORS.toggleMenuButton, 15000);
      console.log(`Found ${SELECTORS.toggleMenuButton}`, toggleButton);
      console.log('Element details:', {
        id: toggleButton.id,
        className: toggleButton.className,
        tagName: toggleButton.tagName,
        visible: toggleButton.offsetParent !== null,
        disabled: toggleButton.disabled,
        style: window.getComputedStyle(toggleButton).display
      });
      robustClick(toggleButton);
      console.log(`✓ Clicked ${SELECTORS.toggleMenuButton}`);
      
      // Step 2: Click File menu item
      console.log(`Step 2: Waiting for "${SELECTORS.fileMenuText}" menu item...`);
      const fileMenuButton = await waitForMenuItemByText(
        SELECTORS.fileMenuSelector, 
        SELECTORS.fileMenuText, 
        15000
      );
      console.log(`Found "${SELECTORS.fileMenuText}" menu item`, fileMenuButton);
      console.log('Element details:', {
        id: fileMenuButton.id,
        className: fileMenuButton.className,
        tagName: fileMenuButton.tagName,
        text: fileMenuButton.innerText.trim(),
        visible: fileMenuButton.offsetParent !== null
      });
      robustClick(fileMenuButton);
      console.log(`✓ Clicked "${SELECTORS.fileMenuText}" menu item`);
      
      // Step 3: Click Save As menu item
      console.log(`Step 3: Waiting for "${SELECTORS.saveAsMenuText}" menu item...`);
      const saveAsButton = await waitForMenuItemByText(
        SELECTORS.saveAsMenuSelector, 
        SELECTORS.saveAsMenuText, 
        15000
      );
      console.log(`Found "${SELECTORS.saveAsMenuText}" menu item`, saveAsButton);
      console.log('Element details:', {
        id: saveAsButton.id,
        className: saveAsButton.className,
        tagName: saveAsButton.tagName,
        text: saveAsButton.innerText.trim(),
        visible: saveAsButton.offsetParent !== null
      });
      // robustClick(saveAsButton);
      saveAsButton.click();
      console.log(`✓ Clicked "${SELECTORS.saveAsMenuText}" menu item`);
      
      // Notify background script that save has been initiated
      try {
        chrome.runtime.sendMessage({ type: 'figma-save-initiated' });
        console.log('Notified background script of save initiation');
      } catch (e) {
        console.warn('Could not send message to background script:', e);
      }
      
    } catch (error) {
      console.error('✗ Error in click sequence:', error);
      
      // Reload the page to retry
      console.log('Reloading page to retry...');
      setTimeout(() => {
        window.location.reload();
      }, 1000); // Wait 1 second before reloading to see the error message
    }
  }

  // Main entry point
  async function init() {
    console.log('Content script initialized, checking page type...');
    
    // First, check if we're on WAF validation page
    if (isWAFValidationPage()) {
      console.log('On WAF validation page, handling CAPTCHA...');
      const handled = await handleWAFValidation();
      if (handled) {
        console.log('WAF validation handled, page should redirect...');
        // The page will redirect after CAPTCHA, so we don't need to run the main sequence here
        return;
      }
    }
    
    // If not on WAF page or after handling it, run the main click sequence
    console.log('Running main click sequence...');
    runClickSequence();
  }

  // Run the initialization
  init();
})();

