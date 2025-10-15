import puppeteer, { Browser, Page } from "puppeteer-core";
import { execSync } from "child_process";
import * as os from "os";

const POOL_SIZE = 4;
const MAX_PAGE_REUSES = 10;
const PAGE_TIMEOUT = 45000;
const BROWSER_RECONNECT_DELAY = 2000;
const MAX_RECONNECT_ATTEMPTS = 3;

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
    if (browserLaunching) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        if (browser?.connected) return browser;
    }

    browserLaunching = true;

    try {
        const launchedBrowser = await puppeteer.launch({
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
                "--disable-features=IsolateOrigins,site-per-process",
                "--js-flags=--max-old-space-size=512",
                "--memory-pressure-off",
                `--max-old-space-size=512`
            ],
            dumpio: false
        } as any);

        browser = launchedBrowser;
        reconnectAttempts = 0;

        browser.on("disconnected", async () => {
            if (isShuttingDown) return;

            console.error("Browser disconnected unexpectedly");
            browser = null;
            pagePool = [];

            if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
                reconnectAttempts++;
                console.log(
                    `Attempting to reconnect... (${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`
                );
                await new Promise((resolve) => setTimeout(resolve, BROWSER_RECONNECT_DELAY));
                try {
                    await launchBrowser();
                } catch (err) {
                    console.error("Failed to reconnect browser:", err);
                }
            } else {
                console.error("Max reconnection attempts reached");
            }
        });

        return launchedBrowser;
    } finally {
        browserLaunching = false;
    }
}

async function createPage(): Promise<Page> {
    if (!browser || !browser.connected) {
        browser = await launchBrowser();
    }

    const page = await browser.newPage();

    await page.setViewport({ width: 1280, height: 800 });

    await page.setUserAgent(
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
    );

    page.setDefaultNavigationTimeout(PAGE_TIMEOUT);
    page.setDefaultTimeout(PAGE_TIMEOUT);

    return page;
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
            pagePool = pagePool.filter((p) => p !== availablePage);
        }
    }

    if (pagePool.length < POOL_SIZE) {
        const page = await createPage();
        const pooledPage: PooledPage = {
            page,
            inUse: true,
            uses: 1,
            lastUsed: now
        };
        pagePool.push(pooledPage);
        return page;
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
    return getPage();
}

export function releasePage(page: Page): void {
    const pooledPage = pagePool.find((p) => p.page === page);

    if (pooledPage) {
        pooledPage.inUse = false;

        if (pooledPage.uses >= MAX_PAGE_REUSES) {
            page.close().catch(() => {});
            pagePool = pagePool.filter((p) => p !== pooledPage);
        } else {
            page.removeAllListeners();
            page.setRequestInterception(false).catch(() => {});
        }
    } else {
        page.close().catch(() => {});
    }
}

export function getPoolSize(): number {
    return pagePool.length;
}

export async function closeAll(): Promise<void> {
    isShuttingDown = true;

    for (const pooledPage of pagePool) {
        try {
            if (!pooledPage.page.isClosed()) {
                await pooledPage.page.close();
            }
        } catch (err) {
            console.error("Error closing page:", err);
        }
    }

    pagePool = [];

    if (browser) {
        try {
            await browser.close();
        } catch (err) {
            console.error("Error closing browser:", err);
        }
        browser = null;
    }
}

setInterval(() => {
    const now = Date.now();
    const stalePeriod = 180000;

    pagePool = pagePool.filter((pooledPage) => {
        if (!pooledPage.inUse && now - pooledPage.lastUsed > stalePeriod) {
            pooledPage.page.close().catch(() => {});
            return false;
        }
        return true;
    });
}, 60000);
