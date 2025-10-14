import { Dimensions, ProductDetailRaw } from "../types";

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

//not in used
export function extractPricePerUnit(priceText: string | undefined): number | null {
    if (!priceText) return null;
    const match = priceText.match(/([\d,]+(?:\.[\d]+)?)/);
    return match ? parseFloat(match[1].replace(/,/g, "")) : null;
}

//not in used
// remove quantity suffix like " x 4"
export function parseToSingleProductName(
    name: string | null | undefined
): string | null | undefined {
    return name ? name.replace(/\s*x\s*\d+\s*$/i, "").trim() : name;
}

export function getPrefixedSku(details: ProductDetailRaw): string | null {
    const code = details?.code || details?.specifications?.["SKU"] || null;
    return code ? `MK${code}` : null;
}
