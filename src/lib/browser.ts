import puppeteer, { Browser, Page } from "puppeteer";

const POOL_SIZE = 4;
const MAX_PAGES_PER_BROWSER = 3;
const BROWSER_IDLE_TIMEOUT = 300000;

interface BrowserInstance {
    browser: Browser;
    pages: Page[];
    lastUsed: number;
    activePages: number;
}

const browserPool: BrowserInstance[] = [];
const pageQueue: Array<(page: Page) => void> = [];

async function createBrowser(): Promise<BrowserInstance> {
    const browser = await puppeteer.launch({
        headless: true,
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
            "--hide-scrollbars",
            "--single-process"
        ],
        defaultViewport: { width: 1280, height: 720 }
    });

    return {
        browser,
        pages: [],
        lastUsed: Date.now(),
        activePages: 0
    };
}

async function initializeBrowserPool(): Promise<void> {
    for (let i = 0; i < POOL_SIZE; i++) {
        const instance = await createBrowser();
        browserPool.push(instance);
    }
}

export async function getPage(): Promise<Page> {
    if (browserPool.length === 0) {
        await initializeBrowserPool();
    }

    return new Promise(async (resolve) => {
        const availableInstance = browserPool.find(
            (instance) => instance.activePages < MAX_PAGES_PER_BROWSER
        );

        if (availableInstance) {
            const page = await availableInstance.browser.newPage();

            await page.setRequestInterception(false);
            await page.setCacheEnabled(true);

            availableInstance.pages.push(page);
            availableInstance.activePages++;
            availableInstance.lastUsed = Date.now();

            resolve(page);
        } else {
            pageQueue.push(resolve);
        }
    });
}

export function releasePage(page: Page): void {
    const instance = browserPool.find((inst) => inst.pages.includes(page));

    if (instance) {
        page.close().catch(console.error);
        instance.pages = instance.pages.filter((p) => p !== page);
        instance.activePages--;
        instance.lastUsed = Date.now();

        if (pageQueue.length > 0) {
            const resolver = pageQueue.shift();
            if (resolver) {
                getPage().then(resolver);
            }
        }
    }
}

export function getPoolSize(): number {
    return browserPool.length;
}

export async function closeAll(): Promise<void> {
    for (const instance of browserPool) {
        try {
            await instance.browser.close();
        } catch (error) {
            console.error("Error closing browser:", error);
        }
    }
    browserPool.length = 0;
}

setInterval(() => {
    const now = Date.now();
    browserPool.forEach((instance) => {
        if (instance.activePages === 0 && now - instance.lastUsed > BROWSER_IDLE_TIMEOUT) {
            instance.browser.close().catch(console.error);
        }
    });
}, 60000);
