import puppeteer, { Browser, HTTPRequest, Page } from "puppeteer";

let browserInstance: Browser | null = null;
const pagePool: Page[] = [];
const MAX_PAGES = 5;

export async function getBrowser(): Promise<Browser> {
    if (!browserInstance) {
        browserInstance = await puppeteer.launch({
            headless: true,
            args: [
                "--no-sandbox",
                "--disable-setuid-sandbox",
                "--disable-blink-features=AutomationControlled",
                "--disable-dev-shm-usage",
                "--disable-gpu",
                "--disable-software-rasterizer",
                "--disable-extensions",
                "--disable-background-networking",
                "--disable-background-timer-throttling",
                "--disable-backgrounding-occluded-windows",
                "--disable-renderer-backgrounding"
            ]
        });
    }
    return browserInstance;
}

export async function getPage(): Promise<Page> {
    const browser = await getBrowser();
    if (pagePool.length > 0) {
        return pagePool.pop() as Page;
    }
    const page = await browser.newPage();
    await setupPage(page);
    return page;
}

export function releasePage(page: Page): void {
    if (pagePool.length < MAX_PAGES) {
        page.goto("about:blank").catch(() => {});
        pagePool.push(page);
    } else {
        page.close().catch(() => {});
    }
}

export async function closeAll(): Promise<void> {
    await Promise.all(pagePool.map((p) => p.close().catch(() => {})));
    pagePool.length = 0;
    if (browserInstance) {
        await browserInstance.close();
        browserInstance = null;
    }
}

async function setupPage(page: Page): Promise<void> {
    await page.setRequestInterception(true);
    page.on("request", (req: HTTPRequest) => {
        const resourceType = req.resourceType();
        if (["font", "stylesheet", "media"].includes(resourceType)) {
            req.abort();
        } else {
            req.continue();
        }
    });

    await page.setViewport({ width: 1920, height: 1080 });
    await page.setUserAgent(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    );

    await page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, "webdriver", { get: () => undefined });
        // @ts-expect-error augments window
        window.navigator.chrome = { runtime: {} };
    });
}

export function getPoolSize(): number {
    return pagePool.length;
}
