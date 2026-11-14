#!/bin/bash
# ==============================================================================
# VPL - Server 3 (WebRTC Kamailio Edge Proxy + Media Asterisk) Automated Setup
# OS: Rocky Linux 9 / AlmaLinux 9 / RHEL 9 / CentOS Stream 9
# ==============================================================================

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${BLUE}======================================================${NC}"
echo -e "${BLUE} VPL SERVER 3 (WebRTC Edge Proxy) Automated Setup     ${NC}"
echo -e "${BLUE}======================================================${NC}"

if [ "$EUID" -ne 0 ]; then
  echo -e "${RED}[ERROR] Please run this script as root or with sudo!${NC}"
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Network Configuration Variables (Default: Local Private IP)
SERVER1_IP=${SERVER1_IP:-"192.168.88.119"} # Database & Portal
SERVER2_IP=${SERVER2_IP:-"192.168.88.51"}  # Core SIP Server
SERVER3_IP=${SERVER3_IP:-"192.168.88.47"}  # This Server (Kamailio WebRTC Edge)

DB_USER=${DB_USER:-"kamailio"}
DB_PASS=${DB_PASS:-"Kamailio@2026!Secure"}
DB_NAME=${DB_NAME:-"vpl_crm"}

echo -e "${YELLOW}Step 1: Installing Kamailio & Asterisk Dependencies...${NC}"
dnf install -y epel-release dnf-plugins-core
dnf config-manager --set-enabled crb 2>/dev/null || true
dnf update -y
dnf install -y git curl wget firewalld openssl tar

# Install Kamailio packages if not present
if ! command -v kamailio &> /dev/null; then
    echo -e "${YELLOW}Installing Kamailio packages...${NC}"
    dnf install -y kamailio kamailio-mysql kamailio-tls kamailio-websocket kamailio-json kamailio-utils 2>/dev/null || true
fi

# Install Asterisk for WebRTC media transcoding
if ! command -v asterisk &> /dev/null; then
    echo -e "${YELLOW}Installing Asterisk media server...${NC}"
    dnf install -y asterisk asterisk-pjsip 2>/dev/null || true
fi

echo -e "${YELLOW}Step 2: Generating SSL / TLS Certificates for WebSockets (WSS)...${NC}"
mkdir -p /etc/kamailio/certs
if [ ! -f /etc/kamailio/certs/kamailio.crt ]; then
    openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
        -keyout /etc/kamailio/certs/kamailio.key \
        -out /etc/kamailio/certs/kamailio.crt \
        -subj "/C=PK/ST=Punjab/L=Lahore/O=VPL/CN=${SERVER3_IP}"
    chmod 600 /etc/kamailio/certs/kamailio.key
    chown -R kamailio:kamailio /etc/kamailio/certs 2>/dev/null || true
    echo -e "${GREEN}[OK] TLS Certificates created in /etc/kamailio/certs/.${NC}"
fi

echo -e "${YELLOW}Step 3: Deploying Kamailio Configuration...${NC}"
mkdir -p /etc/kamailio

# Substitute IPs and DB credentials into kamailio.cfg
sed -e "s/192.168.88.47/${SERVER3_IP}/g" \
    -e "s/192.168.88.51/${SERVER2_IP}/g" \
    -e "s/192.168.88.119/${SERVER1_IP}/g" \
    -e "s/kamailio:Kamailio@2026\!Secure/${DB_USER}:${DB_PASS}/g" \
    -e "s/vpl_crm/${DB_NAME}/g" \
    "$SCRIPT_DIR/kamailio/kamailio.cfg" > /etc/kamailio/kamailio.cfg

cp "$SCRIPT_DIR/kamailio/tls.cfg" /etc/kamailio/tls.cfg

# Test Kamailio configuration syntax
if command -v kamailio &> /dev/null; then
    kamailio -c -f /etc/kamailio/kamailio.cfg || echo -e "${YELLOW}[WARNING] Check kamailio syntax.${NC}"
fi

echo -e "${YELLOW}Step 4: Deploying Local Asterisk Media Server Configuration...${NC}"
mkdir -p /etc/asterisk

sed -e "s/192.168.88.47/${SERVER3_IP}/g" \
    -e "s/192.168.88.51/${SERVER2_IP}/g" \
    -e "s/192.168.88.119/${SERVER1_IP}/g" \
    "$SCRIPT_DIR/asterisk/pjsip.conf" > /etc/asterisk/pjsip.conf

sed -e "s/192.168.88.47/${SERVER3_IP}/g" \
    -e "s/192.168.88.51/${SERVER2_IP}/g" \
    -e "s/192.168.88.119/${SERVER1_IP}/g" \
    "$SCRIPT_DIR/asterisk/extensions.conf" > /etc/asterisk/extensions.conf

echo -e "${YELLOW}Step 5: Enabling & Starting Kamailio and Asterisk Services...${NC}"
systemctl enable --now kamailio.service
systemctl restart kamailio.service

systemctl enable --now asterisk.service
systemctl restart asterisk.service

echo -e "${YELLOW}Step 6: Configuring Firewall Rules...${NC}"
if systemctl is-active --quiet firewalld; then
    firewall-cmd --permanent --add-port=5060/udp   # Kamailio SIP
    firewall-cmd --permanent --add-port=5060/tcp   # Kamailio SIP TCP
    firewall-cmd --permanent --add-port=8089/tcp   # Kamailio WebSockets TLS (WSS)
    firewall-cmd --permanent --add-port=5062/udp   # Asterisk Media SIP
    firewall-cmd --permanent --add-port=10000-20000/udp # RTP Audio Media
    firewall-cmd --reload
    echo -e "${GREEN}[OK] Firewall rules applied (5060 UDP/TCP, 8089 TCP, 5062 UDP, RTP 10000-20000).${NC}"
fi

echo -e "${GREEN}======================================================${NC}"
echo -e "${GREEN}   Server 3 (WebRTC Edge Proxy) Configured!           ${NC}"
echo -e "${GREEN}   WebRTC WSS Endpoint: wss://${SERVER3_IP}:8089/ws   ${NC}"
echo -e "${GREEN}======================================================${NC}"
