#!/bin/bash
# ==============================================================================
# VPL - Server 1 (Web Portal & MySQL Database) Automated Setup Script
# OS: Rocky Linux 9 / AlmaLinux 9 / RHEL 9 / CentOS Stream 9
# ==============================================================================

set -e

# Color definitions
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${BLUE}======================================================${NC}"
echo -e "${BLUE}   VPL SERVER 1 (Web Portal + DB) Automated Setup     ${NC}"
echo -e "${BLUE}======================================================${NC}"

# Check root privileges
if [ "$EUID" -ne 0 ]; then
  echo -e "${RED}[ERROR] Please run this script as root or with sudo!${NC}"
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Configuration Variables (Default: Local Private IP)
SERVER1_IP=${SERVER1_IP:-"192.168.88.119"}
SERVER2_IP=${SERVER2_IP:-"192.168.88.51"}
SERVER3_IP=${SERVER3_IP:-"192.168.88.47"}

DB_ROOT_PASS=${DB_ROOT_PASS:-"Vpl_CRM@2026!Secure"}
DB_NAME=${DB_NAME:-"vpl_crm"}
DB_USER=${DB_USER:-"vpl_user"}
DB_PASS=${DB_PASS:-"Vpl_CRM@2026!Secure"}

KAMAILIO_DB_USER=${KAMAILIO_DB_USER:-"kamailio"}
KAMAILIO_DB_PASS=${KAMAILIO_DB_PASS:-"Kamailio@2026!Secure"}

PORTAL_DIR="/var/www/vpl_portal"

echo -e "${YELLOW}Step 1: Installing System Dependencies & Repositories...${NC}"
dnf install -y epel-release dnf-plugins-core
dnf config-manager --set-enabled crb 2>/dev/null || true
dnf update -y
dnf install -y nginx mysql-server git curl wget tar openssl firewalld policycoreutils-python-utils

# Install Node.js 20.x
if ! command -v node &> /dev/null; then
    echo -e "${YELLOW}Installing Node.js 20.x LTS...${NC}"
    curl -fsSL https://rpm.nodesource.com/setup_20.x | bash -
    dnf install -y nodejs
fi

echo -e "${GREEN}[OK] Node.js $(node -v) and npm $(npm -v) installed.${NC}"

echo -e "${YELLOW}Step 2: Configuring MySQL Database Server...${NC}"
systemctl enable --now mysqld

