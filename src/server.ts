import express, { NextFunction, Request, Response } from "express";
import http from "http";
import cors from "cors";
import dotenv from "dotenv";
import { getPoolSize, closeAll } from "./lib/browser";
import { scrapeProductList, scrapeProductDetail } from "./services/scraper";
import { transformProductData } from "./lib/transform";
import { submitProduct, uploadProductImages } from "./services/submit";

dotenv.config();

const uatApiUrl = process.env.NEONMALL_UAT_API_URL;
const prodApiUrl = process.env.NEONMALL_PROD_API_URL;

export function getApiUrl(origin?: string): string {
    if (!uatApiUrl || !prodApiUrl) {
        throw new Error(
            "NEONMALL_UAT_API_URL and NEONMALL_PROD_API_URL must be set in environment variables"
        );
    }
    const hostname = origin ? new URL(origin).hostname : "";
    return hostname === "admin.neonmall.co" ? prodApiUrl : uatApiUrl;
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

const asyncHandler = (fn: (req: Request, res: Response, next: NextFunction) => Promise<any>) => {
    return (req: Request, res: Response, next: NextFunction) => {
        Promise.resolve(fn(req, res, next)).catch(next);
    };
};

app.get(
    "/health",
    asyncHandler(async (_req: Request, res: Response) => {
        res.status(200).json({
            message: "Makro Scraper API is running",
            status: "ok",
            poolSize: getPoolSize(),
            endpoints: {
                getProductList: "/api/products/list",
                getSingleProduct: "/api/products/single",
                submitProducts: "/api/products/submit"
            }
        });
    })
);

app.post(
    "/api/products/search",
    asyncHandler(async (req: Request, res: Response) => {
        const { url, max } = req.body as { url?: string; max?: string | number };
        const maxProducts = Math.min(parseInt(String(max)) || 20, 20);
        if (!url) {
            res.status(400).json({ error: "URL parameter is required" });
            return;
        }
        const products = await scrapeProductList(url, maxProducts);
        res.json(products);
    })
);

app.post(
    "/api/products/scrape",
    asyncHandler(async (req: Request, res: Response) => {
        const { url } = req.body as { url?: string };

        if (!url) {
            res.status(400).json({ error: "URL parameter is required" });
            return;
        }

        const detailRaw = await scrapeProductDetail(url);
        const transformedProduct = transformProductData(detailRaw);
        res.json(transformedProduct);
    })
);

app.post(
    "/api/products/submit-single",
    asyncHandler(async (req: Request, res: Response) => {
        const {
            token,
            product,
            mainCategoryId,
            subCategoryId,
            categoryId,
            sellerId,
            productAttributeValueId
        } = req.body as any;

        if (!token || !product) {
            res.status(400).json({ error: "Token and product data are required" });
            return;
        }

        const origin = req.get("origin") || req.get("referer");
        const apiUrl = getApiUrl(origin);

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

        res.json({ success: true, productId });
    })
);

app.post(
    "/api/products/submit-batch",
    asyncHandler(async (req: Request, res: Response) => {
        const { token, productGroups } = req.body as any;
        if (!token || !productGroups || !Array.isArray(productGroups)) {
            res.status(400).json({ error: "Token and productGroups are required" });
            return;
        }

        const origin = req.get("origin") || req.get("referer");
        const apiUrl = getApiUrl(origin);

        let addedCount = 0;
        const errors: Array<{ url: string; error: string }> = [];

        for (const group of productGroups) {
            const {
                productUrls,
                mainCategoryId,
                subCategoryId,
                categoryId,
                sellerId,
                productAttributeValueId
            } = group;

            if (!productUrls || !Array.isArray(productUrls)) {
                continue;
            }

            const concurrency = 2;
            for (let i = 0; i < productUrls.length; i += concurrency) {
                const batch = productUrls.slice(i, i + concurrency);
                const results = await Promise.allSettled(
                    batch.map(async (productUrl: string) => {
                        try {
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
                            return { success: true, url: productUrl };
                        } catch (err: any) {
                            throw new Error(err.message || "Failed to process product");
                        }
                    })
                );

                results.forEach((result, idx) => {
                    if (result.status === "fulfilled" && result.value.success) {
                        addedCount++;
                    } else {
                        const reason =
                            result.status === "rejected"
                                ? result.reason
                                : new Error("Unknown error");
                        errors.push({
                            url: batch[idx],
                            error: reason?.message || "Unknown error"
                        });
                    }
                });
            }
        }

        if (errors.length > 0 && addedCount === 0) {
            res.status(400).json({
                error: "All products failed to submit",
                addedCount: 0,
                errors
            });
            return;
        }

        const statusCode = errors.length > 0 ? 207 : 200;
        res.status(statusCode).json({
            addedCount,
            errors: errors.length > 0 ? errors : undefined
        });
    })
);

app.get(
    "/close",
    asyncHandler(async (_req: Request, res: Response) => {
        await closeAll();
        res.json({ success: true, message: "Browser closed successfully" });
    })
);

const server = http.createServer(app);
const PORT = process.env.PORT || 4000;
const hostUrl = process.env.HOST_URL || "0.0.0.0";
const version = process.env.VERSION || "1.0.0";

server.listen(PORT as number, hostUrl as string, () => {
    console.log(`========================================`);
    console.log(`Makro Scraper API ${version} is running`);
    console.log(`Port: ${PORT}`);
    console.log(`========================================`);
});

process.on("SIGINT", async () => {
    console.log("\nShutting down...");
    await closeAll();
    process.exit(0);
});
