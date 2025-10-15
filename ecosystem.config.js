module.exports = {
    apps: [
        {
            name: "makro-scraper-api",
            script: "./dist/server.js",
            instances: 1,
            exec_mode: "fork",
            watch: false,
            max_memory_restart: "1536M",
            env: {
                NODE_ENV: "production",
                ALLOWED_ORIGINS:
                    "http://localhost:3000,http://localhost:3001,https://uat.admin.neonmall.co,https://admin.neonmall.co,http://159.223.89.250:3000",
                HOST_URL: "0.0.0.0",
                PORT: "4000",
                NEONMALL_UAT_API_URL: "https://api.ecommerce.neon-xpress.com/v1/api",
                NEONMALL_PROD_API_URL: "https://api.production.ecommerce.neonmall.co/v1/api",
                NEONMALL_UAT_ADMIN_URL: "https://uat.admin.neonmall.co",
                NEONMALL_PROD_ADMIN_URL: "https://admin.neonmall.co",
                NODE_OPTIONS: "--max-old-space-size=2048",
                VERSION: "2.2.3"
            },
            error_file: "./logs/err.log",
            out_file: "./logs/out.log",
            log_date_format: "YYYY-MM-DD HH:mm:ss Z",
            merge_logs: true,
            autorestart: true,
            max_restarts: 10,
            min_uptime: "10s",
            listen_timeout: 10000,
            kill_timeout: 5000,
            wait_ready: false,
            shutdown_with_message: true,
            exp_backoff_restart_delay: 100
        }
    ]
};
