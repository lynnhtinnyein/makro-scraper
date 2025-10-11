import express, { Request, Response } from "express";
import http from "http";
import cors from "cors";
import dotenv from "dotenv";
import cluster from "cluster";
import os from "os";
import { getPoolSize, closeAll } from "./lib/browser";
import { scrapeProductList, scrapeProductDetail } from "./services/scraper";
import { transformProductData } from "./lib/transform";
import { submitProduct, uploadProductImages } from "./services/submit";
import { cleanUpUrl } from "./lib/utils";

const environment = process.env.NODE_ENV || "development";
const envFile = `.env.${environment}`;
dotenv.config({ path: envFile });

const uatApiUrl = process.env.NEONMALL_UAT_API_URL;
const prodApiUrl = process.env.NEONMALL_PROD_API_URL;
const USE_CLUSTERING = process.env.USE_CLUSTERING === "true";
const numCPUs = os.cpus().length;
const WORKERS = Math.min(numCPUs, 4);

export function getApiUrl(origin?: string): string {
    if (!uatApiUrl || !prodApiUrl) {
        throw new Error(
            "NEONMALL_UAT_API_URL and NEONMALL_PROD_API_URL must be set in environment variables"
        );
    }
    const hostname = origin ? new URL(origin).hostname : "";
    return hostname === "admin.neonmall.co" ? prodApiUrl : uatApiUrl;
}

if (USE_CLUSTERING && cluster.isPrimary) {
    console.log(`Master ${process.pid} is running`);
    console.log(`Forking ${WORKERS} workers...`);

    for (let i = 0; i < WORKERS; i++) {
        cluster.fork();
    }

    cluster.on("exit", (worker, code, signal) => {
        console.log(`Worker ${worker.process.pid} died. Restarting...`);
        cluster.fork();
    });
} else {
    const app = express();

    const allowedOrigins = process.env.ALLOWED_ORIGINS
        ? process.env.ALLOWED_ORIGINS.split(",")
        : ["*"];

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

    app.use(express.json({ limit: "10mb" }));
    app.use(express.urlencoded({ extended: true, limit: "10mb" }));

    app.get("/health", async (_req: Request, res: Response) => {
        res.status(200).json({
            message: "Makro Scraper API is running",
            status: "ok",
            poolSize: getPoolSize(),
            worker: process.pid,
            endpoints: {
                getProductList: "/api/products/list",
                getSingleProduct: "/api/products/single",
                submitProducts: "/api/products/submit"
            }
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

    app.post("/api/products/single", async (req: Request, res: Response) => {
        const { url } = req.body as { url?: string };

        if (!url) return res.status(400).json({ error: "URL parameter is required" });

        try {
            const product = await scrapeProductDetail(url);
            const singleProduct = {
                name: product.title,
                image: product.images[0] || null,
                originalPrice: product.originalPrice,
                discountedPrice:
                    product.discountedPrice === 0 ? product.originalPrice : product.discountedPrice,
                discountPercent: product.discountPercent,
                url: cleanUpUrl(product.url)
            };
            res.json(singleProduct);
        } catch (error: any) {
            console.error("Single product endpoint error:", error);
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
                    overwriteValues,
                    mainCategoryId,
                    subCategoryId,
                    categoryId,
                    sellerId,
                    productAttributeValueId
                } = group;

                if (!productUrls || !Array.isArray(productUrls)) {
                    continue;
                }

                const concurrency = 3;
                for (let i = 0; i < productUrls.length; i += concurrency) {
                    const batch = productUrls.slice(i, i + concurrency);
                    const results = await Promise.allSettled(
                        batch.map(async (productUrl: string) => {
                            try {
                                const detailRaw = await scrapeProductDetail(productUrl);
                                const transformedProduct = transformProductData(detailRaw);

                                const product = overwriteValues
                                    ? { ...transformedProduct, ...overwriteValues }
                                    : transformedProduct;

                                const productId = await submitProduct(
                                    token,
                                    product,
                                    { mainCategoryId, subCategoryId, categoryId, sellerId },
                                    productAttributeValueId,
                                    apiUrl
                                );

                                if (productId && product.images?.length > 0) {
                                    await uploadProductImages(
                                        token,
                                        productId,
                                        product.images,
                                        apiUrl
                                    );
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
                return res.status(400).json({
                    error: "All products failed to submit",
                    addedCount: 0,
                    errors
                });
            }

            const statusCode = errors.length > 0 ? 207 : 200;
            res.status(statusCode).json({
                addedCount,
                errors: errors.length > 0 ? errors : undefined
            });
        } catch (error: any) {
            console.error("Submit products error:", error);
            res.status(500).json({
                error: error.message || "Internal server error",
                addedCount,
                errors: errors.length > 0 ? errors : undefined
            });
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
    const version = process.env.VERSION || "1.0.0";

    server.timeout = 120000;
    server.keepAliveTimeout = 65000;
    server.headersTimeout = 66000;

    server.listen(PORT as number, hostUrl as string, () => {
        console.log(`========================================`);
        console.log(`Makro Scraper API ${version} is running`);
        console.log(`Port: ${PORT}`);
        console.log(`Worker PID: ${process.pid}`);
        console.log(`========================================`);
    });

    process.on("SIGINT", async () => {
        console.log("\nShutting down...");
        await closeAll();
        process.exit(0);
    });

    process.on("SIGTERM", async () => {
        console.log("\nSIGTERM received. Shutting down gracefully...");
        await closeAll();
        server.close(() => {
            console.log("Server closed");
            process.exit(0);
        });
    });
}
