import puppeteer, { Browser, Page } from "puppeteer";
import fetch, { Response } from "node-fetch";
import { logger } from "../config/logger.js";
import { dockerConfig, npxConfig, DEFAULT_NAVIGATION_TIMEOUT } from "../config/browser.js";
import { ActiveTab } from "../types/global.js";

// Global browser instance
let browser: Browser | undefined;
let page: Page | undefined;

export async function ensureBrowser(): Promise<Page> {
  if (!browser) {
    logger.info('Launching browser with config:', process.env.DOCKER_CONTAINER ? 'docker' : 'npx');
    browser = await puppeteer.launch(process.env.DOCKER_CONTAINER ? dockerConfig : npxConfig);
    const pages = await browser.pages();
    page = pages[0];

    // Set default navigation timeout
    await page.setDefaultNavigationTimeout(DEFAULT_NAVIGATION_TIMEOUT);
    
    // Enable JavaScript
    await page.setJavaScriptEnabled(true);
    
    logger.info('Browser launched successfully');
  }
  return page!;
}

async function tryFetch(url: string): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1000); // 1 second timeout
  
  try {
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    return response;
  } catch (error) {
    clearTimeout(timeout);
    throw error;
  }
}

export async function getDebuggerWebSocketUrl(port: number = 9222): Promise<string> {
  const urls = [
    `http://127.0.0.1:${port}/json/version`, // IPv4 first (usually faster)
    `http://localhost:${port}/json/version`  // Falls back to system resolver
  ];
  
  let lastError: Error | null = null;
  
  for (const url of urls) {
    try {
      const response = await tryFetch(url);
      if (!response.ok) {
        throw new Error(`Failed to fetch debugger info: ${response.statusText}`);
      }
      const data = await response.json() as any;
      if (!data.webSocketDebuggerUrl) {
        throw new Error("No WebSocket debugger URL found. Is Chrome running with --remote-debugging-port?");
      }
      return data.webSocketDebuggerUrl;
    } catch (error) {
      lastError = error as Error;
      continue; // Try next URL
    }
  }
  
  throw new Error(`Failed to connect to Chrome debugging port ${port}: ${lastError?.message}`);
}

export async function connectToExistingBrowser(
  wsEndpoint: string, 
  targetUrl?: string,
  onConsoleMessage?: (logEntry: string) => void
): Promise<Page> {
  logger.info('Connecting to existing browser', { wsEndpoint, targetUrl });
  try {
    // If we have an existing Puppeteer-launched browser, close it
    if (browser && !browser.isConnected()) {
      logger.debug('Closing existing browser connection');
      await browser.close();
      browser = undefined;
      page = undefined;
    }

    // Connect to the browser instance with null viewport to maintain browser's viewport
    logger.debug('Establishing connection to browser');
    browser = await puppeteer.connect({ 
      browserWSEndpoint: wsEndpoint,
      defaultViewport: null
    });
    logger.info('Successfully connected to browser');

    // Get all pages and find non-extension pages
    const pages = await browser.pages();
    const activeTabs: ActiveTab[] = [];
    
    for (const p of pages) {
      const url = await p.url();
      if (!url.startsWith('chrome-extension://')) {
        const title = await p.title();
        logger.info('Found active webpage:', { url, title });
        activeTabs.push({ page: p, url, title });
      }
    }

    if (activeTabs.length === 0) {
      throw new Error("No active non-extension pages found in the browser");
    }

    // Select appropriate page
    if (targetUrl) {
      // Find the page with matching URL
      const targetTab = activeTabs.find(tab => tab.url === targetUrl);
      page = targetTab ? targetTab.page : activeTabs[0].page;
    } else {
      // Use the first active non-extension page
      page = activeTabs[0].page;
    }

    // Configure page settings
    await page.setExtraHTTPHeaders({
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    });

    // Set up console message handling
    if (onConsoleMessage) {
      page.on("console", (msg) => {
        const logEntry = `[${msg.type()}] ${msg.text()}`;
        onConsoleMessage(logEntry);
      });
    }

    return page;
  } catch (error) {
    throw error;
  }
}

export async function closeBrowser(): Promise<void> {
  if (browser) {
    await browser.close();
    browser = undefined;
    page = undefined;
  }
}

export function getCurrentPage(): Page | undefined {
  return page;
}
