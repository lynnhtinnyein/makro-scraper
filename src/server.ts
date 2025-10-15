import express, { Request, Response, NextFunction } from "express";
import http from "http";
import cors from "cors";
import dotenv from "dotenv";
import cluster from "cluster";
import os from "os";
import { getPoolSize, closeAll } from "./lib/browser";
import { scrapeProductList, scrapeProductDetail } from "./services/scraper";
import { transformProductData } from "./lib/transform";
import { submitProduct, uploadProductImages } from "./services/submit";

dotenv.config();

const uatApiUrl = process.env.NEONMALL_UAT_API_URL;
const prodApiUrl = process.env.NEONMALL_PROD_API_URL;
const USE_CLUSTERING = process.env.USE_CLUSTERING === "true";
const numCPUs = os.cpus().length;
const WORKERS = Math.min(numCPUs, 6);

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
            methods: ["GET", "POST"],
            credentials: true
        })
    );

    app.use(express.json({ limit: "10mb" }));
    app.use(express.urlencoded({ extended: true, limit: "10mb" }));

    app.use((req: Request, res: Response, next: NextFunction) => {
        res.setHeader("X-Worker-PID", String(process.pid));
        next();
    });

    const asyncHandler = (
        fn: (req: Request, res: Response, next: NextFunction) => Promise<any>
    ) => {
        return (req: Request, res: Response, next: NextFunction) => {
            Promise.resolve(fn(req, res, next)).catch(next);
        };
    };

    app.get("/health", async (_req: Request, res: Response) => {
        res.status(200).json({
            message: "Makro Scraper API is running",
            status: "ok",
            poolSize: getPoolSize(),
            worker: process.pid,
            memory: {
                used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
                total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024)
            },
            endpoints: {
                searchProducts: "/api/products/search",
                scrapeProduct: "/api/products/scrape",
                submitSingle: "/api/products/submit-single",
                submitBatch: "/api/products/submit-batch"
            }
        });
    });

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

                const concurrency = 4;
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

                            return { success: true, url: productUrl };
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

    app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
        console.error("Error:", err);
        res.status(500).json({
            error: err.message || "Internal server error",
            path: req.path
        });
    });

    const server = http.createServer(app);
    const PORT = process.env.PORT || 4000;
    const hostUrl = process.env.HOST_URL || "0.0.0.0";
    const version = process.env.VERSION || "2.2.0";

    server.timeout = 180000;
    server.keepAliveTimeout = 75000;
    server.headersTimeout = 76000;

    server.listen(PORT as number, hostUrl as string, () => {
        console.log(`========================================`);
        console.log(`Makro Scraper API ${version} is running`);
        console.log(`Port: ${PORT}`);
        console.log(`Worker PID: ${process.pid}`);
        console.log(`========================================`);
    });

    let isShuttingDown = false;

    const gracefulShutdown = async (signal: string) => {
        if (isShuttingDown) return;
        isShuttingDown = true;

        console.log(`\n${signal} received. Shutting down gracefully...`);

        server.close(async () => {
            console.log("HTTP server closed");
            await closeAll();
            console.log("Browser pool closed");
            process.exit(0);
        });

        setTimeout(() => {
            console.error("Forced shutdown after timeout");
            process.exit(1);
        }, 30000);
    };

    process.on("SIGINT", () => gracefulShutdown("SIGINT"));
    process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));

    process.on("uncaughtException", (err) => {
        console.error("Uncaught Exception:", err);
    });

    process.on("unhandledRejection", (reason, promise) => {
        console.error("Unhandled Rejection at:", promise, "reason:", reason);
    });
}
