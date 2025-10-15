import { Page } from "puppeteer";
import { getPage, releasePage } from "../lib/browser";
import { delay } from "../lib/utils";
import { ProductDetailRaw } from "../types";

export async function scrapeProductList(
    url: string,
    maxProducts = 20
): Promise<
    Array<{
        name: string;
        originalPrice: number | null;
        discountedPrice: number | null;
        discountPercent: number;
        image: string;
        url: string;
    }>
> {
    const page = await getPage();
    const requestHandler = (req: any) => {
        const resourceType = req.resourceType();
        if (resourceType === "image" || resourceType === "font" || resourceType === "media") {
            req.abort().catch(() => {});
        } else {
            req.continue().catch(() => {});
        }
    };

    try {
        await page.setRequestInterception(true);
        page.on("request", requestHandler);

        await page.goto(url, {
            waitUntil: "domcontentloaded",
            timeout: 30000
        });

        await delay(1200);
        await autoScroll(page, 2000, 100, 300);
        await delay(800);

        const products = await page.evaluate((max) => {
            const results: Array<{
                name: string;
                originalPrice: number | null;
                discountedPrice: number | null;
                discountPercent: number;
                image: string;
                url: string;
            }> = [];

            const selectors = [
                "article",
                '[data-testid*="product"]',
                ".product-card",
                '[class*="ProductCard"]',
                '[class*="product-item"]',
                'li[class*="product"]',
                'div[class*="product"]'
            ];

            let elements: NodeListOf<Element> | [] = [] as any;
            for (const selector of selectors) {
                elements = document.querySelectorAll(selector);
                if (elements.length > 0) break;
            }

            for (let i = 0; i < (elements as any).length && results.length < max; i++) {
                const el = (elements as any)[i] as HTMLElement;
                try {
                    const outOfStock = el.querySelector(".MuiBox-root.css-1x501f6");
                    if (outOfStock?.textContent?.includes("Out of stock")) continue;

                    let originalPrice: number | null = null;
                    let discountedPrice: number | null = null;
                    let discountPercent: number = 0;

                    const discountPriceElement = el.querySelector(
                        '[data-test-id*="_discount_price"]'
                    );
                    const originalPriceElement = el.querySelector(
                        '[data-test-id*="_original_price"]'
                    );
                    const discountPercentElement = el.querySelector(
                        '[data-test-id*="_discount_percent"]'
                    );
                    const regularPriceElement = el.querySelector('[data-test-id*="_price"]');

                    if (discountPriceElement && originalPriceElement) {
                        const discountPriceText =
                            discountPriceElement.textContent?.replace(/[฿\s]/g, "") || "";
                        const originalPriceText =
                            originalPriceElement.textContent?.replace(/[฿\s]/g, "") || "";

                        const discountMatch = discountPriceText.match(/([\d,]+(?:\.[\d]+)?)/);
                        const originalMatch = originalPriceText.match(/([\d,]+(?:\.[\d]+)?)/);

                        if (discountMatch) {
                            discountedPrice = parseFloat(discountMatch[1].replace(/,/g, ""));
                        }
                        if (originalMatch) {
                            originalPrice = parseFloat(originalMatch[1].replace(/,/g, ""));
                        }

                        if (discountPercentElement) {
                            const percentText = discountPercentElement.textContent || "";
                            const percentMatch = percentText.match(/-?(\d+)%/);
                            if (percentMatch) {
                                discountPercent = parseInt(percentMatch[1]);
                            }
                        }
                    } else if (regularPriceElement) {
                        const priceText =
                            regularPriceElement.textContent?.replace(/[฿\s]/g, "") || "";
                        const priceMatch = priceText.match(/([\d,]+(?:\.[\d]+)?)/);
                        if (priceMatch) {
                            const price = parseFloat(priceMatch[1].replace(/,/g, ""));
                            originalPrice = price;
                            discountedPrice = price;
                            discountPercent = 0;
                        }
                    }

                    if (discountedPrice === 0 || originalPrice === 0) continue;

                    const nameElement =
                        el.querySelector('[data-test-id*="title"]') ||
                        el.querySelector("h2") ||
                        el.querySelector("h3") ||
                        el.querySelector('[class*="title"]');
                    const name = nameElement?.textContent?.trim() || "";

                    const imgElement = el.querySelector("img") as HTMLImageElement | null;
                    let image = "";
                    if (imgElement) {
                        const src =
                            (imgElement as any).src ||
                            (imgElement as any).dataset?.src ||
                            (imgElement as any).srcset;
                        if (src) image = src.split(" ")[0].split("?")[0];
                    }

                    const linkElement = el.querySelector("a") as HTMLAnchorElement | null;
                    const link = linkElement?.href || "";

                    if (link && name && discountedPrice !== null) {
                        const cleanUrl = link.startsWith("http")
                            ? link
                            : `https://www.makro.pro${link}`;
                        results.push({
                            name,
                            originalPrice,
                            discountedPrice,
                            discountPercent,
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

        return products;
    } catch (error) {
        throw error;
    } finally {
        page.removeAllListeners("request");
        await page.setRequestInterception(false).catch(() => {});
        releasePage(page);
    }
}

export async function scrapeProductDetail(url: string): Promise<ProductDetailRaw> {
    const page = await getPage();
    const requestHandler = (req: any) => {
        const resourceType = req.resourceType();
        if (resourceType === "font" || resourceType === "media") {
            req.abort().catch(() => {});
        } else {
            req.continue().catch(() => {});
        }
    };

    try {
        await page.setRequestInterception(true);
        page.on("request", requestHandler);

        await page.goto(url, {
            waitUntil: "domcontentloaded",
            timeout: 30000
        });

        await delay(1500);
        await autoScroll(page, 3000, 50, 200);
        await delay(1000);

        const productDetail = await page.evaluate(() => {
            const getText = (selector: string): string => {
                const elem = document.querySelector(selector);
                return (elem?.textContent || "").trim();
            };

            const titleElement = document.querySelector('[data-test-id$="_product_title"]');
            const title = titleElement?.textContent?.trim() || getText("h1");

            const productId =
                titleElement?.getAttribute("data-test-id")?.replace("_product_title", "") || "";

            const brand = getText('[data-test-id="brand_title"]');
            const pricePerUnit = getText('[data-test-id="price_unit_title"]');
            const codeText = getText('[data-test-id="makro_code_title"]');
            const code = codeText.replace("Code :", "").trim();

            let originalPrice = 0;
            let discountedPrice = 0;
            let discountPercent = 0;

            const parsePrice = (text: string): number => {
                if (!text) return 0;
                const cleaned = text.replace(/฿/g, "").replace(/,/g, "").replace(/\s+/g, "");
                const match = cleaned.match(/(\d+\.?\d*)/);
                return match ? parseFloat(match[1]) : 0;
            };

            if (productId) {
                const discountPriceEl = document.querySelector(
                    `[data-test-id="${productId}_discount_price"]`
                );
                const originalPriceEl = document.querySelector(
                    `[data-test-id="${productId}_original_price"]`
                );

                if (discountPriceEl && originalPriceEl) {
                    discountedPrice = parsePrice(discountPriceEl.textContent || "");
                    originalPrice = parsePrice(originalPriceEl.textContent || "");

                    const discountEl = document.querySelector(
                        `[data-test-id="${productId}_discount_percent"]`
                    );
                    if (discountEl?.textContent) {
                        const match = discountEl.textContent.match(/-?(\d+)%/);
                        if (match) discountPercent = parseInt(match[1]);
                    }
                } else {
                    const regularPriceEl = document.querySelector(
                        `[data-test-id="${productId}_price"]`
                    );
                    if (regularPriceEl) {
                        originalPrice = parsePrice(regularPriceEl.textContent || "");
                    }
                    discountedPrice = 0;
                    discountPercent = 0;
                }
            }

            const specifications: Record<string, string> = {};
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
                                if (key && value && key.length < 100) specifications[key] = value;
                            } else if (line.startsWith("-")) {
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
                            if (key && value) specifications[key] = value;
                        }
                    });
                }
            }

            const images = new Set<string>();

            const extractImageUrl = (srcsetOrSrc: string): string | null => {
                const urlMatch = srcsetOrSrc.match(/url=([^&\s]+)/);
                if (urlMatch) {
                    try {
                        return decodeURIComponent(urlMatch[1]);
                    } catch {
                        return urlMatch[1];
                    }
                }
                const directMatch = srcsetOrSrc.match(/https?:\/\/[^\s&]+/);
                if (directMatch) {
                    return directMatch[0];
                }
                return null;
            };

            const mainImage = document.querySelector(
                'img[data-testid="main-image"]'
            ) as HTMLImageElement;
            if (mainImage && mainImage.alt === "product-main-image") {
                const srcset = mainImage.srcset || mainImage.src;
                if (srcset) {
                    const imageUrl = extractImageUrl(srcset);
                    if (imageUrl && imageUrl.includes("siammakro.cloud")) {
                        images.add(imageUrl);
                    }
                }
            }

            const thumbnailImages = document.querySelectorAll(
                'img[data-testid^="thumbnail-image"]'
            );
            thumbnailImages.forEach((img) => {
                const anyImg = img as HTMLImageElement;
                const altText = anyImg.alt || "";
                if (
                    altText.toLowerCase().includes("thumbnail") &&
                    altText.toLowerCase().includes("of")
                ) {
                    const srcset = anyImg.srcset || anyImg.src;
                    if (srcset) {
                        const imageUrl = extractImageUrl(srcset);
                        if (imageUrl && imageUrl.includes("siammakro.cloud")) {
                            images.add(imageUrl);
                        }
                    }
                }
            });

            if (images.size === 0) {
                const imageSelectors = [
                    '[class*="gallery"] img',
                    '[class*="Gallery"] img',
                    '[class*="image-container"] img',
                    '[class*="product-image"] img',
                    '[class*="ProductImage"] img',
                    '[data-testid*="image"] img'
                ];

                for (const selector of imageSelectors) {
                    const imgs = document.querySelectorAll(selector);
                    if (imgs.length > 0) {
                        imgs.forEach((img) => {
                            const anyImg = img as HTMLImageElement;
                            const src = anyImg.src || anyImg.dataset?.src || anyImg.srcset;
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
            }

            if (images.size === 0) {
                document.querySelectorAll("img").forEach((img) => {
                    const anyImg = img as HTMLImageElement;
                    const src = anyImg.src || anyImg.dataset?.src;
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
                originalPrice,
                discountedPrice,
                discountPercent,
                specifications,
                images: Array.from(images),
                url: window.location.href
            };
        });

        return productDetail as ProductDetailRaw;
    } catch (error) {
        throw error;
    } finally {
        page.removeAllListeners("request");
        await page.setRequestInterception(false).catch(() => {});
        releasePage(page);
    }
}

async function autoScroll(
    page: Page,
    targetHeight: number,
    intervalMs: number,
    distance: number
): Promise<void> {
    await page.evaluate(
        async ({ targetHeight, intervalMs, distance }) => {
            await new Promise<void>((resolve) => {
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
        },
        { targetHeight, intervalMs, distance }
    );
}
