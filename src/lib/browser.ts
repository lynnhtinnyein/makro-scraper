import puppeteer, { Browser, Page } from "puppeteer-core";
import { execSync } from "child_process";
import * as os from "os";

const POOL_SIZE = 3;
const MAX_PAGE_REUSES = 10;
const PAGE_TIMEOUT = 45000;
const BROWSER_RECONNECT_DELAY = 3000;
const MAX_RECONNECT_ATTEMPTS = 5;
const BROWSER_LAUNCH_TIMEOUT = 30000;

interface PooledPage {
    page: Page;
    inUse: boolean;
    uses: number;
    lastUsed: number;
}

let browser: Browser | null = null;
let pagePool: PooledPage[] = [];
let browserLaunching = false;
let reconnectAttempts = 0;
let isShuttingDown = false;
let lastBrowserLaunchAttempt = 0;

function getChromePath(): string {
    const platform = os.platform();

    if (platform === "darwin") {
        const paths = [
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
            "/Applications/Chromium.app/Contents/MacOS/Chromium"
        ];

        for (const path of paths) {
            try {
                execSync(`test -f "${path}"`, { encoding: "utf8" });
                return path;
            } catch {}
        }

        try {
            const whichChrome = execSync("which google-chrome-stable", { encoding: "utf8" }).trim();
            if (whichChrome) return whichChrome;
        } catch {}

        try {
            const whichChromium = execSync("which chromium", { encoding: "utf8" }).trim();
            if (whichChromium) return whichChromium;
        } catch {}
    } else if (platform === "linux") {
        const paths = [
            "/usr/bin/google-chrome-stable",
            "/usr/bin/google-chrome",
            "/usr/bin/chromium-browser",
            "/usr/bin/chromium"
        ];

        for (const path of paths) {
            try {
                execSync(`test -f "${path}"`, { encoding: "utf8" });
                return path;
            } catch {}
        }
    }

    throw new Error(
        "Chrome/Chromium not found. Please install Chrome or set CHROME_PATH environment variable."
    );
}

const CHROME_PATH = process.env.CHROME_PATH || getChromePath();

async function launchBrowser(): Promise<Browser> {
    const now = Date.now();
    if (now - lastBrowserLaunchAttempt < 5000) {
        await new Promise((resolve) =>
            setTimeout(resolve, 5000 - (now - lastBrowserLaunchAttempt))
        );
    }
    lastBrowserLaunchAttempt = Date.now();

    if (browserLaunching) {
        let waitTime = 0;
        while (browserLaunching && waitTime < 30000) {
            await new Promise((resolve) => setTimeout(resolve, 500));
            waitTime += 500;
        }
        if (browser?.connected) return browser;
    }

    browserLaunching = true;

    try {
        console.log(`[${process.pid}] Launching browser...`);

        const launchedBrowser = await Promise.race([
            puppeteer.launch({
                executablePath: CHROME_PATH,
                headless: true,
                args: [
                    "--no-sandbox",
                    "--disable-setuid-sandbox",
                    "--disable-dev-shm-usage",
                    "--disable-accelerated-2d-canvas",
                    "--no-first-run",
                    "--no-zygote",
                    "--disable-gpu",
                    "--disable-software-rasterizer",
                    "--disable-extensions",
                    "--disable-background-timer-throttling",
                    "--disable-backgrounding-occluded-windows",
                    "--disable-renderer-backgrounding",
                    "--disable-features=IsolateOrigins,site-per-process,AudioServiceOutOfProcess,TranslateUI",
                    "--js-flags=--max-old-space-size=768",
                    "--memory-pressure-off",
                    "--single-process",
                    "--no-default-browser-check",
                    "--disable-hang-monitor",
                    "--disable-prompt-on-repost",
                    "--disable-sync",
                    "--disable-translate",
                    "--metrics-recording-only",
                    "--mute-audio",
                    "--disable-breakpad",
                    "--disable-component-update",
                    "--disable-domain-reliability",
                    "--disable-features=site-per-process",
                    "--disable-ipc-flooding-protection",
                    "--disable-logging",
                    "--disable-notifications",
                    "--disable-offer-store-unmasked-wallet-cards",
                    "--disable-popup-blocking",
                    "--disable-print-preview",
                    "--disable-speech-api",
                    "--disable-web-security",
                    "--disable-blink-features=AutomationControlled",
                    "--no-pings",
                    "--no-service-autorun",
                    "--password-store=basic",
                    "--use-mock-keychain",
                    "--force-color-profile=srgb",
                    "--disable-default-apps",
                    "--disk-cache-size=1",
                    "--media-cache-size=1",
                    "--aggressive-cache-discard",
                    "--disable-application-cache",
                    "--disable-offline-load-stale-cache",
                    "--disable-gpu-shader-disk-cache",
                    `--user-data-dir=/tmp/chrome-${process.pid}`
                ],
                dumpio: false,
                ignoreHTTPSErrors: true,
                protocolTimeout: 60000
            } as any),
            new Promise<never>((_, reject) =>
                setTimeout(
                    () => reject(new Error("Browser launch timeout")),
                    BROWSER_LAUNCH_TIMEOUT
                )
            )
        ]);

        browser = launchedBrowser;
        reconnectAttempts = 0;

        console.log(`[${process.pid}] Browser launched successfully`);

        browser.on("disconnected", async () => {
            if (isShuttingDown) return;

            console.error(`[${process.pid}] Browser disconnected unexpectedly`);
            browser = null;
            pagePool = [];

            if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
                reconnectAttempts++;
                console.log(
                    `[${process.pid}] Attempting to reconnect... (${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`
                );
                await new Promise((resolve) =>
                    setTimeout(resolve, BROWSER_RECONNECT_DELAY * reconnectAttempts)
                );
                try {
                    await launchBrowser();
                } catch (err) {
                    console.error(`[${process.pid}] Failed to reconnect browser:`, err);
                }
            } else {
                console.error(`[${process.pid}] Max reconnection attempts reached`);
            }
        });

        return launchedBrowser;
    } catch (error) {
        console.error(`[${process.pid}] Failed to launch browser:`, error);
        browser = null;
        throw error;
    } finally {
        browserLaunching = false;
    }
}

