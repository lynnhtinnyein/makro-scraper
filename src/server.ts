import express, { Request, Response } from "express";
import http from "http";
import cors from "cors";
import dotenv from "dotenv";
import { getPoolSize, closeAll } from "./lib/browser";
import { scrapeProductList, scrapeProductDetail } from "./services/scraper";
import { transformProductData } from "./lib/transform";
import { submitProduct, uploadProductImages } from "./services/submit";

const environment = process.env.NODE_ENV || "development";
const envFile = `.env.${environment}`;
dotenv.config({ path: envFile });

const uatApiUrl = process.env.NEONMALL_UAT_API_URL;
const prodApiUrl = process.env.NEONMALL_PROD_API_URL;

export function getApiUrl(origin?: string): string {
    if (!uatApiUrl || !prodApiUrl) {
        throw new Error(
            "NEONMALL_UAT_API_URL and NEONMALL_PROD_API_URL must be set in environment variables"
        );
    }
    return origin && origin.includes("admin.neonmall.co") ? prodApiUrl : uatApiUrl;
}

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

app.get("/health", async (_req: Request, res: Response) => {
    res.status(200).json({
        message: "Makro Scraper API is running",
        status: "ok",
        poolSize: getPoolSize(),
        endpoints: { getProductList: "/api/products/list", submitProducts: "/api/products/submit" }
    });
});

app.post("/api/products/list", async (req: Request, res: Response) => {
    const { url, max } = req.body as { url?: string; max?: string | number };
    const maxProducts = Math.min(parseInt(String(max)) || 20, 20);
    if (!url) return res.status(400).json({ error: "URL parameter is required" });
    try {
        const products = await scrapeProductList(url, maxProducts);
        res.json(products);
    } catch (error: any) {
        console.error("Product list endpoint error:", error);
        res.status(500).json({ error: error.message });
    }
});

app.post("/api/products/submit", async (req: Request, res: Response) => {
    const { token, productGroups } = req.body as any;
    if (!token || !productGroups || !Array.isArray(productGroups)) {
        return res.status(400).json({ error: "Token and productGroups are required" });
    }

    const origin = req.get("origin") || req.get("referer");
    const apiUrl = getApiUrl(origin);

    let addedCount = 0;
    const errors: Array<{ url: string; error: string }> = [];
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
                    batch.map(async (productUrl: string) => {
                        const detailRaw = await scrapeProductDetail(productUrl);
                        const product = transformProductData(detailRaw);
                        const productId = await submitProduct(
                            token,
                            product,
                            { mainCategoryId, subCategoryId, categoryId, sellerId },
                            productAttributeValueId,
                            apiUrl
                        );
                        if (productId && product.images?.length > 0) {
                            await uploadProductImages(token, productId, product.images, apiUrl);
                        }
                        return { success: true };
                    })
                );
                results.forEach((result, idx) => {
                    if (
                        (result as PromiseFulfilledResult<any>).status === "fulfilled" &&
                        (result as PromiseFulfilledResult<any>).value.success
                    ) {
                        addedCount++;
                    } else {
                        errors.push({
                            url: batch[idx],
                            error: (result as any).reason?.message || "Unknown error"
                        });
                    }
                });
            }
        }
        res.status(200).json({ addedCount, errors: errors.length > 0 ? errors : undefined });
    } catch (error: any) {
        console.error("Submit products error:", error);
        res.status(500).json({ error: error.message, addedCount });
    }
});

app.get("/close", async (_req: Request, res: Response) => {
    try {
        await closeAll();
        res.json({ success: true, message: "Browser closed successfully" });
    } catch (error: any) {
        res.status(500).json({ success: false, error: error.message });
    }
});

const server = http.createServer(app);
const PORT = process.env.PORT || 4000;
const hostUrl = process.env.HOST_URL || "0.0.0.0";

server.listen(PORT as number, hostUrl as string, () => {
    console.log(`========================================`);
    console.log(`Makro Scraper API is running`);
    console.log(`Port: ${PORT}`);
    console.log(`========================================`);
});

process.on("SIGINT", async () => {
    console.log("\nShutting down...");
    await closeAll();
    process.exit(0);
});
