"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getBrowser = getBrowser;
exports.getPage = getPage;
exports.releasePage = releasePage;
exports.closeAll = closeAll;
exports.getPoolSize = getPoolSize;
const puppeteer_1 = __importDefault(require("puppeteer"));
let browserInstance = null;
const pagePool = [];
const MAX_PAGES = 5;
async function getBrowser() {
    if (!browserInstance) {
        browserInstance = await puppeteer_1.default.launch({
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
async function getPage() {
    const browser = await getBrowser();
    if (pagePool.length > 0) {
        return pagePool.pop();
    }
    const page = await browser.newPage();
    await setupPage(page);
    return page;
}
function releasePage(page) {
    if (pagePool.length < MAX_PAGES) {
        page.goto("about:blank").catch(() => { });
        pagePool.push(page);
    }
    else {
        page.close().catch(() => { });
    }
}
async function closeAll() {
    await Promise.all(pagePool.map((p) => p.close().catch(() => { })));
    pagePool.length = 0;
    if (browserInstance) {
        await browserInstance.close();
        browserInstance = null;
    }
}
async function setupPage(page) {
    await page.setRequestInterception(true);
    page.on("request", (req) => {
        const resourceType = req.resourceType();
        if (["font", "stylesheet", "media"].includes(resourceType)) {
            req.abort();
        }
        else {
            req.continue();
        }
    });
    await page.setViewport({ width: 1920, height: 1080 });
    await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36");
    await page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, "webdriver", { get: () => undefined });
        // @ts-expect-error augments window
        window.navigator.chrome = { runtime: {} };
    });
}
function getPoolSize() {
    return pagePool.length;
}
