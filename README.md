# Makro Scraper API - Deployment Setup

```bash
# Update system
sudo apt-get update && sudo apt-get upgrade -y

# Install Node.js 18
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install Chromium for Puppeteer
sudo apt-get install -y chromium-browser

# Install PM2
sudo npm install -g pm2
```

## Deploy Application

```bash
# Clone and setup
cd /var/www
git clone <your-repo-url> makro-scraper
cd makro-scraper

# Install and build
npm ci --only=production
npm run build
```

## Configure Environment

Create `.env.production`:

```env
NODE_ENV=production
ALLOWED_ORIGINS=https://uat.admin.neonmall.co,https://admin.neonmall.co
HOST_URL=0.0.0.0
PORT=4000

NEONMALL_UAT_API_URL=https://api.ecommerce.neon-xpress.com/v1/api
NEONMALL_PROD_API_URL=https://api.production.ecommerce.neonmall.co/v1/api

NEONMALL_UAT_ADMIN_URL=https://uat.admin.neonmall.co
NEONMALL_PROD_ADMIN_URL=https://admin.neonmall.co
```

## Start Application

```bash
# Start with PM2
pm2 start dist/server.js --name makro-scraper-api --env production
pm2 save
pm2 startup systemd  # Run the command it outputs

# Configure firewall
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
```

## Setup Nginx (Optional)

```bash
# Install
sudo apt-get install -y nginx

# Create config at /etc/nginx/sites-available/makro-scraper
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://localhost:4000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_connect_timeout 300;
        proxy_read_timeout 300;
    }
}

# Enable
sudo ln -s /etc/nginx/sites-available/makro-scraper /etc/nginx/sites-enabled/
sudo rm /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl restart nginx

# SSL (optional)
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com
```

## Essential Commands

```bash
# View logs
pm2 logs makro-scraper-api

# Restart
pm2 restart makro-scraper-api

# Health check
curl http://localhost:4000/health

# Update
cd /var/www/makro-scraper
git pull
npm ci --only=production
npm run build
pm2 restart makro-scraper-api
```

## Requirements

-   Ubuntu 22.04 LTS droplet
-   Minimum 2GB RAM, 1 vCPU
