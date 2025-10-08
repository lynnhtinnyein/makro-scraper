const express = require("express");
const http = require("http");
const cors = require("cors");
const dotenv = require("dotenv");
const puppeteer = require("puppeteer");
const axios = require("axios");

const environment = process.env.NODE_ENV || "development";
const envFile = `.env.${environment}`;
dotenv.config({ path: envFile });

const app = express();

const allowedOrigins = process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(",") : ["*"];
app.use(
    cors({
        origin: (origin, callback) => {
            if (!origin || allowedOrigins.includes("*") || allowedOrigins.includes(origin)) {
                callback(null, true);
            } else {
                callback(new Error("Not allowed by CORS"));
            }
        },
        methods: ["GET", "POST"]
    })
);
app.use(express.json());

let browserInstance = null;
const pagePool = [];
const MAX_PAGES = 5;

async function getBrowser() {
    if (!browserInstance) {
        console.log("Launching browser...");
        browserInstance = await puppeteer.launch({
            headless: "new",
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
        console.log("Browser ready!");
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
        page.goto("about:blank").catch(() => {});
        pagePool.push(page);
    } else {
        page.close().catch(() => {});
    }
}

async function setupPage(page) {
    await page.setRequestInterception(true);
    page.on("request", (req) => {
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
        Object.defineProperty(navigator, "webdriver", {
            get: () => undefined
        });
        window.navigator.chrome = { runtime: {} };
    });
}

function extractDimensions(volumeText) {
    const dimensions = { length: null, width: null, height: null, weight: null };
    if (!volumeText) return dimensions;

    const match = volumeText.match(/([\d.]+)\s*x\s*([\d.]+)\s*x\s*([\d.]+)\s*cm.*?([\d.]+)\s*kg/i);
    if (match) {
        dimensions.length = parseFloat(match[1]);
        dimensions.width = parseFloat(match[2]);
        dimensions.height = parseFloat(match[3]);
        dimensions.weight = parseFloat(match[4]);
    }
    return dimensions;
}

function extractPrice(priceText) {
    if (!priceText) return null;
    const match = priceText.match(/([\d,]+(?:\.\d+)?)/);
    return match ? parseFloat(match[1].replace(/,/g, "")) : null;
}

function getOriginalPrice(discountedPrice, discountPercent) {
    const discountRate = 1 - discountPercent / 100;
    const originalPrice = discountedPrice / discountRate;
    return parseFloat(originalPrice.toFixed(2));
}

function cleanProductName(name) {
    return name ? name.replace(/\s*x\s*\d+\s*$/i, "").trim() : name;
}

function transformProductData(details) {
    const dimensions = extractDimensions(details.specifications["Total volume"]);
    const pricePerUnit = extractPrice(details.pricePerUnit);
    const originalPrice = getOriginalPrice(pricePerUnit, details.discountPercent || 0);

    return {
        name: cleanProductName(details.title),
        brand: details.brand || null,
        url: details.url,
        images: details.images || [],
        variant: {
            image: details.images?.[0] || null,
            price: originalPrice,
            sku: details.code || details.specifications["SKU"] || null,
            discount: details.discountPercent || 0,
            length: dimensions.length,
            width: dimensions.width,
            height: dimensions.height,
            weight: dimensions.weight
        }
    };
}

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function scrapeProductList(url, maxProducts = 20) {
    const page = await getPage();

    try {
        await page.goto(url, {
            waitUntil: "domcontentloaded",
            timeout: 30000
        });

        await delay(2000);

        await page.evaluate(async () => {
            await new Promise((resolve) => {
                let totalHeight = 0;
                const distance = 300;
                const timer = setInterval(() => {
                    window.scrollBy(0, distance);
                    totalHeight += distance;
                    if (totalHeight >= 3000) {
                        clearInterval(timer);
                        resolve();
                    }
                }, 80);
            });
        });

        await delay(1500);

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
                if (elements.length > 0) break;
            }

            for (let i = 0; i < elements.length && results.length < max; i++) {
                const el = elements[i];
                try {
                    const outOfStock = el.querySelector(".MuiBox-root.css-1x501f6");
                    if (outOfStock?.textContent.includes("Out of stock")) continue;

                    const priceElement = el.querySelector('[data-test-id="price_unit_title"]');
                    let price = null;
                    if (priceElement) {
                        const priceMatch = priceElement.textContent.match(/([\d,]+(?:\.\d+)?)/);
                        if (priceMatch) {
                            price = parseFloat(priceMatch[1].replace(/,/g, ""));
                            if (price === 0) continue;
                        }
                    }

                    const nameElement =
                        el.querySelector('[data-test-id*="title"]') ||
                        el.querySelector("h2") ||
                        el.querySelector("h3") ||
                        el.querySelector('[class*="title"]');
                    const name = nameElement?.textContent.trim() || "";

                    const imgElement = el.querySelector("img");
                    let image = "";
                    if (imgElement) {
                        const src = imgElement.src || imgElement.dataset.src || imgElement.srcset;
                        if (src) image = src.split(" ")[0].split("?")[0];
                    }

                    const linkElement = el.querySelector("a");
                    const link = linkElement?.href || "";

                    if (link && name) {
                        const cleanUrl = link.startsWith("http")
                            ? link
                            : `https://www.makro.pro${link}`;
                        results.push({
                            name,
                            price,
                            image,
                            url: cleanUrl.split("?")[0]
                        });
                    }
                } catch (err) {
                    console.error("Error extracting product:", err);
                }
            }
            return results;
        }, maxProducts);

        releasePage(page);
        return products;
    } catch (error) {
        console.error("Scraping error:", error);
        releasePage(page);
        throw error;
    }
}

