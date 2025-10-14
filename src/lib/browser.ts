import puppeteer, { Browser, Page } from "puppeteer";

const POOL_SIZE = 4;
const MAX_PAGES_PER_BROWSER = 3;
const BROWSER_IDLE_TIMEOUT = 300000;

interface BrowserInstance {
    browser: Browser;
    pages: Page[];
    lastUsed: number;
    activePages: number;
    id: string;
}

const browserPool: BrowserInstance[] = [];
const pageQueue: Array<(page: Page) => void> = [];
let isInitialized = false;

function getExecutablePath(): string | undefined {
    if (process.env.PUPPETEER_EXECUTABLE_PATH) {
        return process.env.PUPPETEER_EXECUTABLE_PATH;
    }

    const paths = [
        "/usr/bin/chromium-browser",
        "/usr/bin/chromium",
        "/usr/bin/google-chrome",
        "/usr/bin/google-chrome-stable"
    ];

    const fs = require("fs");
    for (const path of paths) {
        try {
            if (fs.existsSync(path)) {
                return path;
            }
        } catch (e) {
            console.log("Error checking path:", e);
        }
    }

    return undefined;
}

async function createBrowser(): Promise<BrowserInstance> {
    const browser = await puppeteer.launch({
        headless: true,
        executablePath: getExecutablePath(),
        args: [
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-dev-shm-usage",
            "--disable-accelerated-2d-canvas",
            "--no-first-run",
            "--no-zygote",
            "--disable-gpu",
            "--disable-extensions",
            "--disable-background-networking",
            "--disable-background-timer-throttling",
            "--disable-backgrounding-occluded-windows",
            "--disable-breakpad",
            "--disable-component-extensions-with-background-pages",
            "--disable-features=TranslateUI,BlinkGenPropertyTrees",
            "--disable-ipc-flooding-protection",
            "--disable-renderer-backgrounding",
            "--enable-features=NetworkService,NetworkServiceInProcess",
            "--force-color-profile=srgb",
            "--metrics-recording-only",
            "--mute-audio",
            "--disable-default-apps",
            "--disable-sync",
            "--hide-scrollbars"
        ],
        defaultViewport: { width: 1280, height: 720 }
    });

    const id = Math.random().toString(36).substring(7);

    return {
        browser,
        pages: [],
        lastUsed: Date.now(),
        activePages: 0,
        id
    };
}

async function initializeBrowserPool(): Promise<void> {
    if (isInitialized) return;
    try {
        for (let i = 0; i < POOL_SIZE; i++) {
            const instance = await createBrowser();
            browserPool.push(instance);
        }
        isInitialized = true;
    } catch (error) {
        console.error("Failed to initialize browser pool:", error);
        throw error;
    }
}

export async function getPage(): Promise<Page> {
    if (!isInitialized) {
        await initializeBrowserPool();
    }

    return new Promise(async (resolve, reject) => {
        try {
            const availableInstance = browserPool.find(
                (instance) =>
                    instance.activePages < MAX_PAGES_PER_BROWSER &&
                    !instance.browser.process()?.killed
            );

            if (availableInstance) {
                const page = await availableInstance.browser.newPage();

                await page.setRequestInterception(false);
                await page.setCacheEnabled(true);

                page.on("error", (err) => {
                    console.error(`Page crashed (Browser ${availableInstance.id}):`, err);
                });

                availableInstance.pages.push(page);
                availableInstance.activePages++;
                availableInstance.lastUsed = Date.now();

                resolve(page);
            } else {
                pageQueue.push(resolve);
            }
        } catch (error) {
            console.error("Error getting page:", error);
            reject(error);
        }
    });
}

export async function releasePage(page: Page): Promise<void> {
    const instance = browserPool.find((inst) => inst.pages.includes(page));

    if (instance) {
        try {
            await page.close();
        } catch (error) {
            console.error(`Error closing page (Browser ${instance.id}):`, error);
        }

        instance.pages = instance.pages.filter((p) => p !== page);
        instance.activePages--;
        instance.lastUsed = Date.now();

        if (pageQueue.length > 0) {
            const resolver = pageQueue.shift();
            if (resolver) {
                try {
                    const newPage = await getPage();
                    resolver(newPage);
                } catch (error) {
                    console.error("Error processing queued page request:", error);
                }
            }
        }
    }
}

export function getPoolSize(): number {
    return browserPool.length;
}

export function getPoolStats(): {
    totalBrowsers: number;
    activePages: number;
    queuedRequests: number;
    browsers: Array<{ id: string; activePages: number; totalPages: number }>;
} {
    return {
        totalBrowsers: browserPool.length,
        activePages: browserPool.reduce((sum, inst) => sum + inst.activePages, 0),
        queuedRequests: pageQueue.length,
        browsers: browserPool.map((inst) => ({
            id: inst.id,
            activePages: inst.activePages,
            totalPages: inst.pages.length
        }))
    };
}

export async function closeAll(): Promise<void> {
    for (const instance of browserPool) {
        try {
            if (!instance.browser.process()?.killed) {
                await instance.browser.close();
            }
        } catch (error) {
            console.error(`Error closing browser ${instance.id}:`, error);
        }
    }

    browserPool.length = 0;
    isInitialized = false;
}

const cleanupInterval = setInterval(async () => {
    const now = Date.now();
    const instancesToRemove: BrowserInstance[] = [];

    for (let i = browserPool.length - 1; i >= 0; i--) {
        const instance = browserPool[i];

        if (instance.activePages === 0 && now - instance.lastUsed > BROWSER_IDLE_TIMEOUT) {
            instancesToRemove.push(instance);
            browserPool.splice(i, 1);
        }
    }

    for (const instance of instancesToRemove) {
        try {
            await instance.browser.close();
        } catch (error) {
            console.error(`Error closing idle browser ${instance.id}:`, error);
        }
    }

    while (browserPool.length < Math.min(POOL_SIZE, 2)) {
        try {
            const newInstance = await createBrowser();
            browserPool.push(newInstance);
        } catch (error) {
            console.error("Error creating replacement browser:", error);
            break;
        }
    }
}, 60000);

process.on("SIGTERM", async () => {
    clearInterval(cleanupInterval);
    await closeAll();
    process.exit(0);
});

process.on("SIGINT", async () => {
    clearInterval(cleanupInterval);
    await closeAll();
    process.exit(0);
});
