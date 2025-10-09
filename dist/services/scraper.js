"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.scrapeProductList = scrapeProductList;
exports.scrapeProductDetail = scrapeProductDetail;
const browser_1 = require("../lib/browser");
const utils_1 = require("../lib/utils");
async function scrapeProductList(url, maxProducts = 20) {
    const page = await (0, browser_1.getPage)();
    try {
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
        await (0, utils_1.delay)(2000);
        await autoScroll(page, 3000, 80, 300);
        await (0, utils_1.delay)(1500);
        const products = await page.evaluate((max) => {
            const results = [];
            const selectors = [
                "article",
                '[data-testid*="product"]',
                ".product-card",
                '[class*="ProductCard"]',
                '[class*="product-item"]',
                'li[class*="product"]',
                'div[class*="product"]'
            ];
            let elements = [];
            for (const selector of selectors) {
                elements = document.querySelectorAll(selector);
                if (elements.length > 0)
                    break;
            }
            for (let i = 0; i < elements.length && results.length < max; i++) {
                const el = elements[i];
                try {
                    const outOfStock = el.querySelector(".MuiBox-root.css-1x501f6");
                    if (outOfStock?.textContent?.includes("Out of stock"))
                        continue;
                    const priceElement = el.querySelector('[data-test-id="price_unit_title"]');
                    let price = null;
                    if (priceElement?.textContent) {
                        const priceMatch = priceElement.textContent.match(/([\d,]+(?:\.[\d]+)?)/);
                        if (priceMatch) {
                            price = parseFloat(priceMatch[1].replace(/,/g, ""));
                            if (price === 0)
                                continue;
                        }
                    }
                    const nameElement = el.querySelector('[data-test-id*="title"]') ||
                        el.querySelector("h2") ||
                        el.querySelector("h3") ||
                        el.querySelector('[class*="title"]');
                    const name = nameElement?.textContent?.trim() || "";
                    const imgElement = el.querySelector("img");
                    let image = "";
                    if (imgElement) {
                        const src = imgElement.src ||
                            imgElement.dataset?.src ||
                            imgElement.srcset;
                        if (src)
                            image = src.split(" ")[0].split("?")[0];
                    }
                    const linkElement = el.querySelector("a");
                    const link = linkElement?.href || "";
                    if (link && name) {
                        const cleanUrl = link.startsWith("http")
                            ? link
                            : `https://www.makro.pro${link}`;
                        results.push({ name, price, image, url: cleanUrl.split("?")[0] });
                    }
                }
                catch (err) {
                    console.error("Error extracting product:", err);
                }
            }
            return results;
        }, maxProducts);
        return products;
    }
    finally {
        (0, browser_1.releasePage)(page);
    }
}
async function scrapeProductDetail(url) {
    const page = await (0, browser_1.getPage)();
    try {
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
        await (0, utils_1.delay)(3000);
        await autoScroll(page, 5000, 40, 200);
        await (0, utils_1.delay)(2000);
        const productDetail = await page.evaluate(() => {
            const getText = (selector) => {
                const elem = document.querySelector(selector);
                return (elem?.textContent || "").trim();
            };
            const title = getText('[data-test-id*="_product_title"]') || getText("h1");
            const brand = getText('[data-test-id="brand_title"]');
            const pricePerUnit = getText('[data-test-id="price_unit_title"]');
            const codeText = getText('[data-test-id="makro_code_title"]');
            const code = codeText.replace("Code :", "").trim();
            let originalPrice = 0;
            let discountPrice = 0;
            let discountPercent = 0;
            const originalPriceEl = document.querySelector('[data-test-id*="_original_price"]');
            if (originalPriceEl?.textContent) {
                const priceMatch = originalPriceEl.textContent
                    .replace(/[฿,\s]/g, "")
                    .match(/[\d.]+/);
                if (priceMatch)
                    originalPrice = parseFloat(priceMatch[0]);
            }
            const discountPriceEl = document.querySelector('[data-test-id*="_discount_price"]');
            if (discountPriceEl?.textContent) {
                const priceText = discountPriceEl.textContent.replace(/[฿,\s]/g, "");
                const priceMatch = priceText.match(/[\d.]+/);
                if (priceMatch)
                    discountPrice = parseFloat(priceMatch[0]);
            }
            if (originalPrice === 0) {
                const regularPriceEl = document.querySelector('[data-test-id*="_price"]');
                if (regularPriceEl?.textContent) {
                    const priceText = regularPriceEl.textContent.replace(/[฿,\s]/g, "");
                    const priceMatch = priceText.match(/[\d.]+/);
                    if (priceMatch)
                        originalPrice = parseFloat(priceMatch[0]);
                }
            }
            const discountEl = document.querySelector('[data-test-id*="_discount_percent"]');
            if (discountEl?.textContent) {
                const match = discountEl.textContent.match(/-?(\d+)%/);
                if (match)
                    discountPercent = parseInt(match[1]);
            }
            const specifications = {};
            const descContainer = document.querySelector('[class*="css-1edfter"]');
            if (descContainer) {
                const descSection = descContainer.querySelector('[class*="css-1gsuyp6"]');
                if (descSection) {
                    const descText = descSection.querySelector('[class*="css-1m5mcr3"]');
                    if (descText?.textContent) {
                        const lines = descText.textContent.split("\n").filter((l) => l.trim());
                        lines.forEach((lineRaw) => {
                            let line = lineRaw.trim();
                            if (line.includes(":")) {
                                const colonIndex = line.indexOf(":");
                                const key = line.substring(0, colonIndex).trim();
                                const value = line.substring(colonIndex + 1).trim();
                                if (key && value && key.length < 100)
                                    specifications[key] = value;
                            }
                            else if (line.startsWith("-")) {
                                const cleanLine = line.substring(1).trim();
                                if (cleanLine.includes(":")) {
                                    const colonIndex = cleanLine.indexOf(":");
                                    const key = cleanLine.substring(0, colonIndex).trim();
                                    const value = cleanLine.substring(colonIndex + 1).trim();
                                    if (key && value && key.length < 100)
                                        specifications[key] = value;
                                }
                            }
                        });
                    }
                }
                const specsSection = descContainer.querySelector('[class*="css-kc1uqk"]');
                if (specsSection) {
                    const specItems = specsSection.querySelectorAll('[class*="css-tvc15p"]');
                    specItems.forEach((item) => {
                        const divs = item.querySelectorAll('[class*="css-0"]');
                        if (divs.length >= 2) {
                            const key = (divs[0].textContent || "").trim();
                            const value = (divs[1].textContent || "").trim();
                            if (key && value)
                                specifications[key] = value;
                        }
                    });
                }
            }
            const images = new Set();
            const imageSelectors = [
                '[class*="gallery"] img',
                '[class*="Gallery"] img',
                '[class*="image-container"] img',
                '[class*="product-image"] img',
                '[class*="ProductImage"] img',
                '[data-testid*="image"] img',
                '[data-testid*="gallery"] img'
            ];
            for (const selector of imageSelectors) {
                const imgs = document.querySelectorAll(selector);
                if (imgs.length > 0) {
                    imgs.forEach((img) => {
                        const anyImg = img;
                        const src = anyImg.src || anyImg.dataset?.src || anyImg.srcset;
                        if (src?.includes("http")) {
                            const cleanSrc = src.split(" ")[0].split("?")[0];
                            if (cleanSrc.includes("product-images") ||
                                cleanSrc.includes("siammakro.cloud")) {
                                images.add(cleanSrc);
                            }
                        }
                    });
                    if (images.size > 0)
                        break;
                }
            }
            if (images.size === 0) {
                document.querySelectorAll("img").forEach((img) => {
                    const anyImg = img;
                    const src = anyImg.src || anyImg.dataset?.src;
                    if (src?.includes("http") &&
                        !src.includes("icon") &&
                        !src.includes("logo") &&
                        !src.includes("ribbon") &&
                        (src.includes("product-images") || src.includes("siammakro.cloud"))) {
                        images.add(src.split("?")[0]);
                    }
                });
            }
            return {
                title,
                brand,
                pricePerUnit,
                code,
                originalPrice,
                discountPrice,
                discountPercent,
                specifications,
                images: Array.from(images),
                url: window.location.href
            };
        });
        return productDetail;
    }
    finally {
        (0, browser_1.releasePage)(page);
    }
}
async function autoScroll(page, targetHeight, intervalMs, distance) {
    await page.evaluate(async ({ targetHeight, intervalMs, distance }) => {
        await new Promise((resolve) => {
            let totalHeight = 0;
            const timer = setInterval(() => {
                window.scrollBy(0, distance);
                totalHeight += distance;
                if (totalHeight >= targetHeight) {
                    clearInterval(timer);
                    resolve();
                }
            }, intervalMs);
        });
    }, { targetHeight, intervalMs, distance });
}
