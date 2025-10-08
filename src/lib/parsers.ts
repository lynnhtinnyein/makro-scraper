import { Dimensions } from "../types";

export function extractDimensions(volumeText: string | undefined): Dimensions {
	const dimensions: Dimensions = { length: null, width: null, height: null, weight: null };
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

export function extractPrice(priceText: string | undefined): number | null {
	if (!priceText) return null;
	const match = priceText.match(/([\d,]+(?:\.[\d]+)?)/);
	return match ? parseFloat(match[1].replace(/,/g, "")) : null;
}

export function getOriginalPrice(discountedPrice: number | null, discountPercent: number | undefined): number | null {
	if (discountedPrice == null) return null;
	const discountRate = 1 - (discountPercent || 0) / 100;
	const originalPrice = discountedPrice / discountRate;
	return parseFloat(originalPrice.toFixed(2));
}

export function cleanProductName(name: string | null | undefined): string | null | undefined {
	return name ? name.replace(/\s*x\s*\d+\s*$/i, "").trim() : name;
}
