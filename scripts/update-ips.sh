#!/bin/bash
# ==============================================================================
# VPL - Multi-Server IP & Domain Switcher (Local <-> Production)
# ==============================================================================

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${BLUE}======================================================${NC}"
echo -e "${BLUE}        VPL Multi-Server IP & Domain Switcher         ${NC}"
echo -e "${BLUE}======================================================${NC}"

# Current Defaults (Local Private IPs)
OLD_S1=${OLD_S1:-"192.168.88.119"}
OLD_S2=${OLD_S2:-"192.168.88.51"}
OLD_S3=${OLD_S3:-"192.168.88.47"}

# Targets
NEW_S1=""
NEW_S2=""
NEW_S3=""

while [[ "$#" -gt 0 ]]; do
    case $1 in
        --server1) NEW_S1="$2"; shift ;;
        --server2) NEW_S2="$2"; shift ;;
        --server3) NEW_S3="$2"; shift ;;
        -h|--help)
            echo "Usage: ./update-ips.sh --server1 <IP/domain> --server2 <IP/domain> --server3 <IP/domain>"
            echo "Example for Production:"
            echo "  ./update-ips.sh --server1 portal.yourdomain.com --server2 sip.yourdomain.com --server3 webrtc.yourdomain.com"
            exit 0
            ;;
        *) echo "Unknown parameter: $1"; exit 1 ;;
    esac
    shift
done

if [ -z "$NEW_S1" ] || [ -z "$NEW_S2" ] || [ -z "$NEW_S3" ]; then
    echo -e "${YELLOW}Interactive Mode:${NC}"
    read -p "Enter Server 1 (Web Portal + DB) IP or Domain [Current: $OLD_S1]: " input_s1
    NEW_S1=${input_s1:-$OLD_S1}
    
    read -p "Enter Server 2 (Core SIP PBX) IP or Domain [Current: $OLD_S2]: " input_s2
    NEW_S2=${input_s2:-$OLD_S2}
    
    read -p "Enter Server 3 (WebRTC Kamailio Edge) IP or Domain [Current: $OLD_S3]: " input_s3
    NEW_S3=${input_s3:-$OLD_S3}
fi

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo -e "${YELLOW}Replacing IPs across configs in $ROOT_DIR...${NC}"
echo "Server 1: $OLD_S1 -> $NEW_S1"
echo "Server 2: $OLD_S2 -> $NEW_S2"
echo "Server 3: $OLD_S3 -> $NEW_S3"

# 1. Update Server 1 Nginx and Backend
find "$ROOT_DIR/server1-web-portal-db" -type f \( -name "*.conf" -o -name ".env*" -o -name "*.js" \) -exec sed -i \
    -e "s/$OLD_S1/$NEW_S1/g" \
    -e "s/$OLD_S2/$NEW_S2/g" \
    -e "s/$OLD_S3/$NEW_S3/g" {} +

# 2. Update Server 2 Asterisk and AGI scripts
find "$ROOT_DIR/server2-core-sip" -type f \( -name "*.conf" -o -name "*.php" \) -exec sed -i \
    -e "s/$OLD_S1/$NEW_S1/g" \
    -e "s/$OLD_S2/$NEW_S2/g" \
    -e "s/$OLD_S3/$NEW_S3/g" {} +

# 3. Update Server 3 Kamailio and Asterisk configs
find "$ROOT_DIR/server3-webrtc-kamailio" -type f \( -name "*.cfg" -o -name "*.conf" \) -exec sed -i \
    -e "s/$OLD_S1/$NEW_S1/g" \
    -e "s/$OLD_S2/$NEW_S2/g" \
    -e "s/$OLD_S3/$NEW_S3/g" {} +

# 4. Generate SQL statement to update MySQL view
cat <<EOF > "$ROOT_DIR/server1-web-portal-db/database/update_domain.sql"
-- Run this on Server 1 MySQL if Server 3 WebRTC IP or Domain changes:
USE vpl_crm;
DROP VIEW IF EXISTS subscriber;
CREATE VIEW subscriber AS 
SELECT 
    s.id AS id,
    CAST(s.order_id AS CHAR(64) CHARSET utf8mb4) AS username,
    '${NEW_S3}' AS domain,
    s.sip_password AS password,
    u.email AS email_address,
    MD5(CONCAT(s.order_id, ':${NEW_S3}:', s.sip_password)) AS ha1,
    MD5(CONCAT(s.order_id, '@${NEW_S3}:${NEW_S3}:', s.sip_password)) AS ha1b,
    NULL AS rpid 
FROM sip_accounts s 
JOIN users u ON (s.user_id = u.id) 
WHERE (s.status = 'active');
EOF

echo -e "${GREEN}[OK] All configuration files updated to new addresses!${NC}"
echo -e "${GREEN}[NOTE] Database subscriber update script generated at:${NC}"
echo "       $ROOT_DIR/server1-web-portal-db/database/update_domain.sql"
