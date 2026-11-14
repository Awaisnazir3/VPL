#!/bin/bash
# ==============================================================================
# VPL - Server 2 (Core SIP Asterisk Switch) Automated Setup Script
# OS: Rocky Linux 9 / AlmaLinux 9 / RHEL 9 / CentOS Stream 9
# ==============================================================================

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${BLUE}======================================================${NC}"
echo -e "${BLUE}     VPL SERVER 2 (Core SIP) Automated Setup          ${NC}"
echo -e "${BLUE}======================================================${NC}"

if [ "$EUID" -ne 0 ]; then
  echo -e "${RED}[ERROR] Please run this script as root or with sudo!${NC}"
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Network Configuration Variables (Default: Local Private IP)
SERVER1_IP=${SERVER1_IP:-"192.168.88.119"} # Database & Portal
SERVER2_IP=${SERVER2_IP:-"192.168.88.51"}  # This Server (Core SIP)
SERVER3_IP=${SERVER3_IP:-"192.168.88.47"}  # Kamailio WebRTC Edge
OUTBOUND_TRUNK_IP=${OUTBOUND_TRUNK_IP:-"192.168.88.88"}

DB_USER=${DB_USER:-"kamailio"}
DB_PASS=${DB_PASS:-"Kamailio@2026!Secure"}
DB_NAME=${DB_NAME:-"vpl_crm"}

echo -e "${YELLOW}Step 1: Installing Asterisk & PHP Dependencies...${NC}"
dnf install -y epel-release dnf-plugins-core
dnf config-manager --set-enabled crb 2>/dev/null || true
dnf update -y
dnf install -y git curl wget firewalld php-cli php-mysqlnd php-pdo php-mbstring

# Install Asterisk (if not already installed)
if ! command -v asterisk &> /dev/null; then
    echo -e "${YELLOW}Installing Asterisk packages...${NC}"
    # Check if asterisk package exists in repos
    if dnf info asterisk &> /dev/null; then
        dnf install -y asterisk asterisk-pjsip asterisk-sounds-core-en-ulaw
    else
        echo -e "${YELLOW}Adding Asterisk repository...${NC}"
        # For EL9, if Asterisk is pre-compiled or custom, check local setup
        echo -e "${YELLOW}Asterisk will be installed via official / EPEL repository.${NC}"
        dnf install -y asterisk || true
    fi
fi

echo -e "${YELLOW}Step 2: Backing up existing Asterisk configurations...${NC}"
mkdir -p /etc/asterisk/backup_$(date +%Y%m%d%H%M%S)
cp -r /etc/asterisk/*.conf /etc/asterisk/backup_$(date +%Y%m%d%H%M%S)/ 2>/dev/null || true

echo -e "${YELLOW}Step 3: Deploying Core Asterisk Configurations...${NC}"
mkdir -p /etc/asterisk

# Copy configs and dynamically substitute IPs
sed -e "s/192.168.88.47/${SERVER3_IP}/g" \
    -e "s/192.168.88.51/${SERVER2_IP}/g" \
    -e "s/192.168.88.88/${OUTBOUND_TRUNK_IP}/g" \
    "$SCRIPT_DIR/asterisk/pjsip.conf" > /etc/asterisk/pjsip.conf

sed -e "s/192.168.88.47/${SERVER3_IP}/g" \
    -e "s/192.168.88.51/${SERVER2_IP}/g" \
    "$SCRIPT_DIR/asterisk/extensions.conf" > /etc/asterisk/extensions.conf

cp "$SCRIPT_DIR/asterisk/rtp.conf" /etc/asterisk/rtp.conf 2>/dev/null || true
cp "$SCRIPT_DIR/asterisk/modules.conf" /etc/asterisk/modules.conf 2>/dev/null || true

echo -e "${YELLOW}Step 4: Deploying AGI Telephony Scripts...${NC}"
mkdir -p /var/lib/asterisk/agi-bin

# Deploy did_call_router.php with dynamic IPs & credentials
sed -e "s/192.168.88.119/${SERVER1_IP}/g" \
    -e "s/192.168.88.47/${SERVER3_IP}/g" \
    -e "s/192.168.88.51/${SERVER2_IP}/g" \
    -e "s/'username' => 'kamailio'/'username' => '${DB_USER}'/g" \
    -e "s/'password' => 'Kamailio@2026!Secure'/'password' => '${DB_PASS}'/g" \
    -e "s/'dbname'   => 'vpl_crm'/'dbname'   => '${DB_NAME}'/g" \
    "$SCRIPT_DIR/agi-bin/did_call_router.php" > /var/lib/asterisk/agi-bin/did_call_router.php

# Deploy outbound_call_router.php with dynamic IPs & credentials
sed -e "s/192.168.88.119/${SERVER1_IP}/g" \
    -e "s/192.168.88.51/${SERVER2_IP}/g" \
    -e "s/'username' => 'kamailio'/'username' => '${DB_USER}'/g" \
    -e "s/'password' => 'Kamailio@2026!Secure'/'password' => '${DB_PASS}'/g" \
    -e "s/'dbname'   => 'vpl_crm'/'dbname'   => '${DB_NAME}'/g" \
    "$SCRIPT_DIR/agi-bin/outbound_call_router.php" > /var/lib/asterisk/agi-bin/outbound_call_router.php

chmod +x /var/lib/asterisk/agi-bin/*.php
chown -R asterisk:asterisk /var/lib/asterisk/agi-bin /etc/asterisk 2>/dev/null || true

echo -e "${YELLOW}Step 5: Enabling & Starting Asterisk Service...${NC}"
systemctl enable --now asterisk.service
asterisk -rx "core reload" 2>/dev/null || true

echo -e "${YELLOW}Step 6: Configuring Firewall...${NC}"
if systemctl is-active --quiet firewalld; then
    firewall-cmd --permanent --add-port=5060/udp
    firewall-cmd --permanent --add-port=10000-20000/udp
    firewall-cmd --reload
    echo -e "${GREEN}[OK] Firewall rules applied (SIP 5060 UDP, RTP 10000-20000 UDP).${NC}"
fi

echo -e "${GREEN}======================================================${NC}"
echo -e "${GREEN}   Server 2 (Core SIP) Configured Successfully!       ${NC}"
echo -e "${GREEN}======================================================${NC}"
