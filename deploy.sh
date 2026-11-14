#!/bin/bash
# ==============================================================================
# VPL - Multi-Server Git Deployment & Service Reloader
# ==============================================================================

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${BLUE}======================================================${NC}"
echo -e "${BLUE}          VPL Git Pull & Service Deployment           ${NC}"
echo -e "${BLUE}======================================================${NC}"

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_DIR"

echo -e "${YELLOW}Pulling latest changes from GitHub...${NC}"
git pull origin main

# Detect which server this machine is running
HOSTNAME=$(hostname)
IP_LIST=$(hostname -I 2>/dev/null || ip addr show | grep 'inet ' | awk '{print $2}' | cut -d/ -f1)

echo "Detected Hostname: $HOSTNAME"
echo "Detected IPs: $IP_LIST"

if [[ "$IP_LIST" == *"192.168.88.119"* ]] || [[ "$HOSTNAME" == *"Web-Portal"* ]]; then
    echo -e "${GREEN}Detected: Server 1 (Web Portal & Database)${NC}"
    echo -e "${YELLOW}Syncing portal files to /var/www/vpl_portal...${NC}"
    cp -rf "$REPO_DIR/server1-web-portal-db/backend"/* /var/www/vpl_portal/backend/
    cp -rf "$REPO_DIR/server1-web-portal-db/public"/* /var/www/vpl_portal/public/
    
    cd /var/www/vpl_portal/backend
    npm install --production
    
    echo -e "${YELLOW}Restarting vpl-portal.service and reloading nginx...${NC}"
    systemctl restart vpl-portal.service
    nginx -t && systemctl reload nginx
    echo -e "${GREEN}[OK] Server 1 successfully updated!${NC}"

elif [[ "$IP_LIST" == *"192.168.88.51"* ]] || [[ "$HOSTNAME" == *"CORE-SIP"* ]]; then
    echo -e "${GREEN}Detected: Server 2 (Core SIP Asterisk)${NC}"
    echo -e "${YELLOW}Syncing Asterisk & AGI scripts...${NC}"
    cp -f "$REPO_DIR/server2-core-sip/asterisk"/*.conf /etc/asterisk/
    cp -f "$REPO_DIR/server2-core-sip/agi-bin"/*.php /var/lib/asterisk/agi-bin/
    chmod +x /var/lib/asterisk/agi-bin/*.php
    
    echo -e "${YELLOW}Reloading Asterisk Dialplan & PJSIP...${NC}"
    asterisk -rx "dialplan reload"
    asterisk -rx "pjsip reload"
    echo -e "${GREEN}[OK] Server 2 successfully updated!${NC}"

elif [[ "$IP_LIST" == *"192.168.88.47"* ]] || [[ "$HOSTNAME" == *"webRTC-Kamailio"* ]] || [[ "$HOSTNAME" == *"Kamailio"* ]]; then
    echo -e "${GREEN}Detected: Server 3 (WebRTC Kamailio Edge Proxy)${NC}"
    echo -e "${YELLOW}Syncing Kamailio & Media Asterisk...${NC}"
    cp -f "$REPO_DIR/server3-webrtc-kamailio/kamailio"/kamailio.cfg /etc/kamailio/
    cp -f "$REPO_DIR/server3-webrtc-kamailio/kamailio"/tls.cfg /etc/kamailio/
    cp -f "$REPO_DIR/server3-webrtc-kamailio/asterisk"/*.conf /etc/asterisk/
    
    echo -e "${YELLOW}Validating and restarting Kamailio & Asterisk...${NC}"
    kamailio -c -f /etc/kamailio/kamailio.cfg
    systemctl restart kamailio.service
    asterisk -rx "core reload" 2>/dev/null || systemctl restart asterisk.service
    echo -e "${GREEN}[OK] Server 3 successfully updated!${NC}"

else
    echo -e "${YELLOW}Unknown host or local machine.${NC}"
    echo "To deploy manually to a specific server, run its setup.sh script."
fi
