import { Page } from "puppeteer";
import { getPage, releasePage } from "../lib/browser";
import { delay } from "../lib/utils";
import { ProductDetailRaw } from "../types";

export async function scrapeProductList(url: string, maxProducts = 20): Promise<Array<{ name: string; price: number | null; image: string; url: string }>> {
	const page = await getPage();
	try {
		await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
		await delay(2000);
		await autoScroll(page, 3000, 80, 300);
		await delay(1500);
		const products = await page.evaluate((max) => {
			const results: Array<{ name: string; price: number | null; image: string; url: string }> = [];
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
					const priceElement = el.querySelector('[data-test-id="price_unit_title"]');
					let price: number | null = null;
					if (priceElement?.textContent) {
						const priceMatch = priceElement.textContent.match(/([\d,]+(?:\.[\d]+)?)/);
						if (priceMatch) {
							price = parseFloat(priceMatch[1].replace(/,/g, ""));
							if (price === 0) continue;
						}
					}
					const nameElement =
						el.querySelector('[data-test-id*="title"]') || el.querySelector("h2") || el.querySelector("h3") || el.querySelector('[class*="title"]');
					const name = nameElement?.textContent?.trim() || "";
					const imgElement = el.querySelector("img") as HTMLImageElement | null;
					let image = "";
					if (imgElement) {
						const src = (imgElement as any).src || (imgElement as any).dataset?.src || (imgElement as any).srcset;
						if (src) image = src.split(" ")[0].split("?")[0];
					}
					const linkElement = el.querySelector("a") as HTMLAnchorElement | null;
					const link = linkElement?.href || "";
					if (link && name) {
						const cleanUrl = link.startsWith("http") ? link : `https://www.makro.pro${link}`;
						results.push({ name, price, image, url: cleanUrl.split("?")[0] });
					}
				} catch (err) {
					console.error("Error extracting product:", err);
				}
			}
			return results;
		}, maxProducts);
		return products;
	} finally {
		releasePage(page);
	}
}

export async function scrapeProductDetail(url: string): Promise<ProductDetailRaw> {
	const page = await getPage();
	try {
		await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
		await delay(3000);
		await autoScroll(page, 5000, 40, 200);
		await delay(2000);
		const productDetail = await page.evaluate(() => {
			const getText = (selector: string): string => {
				const elem = document.querySelector(selector);
				return (elem?.textContent || "").trim();
			};
			const title = getText('[data-test-id*="_product_title"]') || getText("h1");
			const brand = getText('[data-test-id="brand_title"]');
			const pricePerUnit = getText('[data-test-id="price_unit_title"]');
			const codeText = getText('[data-test-id="makro_code_title"]');
			const code = codeText.replace("Code :", "").trim();
			let discountPercent = 0;
			const discountEl = document.querySelector('[data-test-id*="_discount_percent"]');
			if (discountEl?.textContent) {
				const match = discountEl.textContent.match(/-?(\d+)%/);
				if (match) discountPercent = parseInt(match[1]);
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
									if (key && value && key.length < 100) specifications[key] = value;
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
							const key = (divs[0].textContent || '').trim();
							const value = (divs[1].textContent || '').trim();
							if (key && value) specifications[key] = value;
						}
					});
				}
			}
			const images = new Set<string>();
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
						const anyImg: any = img as any;
						const src: string | undefined = anyImg.src || anyImg.dataset?.src || anyImg.srcset;
						if (src?.includes("http")) {
							const cleanSrc = src.split(" ")[0].split("?")[0];
							if (cleanSrc.includes("product-images") || cleanSrc.includes("siammakro.cloud")) {
								images.add(cleanSrc);
							}
						}
					});
					if (images.size > 0) break;
				}
			}
			if (images.size === 0) {
				document.querySelectorAll("img").forEach((img) => {
					const anyImg: any = img as any;
					const src: string | undefined = anyImg.src || anyImg.dataset?.src;
					if (src?.includes("http") && !src.includes("icon") && !src.includes("logo") && !src.includes("ribbon") && (src.includes("product-images") || src.includes("siammakro.cloud"))) {
						images.add(src.split("?")[0]);
					}
				});
			}
			return { title, brand, pricePerUnit, code, discountPercent, specifications, images: Array.from(images), url: window.location.href };
		});
		return productDetail as ProductDetailRaw;
	} finally {
		releasePage(page);
	}
}

async function autoScroll(page: Page, targetHeight: number, intervalMs: number, distance: number): Promise<void> {
	await page.evaluate(async ({ targetHeight, intervalMs, distance }) => {
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
	}, { targetHeight, intervalMs, distance });
}