async function scrapeProductDetail(url) {
    const page = await getPage();

    try {
        await page.goto(url, {
            waitUntil: "domcontentloaded",
            timeout: 45000
        });

        await delay(3000);

        await page.evaluate(async () => {
            await new Promise((resolve) => {
                let totalHeight = 0;
                const distance = 200;
                const timer = setInterval(() => {
                    window.scrollBy(0, distance);
                    totalHeight += distance;
                    if (totalHeight >= 5000) {
                        clearInterval(timer);
                        resolve();
                    }
                }, 40);
            });
        });

        await delay(2000);

        const productDetail = await page.evaluate(() => {
            const getText = (selector) => {
                const elem = document.querySelector(selector);
                return elem?.textContent?.trim() || "";
            };

            const title = getText('[data-test-id*="_product_title"]') || getText("h1");
            const brand = getText('[data-test-id="brand_title"]');
            const pricePerUnit = getText('[data-test-id="price_unit_title"]');
            const codeText = getText('[data-test-id="makro_code_title"]');
            const code = codeText.replace("Code :", "").trim();

            let discountPercent = 0;
            const discountEl = document.querySelector('[data-test-id*="_discount_percent"]');
            if (discountEl) {
                const match = discountEl.textContent.match(/-?(\d+)%/);
                if (match) discountPercent = parseInt(match[1]);
            }

            const specifications = {};
            const descContainer = document.querySelector('[class*="css-1edfter"]');

            if (descContainer) {
                const descSection = descContainer.querySelector('[class*="css-1gsuyp6"]');
                if (descSection) {
                    const descText = descSection.querySelector('[class*="css-1m5mcr3"]');
                    if (descText) {
                        const lines = descText.textContent.split("\n").filter((l) => l.trim());
                        lines.forEach((line) => {
                            line = line.trim();
                            if (line.includes(":")) {
                                const colonIndex = line.indexOf(":");
                                const key = line.substring(0, colonIndex).trim();
                                const value = line.substring(colonIndex + 1).trim();
                                if (key && value && key.length < 100) {
                                    specifications[key] = value;
                                }
                            } else if (line.startsWith("-")) {
                                const cleanLine = line.substring(1).trim();
                                if (cleanLine.includes(":")) {
                                    const colonIndex = cleanLine.indexOf(":");
                                    const key = cleanLine.substring(0, colonIndex).trim();
                                    const value = cleanLine.substring(colonIndex + 1).trim();
                                    if (key && value && key.length < 100) {
                                        specifications[key] = value;
                                    }
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
                            const key = divs[0].textContent.trim();
                            const value = divs[1].textContent.trim();
                            if (key && value) specifications[key] = value;
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
                        const src = img.src || img.dataset.src || img.srcset;
                        if (src?.includes("http")) {
                            const cleanSrc = src.split(" ")[0].split("?")[0];
                            if (
                                cleanSrc.includes("product-images") ||
                                cleanSrc.includes("siammakro.cloud")
                            ) {
                                images.add(cleanSrc);
                            }
                        }
                    });
                    if (images.size > 0) break;
                }
            }

            if (images.size === 0) {
                document.querySelectorAll("img").forEach((img) => {
                    const src = img.src || img.dataset.src;
                    if (
                        src?.includes("http") &&
                        !src.includes("icon") &&
                        !src.includes("logo") &&
                        !src.includes("ribbon") &&
                        (src.includes("product-images") || src.includes("siammakro.cloud"))
                    ) {
                        images.add(src.split("?")[0]);
                    }
                });
            }

            return {
                title,
                brand,
                pricePerUnit,
                code,
                discountPercent,
                specifications,
                images: Array.from(images),
                url: window.location.href
            };
        });

        releasePage(page);

        return {
            success: true,
            product: transformProductData(productDetail),
            timestamp: new Date().toISOString(),
            source: url
        };
    } catch (error) {
        console.error("Product detail scraping error:", error);
        releasePage(page);
        throw error;
    }
}

const axiosInstance = axios.create({
    timeout: 30000,
    maxRedirects: 5,
    httpAgent: new (require("http").Agent)({ keepAlive: true }),
    httpsAgent: new (require("https").Agent)({ keepAlive: true })
});

async function submitProduct(token, productData, categoryIds, productAttributeValueId) {
    const payload = {
        productDTO: {
            name: productData.name,
            nameThai: "",
            nameBurmese: "",
            brand: productData.brand || "",
            description: productData.name,
            descriptionThai: "",
            descriptionBurmese: "",
            categoryId: categoryIds.categoryId,
            productLicenseType: "NONE",
            productLicenseNumber: "",
            mainCategoryId: categoryIds.mainCategoryId,
            subCategoryId: categoryIds.subCategoryId,
            subSubCategoryId: categoryIds.categoryId,
            sellerId: categoryIds.sellerId,
            price: 0,
            discount: 0,
            stock: 0,
            slug: "product-slug",
            isDiscount: productData.variant.discount > 0
        },
        productVariantDTO: [
            {
                price: String(productData.variant.price || 0),
                stock: "9999999",
                sku: productData.variant.sku || "",
                discount: String(productData.variant.discount || 0),
                weight: String(productData.variant.weight || 0),
                width: String(productData.variant.width || 0),
                length: String(productData.variant.length || 0),
                height: String(productData.variant.height || 0),
                enable: true,
                productAttributeValueId: [String(productAttributeValueId)],
                imageUrl: productData.variant.image || ""
            }
        ]
    };

    const response = await axiosInstance.post(
        "https://api.ecommerce.neon-xpress.com/v1/api/product/saveWithVariants",
        payload,
        {
            headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json"
            }
        }
    );

    return response.data.productDTO.id;
}

async function uploadProductImages(token, productId, imageUrls) {
    const maxImages = 8;
    const imagesToUpload = imageUrls.slice(0, maxImages);

    const concurrency = 3;
    const errors = [];

    for (let i = 0; i < imagesToUpload.length; i += concurrency) {
        const batch = imagesToUpload.slice(i, i + concurrency);
        const promises = batch.map((imageUrl, idx) =>
            axiosInstance
                .post(
                    "https://api.ecommerce.neon-xpress.com/v1/api/product-image/save-image-url",
                    { productId, imageUrl },
                    {
                        headers: {
                            Authorization: `Bearer ${token}`,
                            "Content-Type": "application/json"
                        }
                    }
                )
                .catch((error) => {
                    errors.push({ imageUrl, error: error.message });
                    return null;
                })
        );

        await Promise.all(promises);
    }

    return {
        uploaded: imagesToUpload.length - errors.length,
        errors
    };
}

app.get("/health", async (req, res) => {
    res.status(200).json({
        message: "Makro Scraper API is running",
        status: "ok",
        poolSize: pagePool.length,
        endpoints: {
            getProductList: "/api/products/list",
            submitProducts: "/api/products/submit"
        }
    });
});

app.post("/api/products/list", async (req, res) => {
    const { url, max } = req.body;
    const maxProducts = Math.min(parseInt(max) || 20, 20);

    if (!url) {
        return res.status(400).json({ error: "URL parameter is required" });
    }

    try {
        const products = await scrapeProductList(url, maxProducts);
        res.json(products);
    } catch (error) {
        console.error("Product list endpoint error:", error);
        res.status(500).json({ error: error.message });
    }
});

app.post("/api/products/submit", async (req, res) => {
    const { token, productGroups } = req.body;

    if (!token || !productGroups || !Array.isArray(productGroups)) {
        return res.status(400).json({
            error: "Token and productGroups are required"
        });
    }

    let addedCount = 0;
    const errors = [];

    try {
        for (const group of productGroups) {
            const {
                productUrls,
                mainCategoryId,
                subCategoryId,
                categoryId,
                sellerId,
                productAttributeValueId
            } = group;

            const concurrency = 2;
            for (let i = 0; i < productUrls.length; i += concurrency) {
                const batch = productUrls.slice(i, i + concurrency);

                const results = await Promise.allSettled(
                    batch.map(async (productUrl) => {
                        const productResult = await scrapeProductDetail(productUrl);

                        if (productResult.success) {
                            const productId = await submitProduct(
                                token,
                                productResult.product,
                                { mainCategoryId, subCategoryId, categoryId, sellerId },
                                productAttributeValueId
                            );

                            if (productId && productResult.product.images?.length > 0) {
                                await uploadProductImages(
                                    token,
                                    productId,
                                    productResult.product.images
                                );
                            }
                            return { success: true };
                        }
                        return { success: false, url: productUrl };
                    })
                );

                results.forEach((result, idx) => {
                    if (result.status === "fulfilled" && result.value.success) {
                        addedCount++;
                    } else {
                        errors.push({
                            url: batch[idx],
                            error: result.reason?.message || "Unknown error"
                        });
                    }
                });
            }
        }

        res.status(200).json({
            addedCount,
            errors: errors.length > 0 ? errors : undefined
        });
    } catch (error) {
        console.error("Submit products error:", error);
        res.status(500).json({ error: error.message, addedCount });
    }
});

app.get("/close", async (req, res) => {
    try {
        await Promise.all(pagePool.map((page) => page.close().catch(() => {})));
        pagePool.length = 0;

        if (browserInstance) {
            await browserInstance.close();
            browserInstance = null;
            res.json({ success: true, message: "Browser closed successfully" });
        } else {
            res.json({ success: true, message: "No browser instance to close" });
        }
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

const server = http.createServer(app);
const PORT = process.env.PORT || 4000;
const hostUrl = process.env.HOST_URL || "0.0.0.0";

server.listen(PORT, hostUrl, () => {
    console.log(`========================================`);
    console.log(`Makro Scraper API is running`);
    console.log(`Port: ${PORT}`);
    console.log(`========================================`);
});

process.on("SIGINT", async () => {
    console.log("\nShutting down...");
    await Promise.all(pagePool.map((page) => page.close().catch(() => {})));
    if (browserInstance) await browserInstance.close();
    process.exit(0);
});