# Create Database and Users
mysql -u root <<EOF
CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Portal local user
CREATE USER IF NOT EXISTS '${DB_USER}'@'localhost' IDENTIFIED BY '${DB_PASS}';
CREATE USER IF NOT EXISTS '${DB_USER}'@'127.0.0.1' IDENTIFIED BY '${DB_PASS}';
GRANT ALL PRIVILEGES ON \`${DB_NAME}\`.* TO '${DB_USER}'@'localhost';
GRANT ALL PRIVILEGES ON \`${DB_NAME}\`.* TO '${DB_USER}'@'127.0.0.1';

-- Remote Kamailio / Core SIP access
CREATE USER IF NOT EXISTS '${KAMAILIO_DB_USER}'@'%' IDENTIFIED BY '${KAMAILIO_DB_PASS}';
GRANT ALL PRIVILEGES ON \`${DB_NAME}\`.* TO '${KAMAILIO_DB_USER}'@'%';

FLUSH PRIVILEGES;
EOF

echo -e "${YELLOW}Importing Database Schema & Seed Data...${NC}"
if [ -f "$SCRIPT_DIR/database/schema.sql" ]; then
    mysql -u root "${DB_NAME}" < "$SCRIPT_DIR/database/schema.sql"
    echo -e "${GREEN}[OK] Database schema imported.${NC}"
fi

if [ -f "$SCRIPT_DIR/database/seed_data.sql" ]; then
    mysql -u root "${DB_NAME}" < "$SCRIPT_DIR/database/seed_data.sql" 2>/dev/null || true
    echo -e "${GREEN}[OK] Seed data imported.${NC}"
fi

# Ensure Kamailio subscriber VIEW matches SERVER3_IP
mysql -u root "${DB_NAME}" <<EOF
DROP VIEW IF EXISTS subscriber;
CREATE VIEW subscriber AS 
SELECT 
    s.id AS id,
    CAST(s.order_id AS CHAR(64) CHARSET utf8mb4) AS username,
    '${SERVER3_IP}' AS domain,
    s.sip_password AS password,
    u.email AS email_address,
    MD5(CONCAT(s.order_id, ':${SERVER3_IP}:', s.sip_password)) AS ha1,
    MD5(CONCAT(s.order_id, '@${SERVER3_IP}:${SERVER3_IP}:', s.sip_password)) AS ha1b,
    NULL AS rpid 
FROM sip_accounts s 
JOIN users u ON (s.user_id = u.id) 
WHERE (s.status = 'active');
EOF
echo -e "${GREEN}[OK] Kamailio subscriber view configured for domain ${SERVER3_IP}.${NC}"

echo -e "${YELLOW}Step 3: Deploying Web Portal Files...${NC}"
mkdir -p "${PORTAL_DIR}"
cp -rf "$SCRIPT_DIR/backend" "${PORTAL_DIR}/"
cp -rf "$SCRIPT_DIR/public" "${PORTAL_DIR}/"

# Configure Backend .env
cat <<EOF > "${PORTAL_DIR}/backend/.env"
PORT=3000
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=${DB_USER}
DB_PASS=${DB_PASS}
DB_NAME=${DB_NAME}
JWT_SECRET=vpl_super_secret_jwt_key_$(openssl rand -hex 12)
CIPHER_KEY=vpl_crm_voip_encryption_key_2026
ASTERISK_HOST=${SERVER3_IP}
ASTERISK_SSH_USER=root
ASTERISK_WSS_URL=wss://${SERVER3_IP}:8089/ws
EOF

echo -e "${YELLOW}Installing Backend Node.js Modules...${NC}"
cd "${PORTAL_DIR}/backend"
npm install --production

# Set proper ownership
chown -R root:root "${PORTAL_DIR}"
chmod -R 755 "${PORTAL_DIR}"

echo -e "${YELLOW}Step 4: Setting up Systemd Service (vpl-portal)...${NC}"
cp "$SCRIPT_DIR/vpl-portal.service" /etc/systemd/system/vpl-portal.service
systemctl daemon-reload
systemctl enable --now vpl-portal.service

echo -e "${YELLOW}Step 5: Configuring Nginx & SSL Certificate...${NC}"
mkdir -p /etc/pki/nginx /etc/pki/nginx/private

# Generate self-signed certificate if none exists
if [ ! -f /etc/pki/nginx/server.crt ]; then
    echo -e "${YELLOW}Generating self-signed SSL certificate for Nginx...${NC}"
    openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
        -keyout /etc/pki/nginx/private/server.key \
        -out /etc/pki/nginx/server.crt \
        -subj "/C=PK/ST=Punjab/L=Lahore/O=VPL/CN=${SERVER1_IP}"
    chmod 600 /etc/pki/nginx/private/server.key
fi

# Copy Nginx configuration and replace WebRTC IP with SERVER3_IP
sed "s/192.168.88.47/${SERVER3_IP}/g" "$SCRIPT_DIR/nginx/vpl_portal.conf" > /etc/nginx/conf.d/vpl_portal.conf

nginx -t
systemctl enable --now nginx
systemctl reload nginx

echo -e "${YELLOW}Step 6: Configuring Firewall (firewalld)...${NC}"
if systemctl is-active --quiet firewalld; then
    firewall-cmd --permanent --add-service=http
    firewall-cmd --permanent --add-service=https
    firewall-cmd --permanent --add-port=3306/tcp
    firewall-cmd --reload
    echo -e "${GREEN}[OK] Firewall rules applied (HTTP, HTTPS, MySQL).${NC}"
fi

# SELinux settings for Nginx reverse proxy
if command -v getenforce &> /dev/null && [ "$(getenforce)" != "Disabled" ]; then
    setsebool -P httpd_can_network_connect 1 2>/dev/null || true
fi

echo -e "${GREEN}======================================================${NC}"
echo -e "${GREEN}   Server 1 Configuration Completed Successfully!     ${NC}"
echo -e "${GREEN}   Access Web Portal: http://${SERVER1_IP} or https://${SERVER1_IP} ${NC}"
echo -e "${GREEN}======================================================${NC}"
