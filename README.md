# VPL — Multi-Server VoIP, WebRTC & CRM Telephony Platform

A complete 3-Tier Enterprise VoIP & WebRTC Telephony Architecture with automated provisioning, real-time billing, DID routing, and softphone support.

---

## 🏗 System Architecture

```
                 +-------------------------------------------------+
                 |                Client Browsers / Apps           |
                 +-----------------------+-------------------------+
                                         |
                       HTTPS:443 / WSS:8089 (WebRTC)
                                         |
                                         v
+-----------------------------------------------------------------------------------------+
| [Server 1] Web Portal & Database (192.168.88.119 / portal.yourdomain.com)              |
|  - Node.js Backend API (Port 3000)                                                      |
|  - Nginx Reverse Proxy (Ports 80 / 443 -> WebRTC proxy to Server 3)                    |
|  - MySQL 8.0 Database (Database: vpl_crm)                                               |
|  - Dynamic Asterisk Provisioner (Provisions WebRTC extensions on Server 3 via SSH)     |
+-----------------------------------------------------------------------------------------+
                                         |
                                         | MySQL remote connection
                                         v
+-----------------------------------------------------------------------------------------+
| [Server 3] WebRTC Edge Proxy & Media Gateway (192.168.88.47 / webrtc.yourdomain.com)    |
|  - Kamailio 6.x (SIP UDP 5060, WSS TLS 8089)                                           |
|  - Direct authentication against Server 1 MySQL `subscriber` view                       |
|  - Internal Asterisk Media Server (Port 5062) for RTP / WebRTC bridging                 |
+-----------------------------------------------------------------------------------------+
                                         |
                                         | SIP UDP 5060 Trunk
                                         v
+-----------------------------------------------------------------------------------------+
| [Server 2] Core SIP Switch & Call Engine (192.168.88.51 / sip.yourdomain.com)           |
|  - Asterisk 22 PBX (SIP UDP 5060, RTP 10000-20000)                                     |
|  - Inbound DID Router AGI (`did_call_router.php`)                                       |
|  - Outbound Talktime Guard & Real-Time Billing AGI (`outbound_call_router.php`)          |
|  - PSTN / Carrier Outbound Trunk (VPL-OUTBOUND)                                         |
+-----------------------------------------------------------------------------------------+
```

---

## 📁 Repository Structure

```
VPL/
├── .gitignore
├── .env.example
├── README.md
├── deploy.sh                       # Universal Git pull & service deployment reloader
├── scripts/
│   └── update-ips.sh               # Switch between local private IPs and production IPs
├── server1-web-portal-db/
│   ├── setup.sh                    # Automated 1-click installer for Server 1
│   ├── vpl-portal.service          # Systemd service unit
│   ├── nginx/
│   │   └── vpl_portal.conf         # Nginx reverse proxy & SSL config
│   ├── database/
│   │   ├── schema.sql              # MySQL database structure & views
│   │   └── seed_data.sql           # Initial destination rates & defaults
│   ├── backend/                    # Node.js Express backend source code
│   └── public/                     # Frontend Web Portal & WebRTC Softphone
├── server2-core-sip/
│   ├── setup.sh                    # Automated 1-click installer for Server 2
│   ├── asterisk/
│   │   ├── pjsip.conf              # Core SIP trunks & transports
│   │   ├── extensions.conf         # Dialplan routing
│   │   ├── rtp.conf
│   │   └── modules.conf
│   └── agi-bin/
│       ├── did_call_router.php     # Inbound DID router & CDR processor
│       └── outbound_call_router.php# Real-time billing & talktime guard
└── server3-webrtc-kamailio/
    ├── setup.sh                    # Automated 1-click installer for Server 3
    ├── kamailio/
    │   ├── kamailio.cfg            # Kamailio SIP & WebRTC WSS proxy configuration
    │   └── tls.cfg                 # TLS certificate configuration
    └── asterisk/
        ├── pjsip.conf              # Media server PJSIP templates & trunks
        └── extensions.conf         # WebRTC softphone echo & outbound dialplan
```

---

## 🚀 Quick Setup on Fresh Servers

### Server 1: Web Portal & Database (`192.168.88.119`)
Log into your new Server 1 as `root`:
```bash
git clone https://github.com/Awaisnazir3/VPL.git
cd VPL/server1-web-portal-db
chmod +x setup.sh
./setup.sh
```

### Server 2: Core SIP Server (`192.168.88.51`)
Log into your new Server 2 as `root`:
```bash
git clone https://github.com/Awaisnazir3/VPL.git
cd VPL/server2-core-sip
chmod +x setup.sh
./setup.sh
```

### Server 3: WebRTC Kamailio Edge (`192.168.88.47`)
Log into your new Server 3 as `root`:
```bash
git clone https://github.com/Awaisnazir3/VPL.git
cd VPL/server3-webrtc-kamailio
chmod +x setup.sh
./setup.sh
```

---

## 🌐 Moving to Production (Switching IPs / Domains)

When migrating from local private IPs (`192.168.88.x`) to Public IPs or Domains:

1. Run the IP switcher script:
```bash
cd VPL
chmod +x scripts/update-ips.sh
./scripts/update-ips.sh --server1 portal.yourdomain.com --server2 sip.yourdomain.com --server3 webrtc.yourdomain.com
```

2. Push changes to GitHub:
```bash
git add .
git commit -m "Update server endpoints for production"
git push origin main
```

3. Update the database subscriber view on Server 1:
```bash
mysql -u root vpl_crm < server1-web-portal-db/database/update_domain.sql
```

4. Run `./deploy.sh` on each server to pull the changes and reload services.

---

## 🔄 Git-Based Server Management & Updates

Whenever you make changes to configs or backend code:

1. **Commit and push from your workstation:**
   ```bash
   git add .
   git commit -m "Updated dialplan and rates"
   git push origin main
   ```

2. **Deploy on any server with one command:**
   ```bash
   cd /path/to/VPL
   chmod +x deploy.sh
   ./deploy.sh
   ```
   `deploy.sh` automatically detects which server it is running on, pulls the latest code, copies files to system locations, and gracefully reloads services (`nginx`, `vpl-portal`, `asterisk`, or `kamailio`).
