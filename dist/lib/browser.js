"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getPage = getPage;
exports.releasePage = releasePage;
exports.getPoolSize = getPoolSize;
exports.closeAll = closeAll;
const puppeteer_1 = __importDefault(require("puppeteer"));
const POOL_SIZE = 4;
const MAX_PAGES_PER_BROWSER = 3;
const PAGE_IDLE_TIMEOUT = 120000;
const BROWSER_IDLE_TIMEOUT = 300000;
const browserPool = [];
const pageQueue = [];
async function createBrowser() {
    const browser = await puppeteer_1.default.launch({
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
async function initializeBrowserPool() {
    for (let i = 0; i < POOL_SIZE; i++) {
        const instance = await createBrowser();
        browserPool.push(instance);
    }
}
async function getPage() {
    if (browserPool.length === 0) {
        await initializeBrowserPool();
    }
    return new Promise(async (resolve) => {
        const availableInstance = browserPool.find((instance) => instance.activePages < MAX_PAGES_PER_BROWSER);
        if (availableInstance) {
            const page = await availableInstance.browser.newPage();
            await page.setRequestInterception(false);
            await page.setCacheEnabled(true);
            availableInstance.pages.push(page);
            availableInstance.activePages++;
            availableInstance.lastUsed = Date.now();
            resolve(page);
        }
        else {
            pageQueue.push(resolve);
        }
    });
}
function releasePage(page) {
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
function getPoolSize() {
    return browserPool.length;
}
async function closeAll() {
    for (const instance of browserPool) {
        try {
            await instance.browser.close();
        }
        catch (error) {
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