async function createPage(): Promise<Page> {
    if (!browser || !browser.connected) {
        browser = await launchBrowser();
    }

    try {
        const page = await browser.newPage();

        await page.setViewport({ width: 1280, height: 800 });

        await page.setUserAgent(
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
        );

        page.setDefaultNavigationTimeout(PAGE_TIMEOUT);
        page.setDefaultTimeout(PAGE_TIMEOUT);

        return page;
    } catch (error) {
        console.error(`[${process.pid}] Failed to create page:`, error);
        if (browser && browser.connected) {
            try {
                await browser.close();
            } catch {}
        }
        browser = null;
        throw error;
    }
}

export async function getPage(): Promise<Page> {
    const now = Date.now();

    const availablePage = pagePool.find((p) => !p.inUse && p.uses < MAX_PAGE_REUSES);

    if (availablePage) {
        availablePage.inUse = true;
        availablePage.uses++;
        availablePage.lastUsed = now;

        try {
            if (!availablePage.page.isClosed()) {
                await availablePage.page
                    .goto("about:blank", { waitUntil: "domcontentloaded", timeout: 5000 })
                    .catch(() => {});
                return availablePage.page;
            }
        } catch (err) {
            console.error(`[${process.pid}] Page in pool is unusable:`, err);
            pagePool = pagePool.filter((p) => p !== availablePage);
        }
    }

    if (pagePool.length < POOL_SIZE) {
        try {
            const page = await createPage();
            const pooledPage: PooledPage = {
                page,
                inUse: true,
                uses: 1,
                lastUsed: now
            };
            pagePool.push(pooledPage);
            return page;
        } catch (error) {
            console.error(`[${process.pid}] Failed to create new page:`, error);
            if (pagePool.length > 0) {
                await new Promise((resolve) => setTimeout(resolve, 1000));
                return getPage();
            }
            throw error;
        }
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
    return getPage();
}

export function releasePage(page: Page): void {
    const pooledPage = pagePool.find((p) => p.page === page);

    if (pooledPage) {
        pooledPage.inUse = false;

        if (pooledPage.uses >= MAX_PAGE_REUSES) {
            page.close().catch((err) => {
                console.error(`[${process.pid}] Error closing page:`, err);
            });
            pagePool = pagePool.filter((p) => p !== pooledPage);
        } else {
            page.removeAllListeners();
            page.setRequestInterception(false).catch(() => {});
        }
    } else {
        page.close().catch((err) => {
            console.error(`[${process.pid}] Error closing unreleased page:`, err);
        });
    }
}

export function getPoolSize(): number {
    return pagePool.length;
}

export async function closeAll(): Promise<void> {
    isShuttingDown = true;

    console.log(`[${process.pid}] Closing all pages and browser...`);

    const closePromises = pagePool.map(async (pooledPage) => {
        try {
            if (!pooledPage.page.isClosed()) {
                await pooledPage.page.close();
            }
        } catch (err) {
            console.error(`[${process.pid}] Error closing page:`, err);
        }
    });

    await Promise.allSettled(closePromises);
    pagePool = [];

    if (browser) {
        try {
            await browser.close();
            console.log(`[${process.pid}] Browser closed successfully`);
        } catch (err) {
            console.error(`[${process.pid}] Error closing browser:`, err);
        }
        browser = null;
    }
}

setInterval(() => {
    if (isShuttingDown) return;

    const now = Date.now();
    const stalePeriod = 300000;

    const stalePages = pagePool.filter(
        (pooledPage) => !pooledPage.inUse && now - pooledPage.lastUsed > stalePeriod
    );

    stalePages.forEach((pooledPage) => {
        pooledPage.page.close().catch(() => {});
    });

    if (stalePages.length > 0) {
        pagePool = pagePool.filter((p) => !stalePages.includes(p));
        console.log(`[${process.pid}] Cleaned up ${stalePages.length} stale pages`);
    }
}, 60000);
