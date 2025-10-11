"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getApiUrl = getApiUrl;
const express_1 = __importDefault(require("express"));
const http_1 = __importDefault(require("http"));
const cors_1 = __importDefault(require("cors"));
const dotenv_1 = __importDefault(require("dotenv"));
const cluster_1 = __importDefault(require("cluster"));
const os_1 = __importDefault(require("os"));
const browser_1 = require("./lib/browser");
const scraper_1 = require("./services/scraper");
const transform_1 = require("./lib/transform");
const submit_1 = require("./services/submit");
const utils_1 = require("./lib/utils");
const environment = process.env.NODE_ENV || "development";
const envFile = `.env.${environment}`;
dotenv_1.default.config({ path: envFile });
const uatApiUrl = process.env.NEONMALL_UAT_API_URL;
const prodApiUrl = process.env.NEONMALL_PROD_API_URL;
const USE_CLUSTERING = process.env.USE_CLUSTERING === "true";
const numCPUs = os_1.default.cpus().length;
const WORKERS = Math.min(numCPUs, 4);
function getApiUrl(origin) {
    if (!uatApiUrl || !prodApiUrl) {
        throw new Error("NEONMALL_UAT_API_URL and NEONMALL_PROD_API_URL must be set in environment variables");
    }
    const hostname = origin ? new URL(origin).hostname : "";
    return hostname === "admin.neonmall.co" ? prodApiUrl : uatApiUrl;
}
if (USE_CLUSTERING && cluster_1.default.isPrimary) {
    console.log(`Master ${process.pid} is running`);
    console.log(`Forking ${WORKERS} workers...`);
    for (let i = 0; i < WORKERS; i++) {
        cluster_1.default.fork();
    }
    cluster_1.default.on("exit", (worker, code, signal) => {
        console.log(`Worker ${worker.process.pid} died. Restarting...`);
        cluster_1.default.fork();
    });
}
else {
    const app = (0, express_1.default)();
    const allowedOrigins = process.env.ALLOWED_ORIGINS
        ? process.env.ALLOWED_ORIGINS.split(",")
        : ["*"];
    app.use((0, cors_1.default)({
        origin: (origin, callback) => {
            if (!origin || allowedOrigins.includes("*") || allowedOrigins.includes(origin)) {
                callback(null, true);
            }
            else {
                callback(new Error("Not allowed by CORS"));
            }
        },
        methods: ["GET", "POST"]
    }));
    app.use(express_1.default.json({ limit: "10mb" }));
    app.use(express_1.default.urlencoded({ extended: true, limit: "10mb" }));
    app.get("/health", async (_req, res) => {
        res.status(200).json({
            message: "Makro Scraper API is running",
            status: "ok",
            poolSize: (0, browser_1.getPoolSize)(),
            worker: process.pid,
            endpoints: {
                getProductList: "/api/products/list",
                getSingleProduct: "/api/products/single",
                submitProducts: "/api/products/submit"
            }
        });
    });
    app.post("/api/products/list", async (req, res) => {
        const { url, max } = req.body;
        const maxProducts = Math.min(parseInt(String(max)) || 20, 20);
        if (!url)
            return res.status(400).json({ error: "URL parameter is required" });
        try {
            const products = await (0, scraper_1.scrapeProductList)(url, maxProducts);
            res.json(products);
        }
        catch (error) {
            console.error("Product list endpoint error:", error);
            res.status(500).json({ error: error.message });
        }
    });
    app.post("/api/products/single", async (req, res) => {
        const { url } = req.body;
        if (!url)
            return res.status(400).json({ error: "URL parameter is required" });
        try {
            const product = await (0, scraper_1.scrapeProductDetail)(url);
            const singleProduct = {
                name: product.title,
                image: product.images[0] || null,
                originalPrice: product.originalPrice,
                discountedPrice: product.discountedPrice === 0 ? product.originalPrice : product.discountedPrice,
                discountPercent: product.discountPercent,
                url: (0, utils_1.cleanUpUrl)(product.url)
            };
            res.json(singleProduct);
        }
        catch (error) {
            console.error("Single product endpoint error:", error);
            res.status(500).json({ error: error.message });
        }
    });
    app.post("/api/products/submit", async (req, res) => {
        const { token, productGroups } = req.body;
        if (!token || !productGroups || !Array.isArray(productGroups)) {
            return res.status(400).json({ error: "Token and productGroups are required" });
        }
        const origin = req.get("origin") || req.get("referer");
        const apiUrl = getApiUrl(origin);
        let addedCount = 0;
        const errors = [];
        try {
            for (const group of productGroups) {
                const { productUrls, overwriteValues, mainCategoryId, subCategoryId, categoryId, sellerId, productAttributeValueId } = group;
                if (!productUrls || !Array.isArray(productUrls)) {
                    continue;
                }
                const concurrency = 3;
                for (let i = 0; i < productUrls.length; i += concurrency) {
                    const batch = productUrls.slice(i, i + concurrency);
                    const results = await Promise.allSettled(batch.map(async (productUrl) => {
                        try {
                            const detailRaw = await (0, scraper_1.scrapeProductDetail)(productUrl);
                            const transformedProduct = (0, transform_1.transformProductData)(detailRaw);
                            const product = overwriteValues
                                ? { ...transformedProduct, ...overwriteValues }
                                : transformedProduct;
                            const productId = await (0, submit_1.submitProduct)(token, product, { mainCategoryId, subCategoryId, categoryId, sellerId }, productAttributeValueId, apiUrl);
                            if (productId && product.images?.length > 0) {
                                await (0, submit_1.uploadProductImages)(token, productId, product.images, apiUrl);
                            }
                            return { success: true, url: productUrl };
                        }
                        catch (err) {
                            throw new Error(err.message || "Failed to process product");
                        }
                    }));
                    results.forEach((result, idx) => {
                        if (result.status === "fulfilled" && result.value.success) {
                            addedCount++;
                        }
                        else {
                            const reason = result.status === "rejected"
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
        }
        catch (error) {
            console.error("Submit products error:", error);
            res.status(500).json({
                error: error.message || "Internal server error",
                addedCount,
                errors: errors.length > 0 ? errors : undefined
            });
        }
    });
    app.get("/close", async (_req, res) => {
        try {
            await (0, browser_1.closeAll)();
            res.json({ success: true, message: "Browser closed successfully" });
        }
        catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });
    const server = http_1.default.createServer(app);
    const PORT = process.env.PORT || 4000;
    const hostUrl = process.env.HOST_URL || "0.0.0.0";
    const version = process.env.VERSION || "1.0.0";
    server.timeout = 120000;
    server.keepAliveTimeout = 65000;
    server.headersTimeout = 66000;
    server.listen(PORT, hostUrl, () => {
        console.log(`========================================`);
        console.log(`Makro Scraper API ${version} is running`);
        console.log(`Port: ${PORT}`);
        console.log(`Worker PID: ${process.pid}`);
        console.log(`========================================`);
    });
    process.on("SIGINT", async () => {
        console.log("\nShutting down...");
        await (0, browser_1.closeAll)();
        process.exit(0);
    });
    process.on("SIGTERM", async () => {
        console.log("\nSIGTERM received. Shutting down gracefully...");
        await (0, browser_1.closeAll)();
        server.close(() => {
            console.log("Server closed");
            process.exit(0);
        });
    });
}
