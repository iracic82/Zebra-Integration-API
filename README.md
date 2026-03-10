# Zebra VisibilityIQ Mock API

A fully functional mock implementation of the Zebra VisibilityIQ Foresight API, deployed on AWS using **CloudFront + Lambda + DynamoDB**. Built to enable CSP portal development and integration testing without requiring access to the real Zebra API.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          CSP Portal / Clients                          │
│                                                                         │
│   apikey: REDACTED_API_KEY                                    │
│   Authorization: Bearer <token>                                         │
└──────────────────────────────┬──────────────────────────────────────────┘
                               │ HTTPS
                               ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                     CloudFront Distribution                             │
│                                                                         │
│   Domain:  zebra-api.highvelocitynetworking.com                        │
│   Dist ID: E2NEIKIAGL0SDP                                              │
│   TLS:     ACM Certificate (auto-renewed)                              │
│   Cache:   Disabled (real-time API responses)                          │
│   Origin:  Lambda Function URL (HTTPS only)                            │
└──────────────────────────────┬──────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                    Lambda Function (Node.js 20, ARM64)                  │
│                                                                         │
│   Name:    zebra-visibilityiq-api                                      │
│   Memory:  512 MB                                                       │
│   Timeout: 30s                                                          │
│                                                                         │
│   ┌─────────────┐  ┌──────────────────┐  ┌─────────────────────┐      │
│   │ Auth Layer  │──│  Route Matching   │──│  DynamoDB Queries   │      │
│   │             │  │                    │  │                     │      │
│   │ API Key     │  │ /zebra/{tenant}/  │  │ Single-table design │      │
│   │ OAuth 2.0   │  │ v2/data/devices/  │  │ PK/SK composite     │      │
│   │ Bearer      │  │ .../{endpoint}    │  │ GSI1, GSI2          │      │
│   └──────┬──────┘  └──────────────────┘  └──────────┬──────────┘      │
│          │                                            │                 │
│          ▼                                            ▼                 │
│   ┌─────────────────────┐                  ┌────────────────────┐      │
│   │  Secrets Manager    │                  │     DynamoDB       │      │
│   │                     │                  │                    │      │
│   │ zebra-visibilityiq/ │                  │ zebra-visibilityiq │      │
│   │ api-keys            │                  │ -data              │      │
│   │                     │                  │                    │      │
│   │ • 3 API Keys        │                  │ • 100 devices      │      │
│   │ • 2 OAuth clients   │                  │ • batteries        │      │
│   │ • 5-min cache       │                  │ • contracts        │      │
│   └─────────────────────┘                  │ • repairs, cases   │      │
│                                             │ • scans, WLAN...   │      │
│                                             └────────────────────┘      │
└─────────────────────────────────────────────────────────────────────────┘

             ┌──────────────────────────────────────────┐
             │         Seed Lambda (on deploy)          │
             │                                          │
             │  Generates 100 realistic Zebra devices   │
             │  with full topology: MC, Printer,        │
             │  Scanner models across 12 US sites       │
             │  + batteries, repairs, contracts, etc.   │
             └──────────────────────────────────────────┘
```

### AWS Resources

| Resource | Name / ID | Details |
|----------|-----------|---------|
| CloudFront | `E2NEIKIAGL0SDP` | Custom domain with ACM TLS cert |
| Lambda (API) | `zebra-visibilityiq-api` | Node.js 20, ARM64, 512MB |
| Lambda (Seed) | `zebra-visibilityiq-seed` | Auto-runs on deploy, seeds DynamoDB |
| DynamoDB | `zebra-visibilityiq-data` | PAY_PER_REQUEST, single-table design |
| Secrets Manager | `zebra-visibilityiq/api-keys` | API keys + OAuth client credentials |
| ACM Certificate | `1be0a191-...` | `zebra-api.highvelocitynetworking.com` |
| Route53 CNAME | `zebra-api.highvelocitynetworking.com` | → `d2jvs52jj8fovm.cloudfront.net` |

### Accounts & Profiles

| Profile | Account | Purpose |
|---------|---------|---------|
| `okta-sso` | `905418046272` | All AWS resources (Lambda, DynamoDB, CloudFront, ACM, Secrets Manager) |
| `default` | — | Route53 DNS (CNAME record) |

---

## Base URL

```
https://zebra-api.highvelocitynetworking.com
```

## URL Pattern

The API follows the real Zebra VisibilityIQ URL structure:

```
/zebra/{tenant-uuid}/v2/data/devices/operation/analytics/visibility/{endpoint}
```

**Default tenant UUID:** `e112b779-b0e8-4c01-b146-2920330121d6`

**Example:**
```
GET /zebra/e112b779-b0e8-4c01-b146-2920330121d6/v2/data/devices/operation/analytics/visibility/total-devices
```

Legacy paths (`/v2/visibilityiq/{endpoint}`) are also supported for backward compatibility.

---

## Authentication

All endpoints (except `/health` and `/v2/oauth/token`) require authentication.

### Option 1: API Key (Simple Key)

```bash
curl -H "apikey: REDACTED_API_KEY" \
  "https://zebra-api.highvelocitynetworking.com/zebra/e112b779-b0e8-4c01-b146-2920330121d6/v2/data/devices/operation/analytics/visibility/total-devices"
```

**Available API Keys** (stored in AWS Secrets Manager):

| Key | Purpose |
|-----|---------|
| `REDACTED_API_KEY` | Production |
| `REDACTED_API_KEY` | Partner integrations |
| `REDACTED_API_KEY` | CSP Portal |

### Option 2: OAuth 2.0 Client Credentials

**Step 1 — Obtain token:**
```bash
curl -X POST "https://zebra-api.highvelocitynetworking.com/zebra/e112b779-b0e8-4c01-b146-2920330121d6/v2/oauth/token" \
  -H "Content-Type: application/json" \
  -d '{"client_id":"REDACTED_CLIENT_ID","client_secret":"REDACTED_SECRET"}'
```

Response:
```json
{
  "access_token": "zviq_1773149075169_dayq4je6pts",
  "token_type": "Bearer",
  "expires_in": 3600,
  "scope": "visibilityiq"
}
```

**Step 2 — Use Bearer token:**
```bash
curl -H "Authorization: Bearer zviq_1773149075169_dayq4je6pts" \
  "https://zebra-api.highvelocitynetworking.com/zebra/e112b779-b0e8-4c01-b146-2920330121d6/v2/data/devices/operation/analytics/visibility/total-devices"
```

**OAuth Clients:**

| Client ID | Client Secret | Purpose |
|-----------|---------------|---------|
| `REDACTED_CLIENT_ID` | `REDACTED_SECRET` | CSP Portal |
| `REDACTED_CLIENT_ID` | `REDACTED_SECRET` | Partner App |

Tokens expire after **1 hour** (matching real Zebra behavior).

---

## API Endpoints

All endpoints use the base path:
```
/zebra/{tenant-uuid}/v2/data/devices/operation/analytics/visibility/
```

### Device APIs

| Endpoint | Description |
|----------|-------------|
| `GET .../total-devices` | All devices across all sites with full device details |
| `GET .../devices-in-operation` | Devices currently in "In-Use" status |
| `GET .../newly-activated-devices` | Recently activated devices |
| `GET .../out-of-contact-devices` | Devices in Maintenance or Decommissioned status |
| `GET .../predictive-state-insights` | Predictive analytics alerts per device |
| `GET .../geo-location` | GPS coordinates for all devices |

### Battery APIs

| Endpoint | Description |
|----------|-------------|
| `GET .../battery-level` | Battery level, voltage, capacity per device |
| `GET .../battery-discharge` | Average hourly discharge rates |
| `GET .../battery-swap` | Battery swap events with before/after levels |
| `GET .../critical-battery-events` | Batteries at or below 30% charge |
| `GET .../smart-battery-health` | Battery health status and predicted remaining life |

### Utilization APIs

| Endpoint | Description |
|----------|-------------|
| `GET .../application-analytics` | App usage minutes by site, categorized Business/Non-Business |
| `GET .../device-disruptions` | Reboot and ANR counts by device |
| `GET .../physical-memory-utilization` | RAM usage and threshold alerts |
| `GET .../storage-memory-utilization` | Storage usage and threshold alerts |
| `GET .../scan-metrics` | Successful/unsuccessful scans with symbology breakdown |
| `GET .../utilization-rightsizing` | Fleet utilization per site with optimization recommendations |
| `GET .../wlan-signal-strength` | WLAN signal strength per device and access point |

### Printer APIs

| Endpoint | Description |
|----------|-------------|
| `GET .../printer-utilization` | Labels printed, length printed per printer |
| `GET .../printer-setting-changes` | Setting change audit log |
| `GET .../printer-alerts` | Printer alerts (head open, paper out, etc.) |

### Support & Maintenance APIs

| Endpoint | Description |
|----------|-------------|
| `GET .../entitlement` | Service contracts with expiration buckets |
| `GET .../case-lifecycle` | Support cases from open to close with aging |
| `GET .../repair-lifecycle` | RMA repair tracking through the repair process |
| `GET .../repair-return-rate` | Return rates by site with NTF and damage rates |
| `GET .../repair-repeat-rate` | Trend of repeat repairs within 30 days |
| `GET .../top-repair-metrics` | Top fault codes ranked by frequency |
| `GET .../on-time-delivery` | Repair on-time delivery percentage |
| `GET .../lifeguard-analytics` | Android security patch status per device |

### Device Management APIs

| Endpoint | Method | Description |
|----------|--------|-------------|
| `.../devices/information` | GET | Get device info (optional `?serialNum=`) |
| `.../devices/management/enroll` | POST | Enroll a new device |
| `.../devices/management/update` | PUT | Update device details |
| `.../devices/management/remove` | DELETE | Remove a device (`?serialNum=`) |

### Auth & Tenant APIs

| Endpoint | Method | Description |
|----------|--------|-------------|
| `.../oauth/token` | POST | Get OAuth Bearer token |
| `.../devices/credentials/token` | POST | Get service token via API key |
| `.../mytenant` | GET | Get tenant information |

### Utility Endpoints

| Path | Description |
|------|-------------|
| `/health` | Health check (no auth required) |
| `/api-docs` | List all available endpoints |

---

## Device Data Model

The device response schema matches the real Zebra VisibilityIQ API format:

```json
{
  "os": "Android 13",
  "imei": "354627098123456",
  "bssid": "24:F5:A2:8B:C3:D1",
  "model": "TC58",
  "ipAddr": "10.42.15.128",
  "status": "In-Use",
  "phoneNum": 15551234567,
  "siteName": "NYC Distribution Center",
  "assetName": "ZBR-TC58-2024NYC001",
  "fullModel": "TC58HO-1PEZU4P-US",
  "lgVersion": "11.4.2.1",
  "serialNum": "24108TC5801234",
  "contractId": "ZBR-ENT-2024-08521",
  "deviceType": "Mobile Computer",
  "macAddress": "00:A0:C6:F2:4A:8E",
  "siteHierarchy": "Acme Corp/North America/USA/EST/New York/NYC Distribution Center",
  "gpsCoordinates": "40.7128,-74.0060",
  "networkConnectionType": "WiFi 6"
}
```

### Field Reference

| Field | Type | Description |
|-------|------|-------------|
| `serialNum` | string | Device serial number (`YYDDDMODEL+seq`) |
| `model` | string | Short model code (TC58, MC93, ZT411, etc.) |
| `fullModel` | string | Full Zebra part number (TC58HO-1PEZU4P-US) |
| `deviceType` | string | Mobile Computer, Enterprise Tablet, Industrial Printer, etc. |
| `os` | string | Android 10–14 (MC devices) or Link-OS (printers) |
| `status` | string | `In-Use`, `Available`, `Maintenance`, `Decommissioned` |
| `siteName` | string | Human-readable site name |
| `siteHierarchy` | string | Full path: `Company/Region/Country/TZ/State/Site` |
| `assetName` | string | Asset tag (`ZBR-{model}-{year}{site}{seq}`) |
| `contractId` | string | Service contract ID (`ZBR-{type}-{year}-{num}`) |
| `imei` | number | 15-digit IMEI (MC devices only) |
| `phoneNum` | number | Phone number (MC devices only) |
| `macAddress` | string | MAC address (Zebra OUI: `00:A0:C6`) |
| `bssid` | string | Connected AP BSSID |
| `ipAddr` | string | IP address (10.42.x.x range) |
| `lgVersion` | string | LifeGuard patch version (MC devices only) |
| `gpsCoordinates` | string | `"lat,lng"` as string |
| `networkConnectionType` | string | WiFi 5, WiFi 6, WiFi 6E, 5G, Bluetooth 5.0 |

### Device Types

| Category | Models | Device Types |
|----------|--------|-------------|
| Mobile Computers | TC58, TC52, TC21, TC57, TC72, TC73, MC93, MC9300, MC3300x, EC50 | Mobile Computer, Touch Computer, Rugged Touch Computer, Ultra-Rugged Mobile Computer, Rugged Mobile Computer, Enterprise Computer |
| Tablets | ET40, ET45 | Enterprise Tablet |
| Wearables | WT6300 | Wearable Computer |
| Personal Shoppers | PS20 | Personal Shopper |
| Scanners | DS8178, DS3608, LI3608, DS9908 | Handheld Scanner, Ultra-Rugged Scanner, Linear Scanner, Presentation Scanner |
| Printers | ZT411, ZT421, ZT610, ZD621, ZQ630 | Industrial Printer, Desktop Printer, Mobile Printer |

### Sites (Seed Data)

| Site | State | GPS | Timezone |
|------|-------|-----|----------|
| NYC Distribution Center | New York | 40.7128, -74.0060 | EST |
| Chicago Warehouse | Illinois | 41.8781, -87.6298 | CST |
| Dallas Fulfillment Hub | Texas | 32.7767, -96.7970 | CST |
| LA Retail Store 412 | California | 34.0522, -118.2437 | PST |
| Seattle Cold Storage | Washington | 47.6062, -122.3321 | PST |
| Miami Port Terminal | Florida | 25.7617, -80.1918 | EST |
| Phoenix Assembly Plant | Arizona | 33.4484, -112.0740 | MST |
| Denver Grocery Store 88 | Colorado | 39.7392, -104.9903 | MST |
| Boston Medical Center | Massachusetts | 42.3601, -71.0589 | EST |
| Atlanta Sorting Facility | Georgia | 33.7490, -84.3880 | EST |
| Houston Logistics Hub | Texas | 29.7604, -95.3698 | CST |
| San Francisco DC | California | 37.7749, -122.4194 | PST |

---

## Seed Data Summary

Auto-seeded on every deploy via a Custom Resource trigger:

| Entity | Count | Description |
|--------|-------|-------------|
| Devices | 100 | MC, Printer, Scanner devices across 12 sites |
| Batteries | ~60 | One per MC device with health, voltage, capacity |
| Battery Swaps | ~90 | 1–5 swaps per device over 30 days |
| App Analytics | ~96 | 8 apps x 12 sites with usage minutes |
| Disruptions | 40 | Reboots and ANRs per MC device |
| Memory (RAM + Storage) | ~100 | RAM and storage utilization per MC device |
| Scan Metrics | 40 | Barcode scan counts with symbology breakdown |
| Utilization | 12 | Fleet utilization per site |
| WLAN | 30 | Signal strength per device + AP info |
| Printer Utilization | ~20 | Labels printed, length printed |
| Printer Settings | ~30 | Setting change audit entries |
| Printer Alerts | ~30 | HEAD_OPEN, PAPER_OUT, etc. |
| Contracts | 5 | OneCare Essential/Select/SV, VisibilityIQ Foresight |
| Cases | 25 | Technical/non-technical support cases |
| Repairs | 40 | RMA repairs with fault codes, on-time delivery |
| LifeGuard | 30 | Android security patch status per MC device |
| Predictive Insights | 15 | Predictive maintenance alerts |

---

## Deployment

### Prerequisites

- Node.js 20+
- AWS CDK CLI (`npm install -g aws-cdk`)
- AWS profiles configured: `okta-sso` (resources) and `default` (Route53)

### Deploy

```bash
# Install dependencies
npm install

# Deploy stack (builds, bundles, deploys Lambda + DynamoDB + CloudFront)
npm run deploy

# Or manually:
npx cdk deploy --profile okta-sso --require-approval never
```

The deploy automatically:
1. Creates/updates DynamoDB table
2. Bundles and deploys both Lambda functions (API + Seed)
3. Triggers seed Lambda to populate DynamoDB with 100 devices + related data
4. Updates CloudFront distribution

### Tear Down

```bash
npm run destroy
# Or: npx cdk destroy --profile okta-sso
```

### Re-seed Data

```bash
aws lambda invoke --profile okta-sso --function-name zebra-visibilityiq-seed \
  --payload '{"action":"seed"}' /dev/stdout
```

### CDK Stack Structure

```
lib/zebra-integration-api-stack.ts   # Infrastructure: DynamoDB, Lambda, CloudFront, ACM, Secrets Manager
lambda/handlers/api.ts                # API handler: 30+ endpoints with auth, routing, DynamoDB queries
lambda/handlers/seed.ts               # Seed handler: generates 100 devices + all related mock data
```

---

## How It Was Built

### Step 1: CDK Bootstrap
```bash
npx cdk bootstrap --profile okta-sso
```
Bootstrapped CDK in account `905418046272` / `us-east-1`.

### Step 2: Initial Deploy
Created CDK stack with DynamoDB (single-table), Lambda (Node.js 20, ARM64), Lambda Function URL, and CloudFront distribution. Deployed with `cdk deploy`.

### Step 3: ACM Certificate
```bash
aws acm request-certificate --profile okta-sso \
  --domain-name zebra-api.highvelocitynetworking.com --validation-method DNS
```
Created DNS validation CNAME in Route53 (default profile). Certificate auto-validated.

### Step 4: Secrets Manager
```bash
aws secretsmanager create-secret --profile okta-sso --name "zebra-visibilityiq/api-keys" \
  --secret-string '{"keys":[...],"oauth_clients":{...}}'
```
Stores API keys and OAuth client credentials. Lambda caches the secret for 5 minutes.

### Step 5: Custom Domain
Updated CloudFront distribution with `zebra-api.highvelocitynetworking.com` alias + ACM certificate. Created Route53 CNAME:
```
zebra-api.highvelocitynetworking.com -> d2jvs52jj8fovm.cloudfront.net
```

### Step 6: Real API Schema
Updated device data model to match the real Zebra VisibilityIQ response format provided by ENG, including `serialNum`, `imei`, `bssid`, `fullModel`, `siteHierarchy`, `macAddress`, `lgVersion`, `gpsCoordinates`, `networkConnectionType`, and the real URL pattern `/zebra/{tenant-uuid}/v2/data/devices/...`.

---

## CSP Portal Configuration

Use these values when configuring the Zebra integration in the CSP portal:

| Field | Value |
|-------|-------|
| **Provider URL** | `https://zebra-api.highvelocitynetworking.com` |
| **Company Name** | `Acme Corp` |
| **Partner Name** | `Mock Partner Corp.` |
| **API Key** | `REDACTED_API_KEY` |
| **Tenant UUID** | `e112b779-b0e8-4c01-b146-2920330121d6` |

### Quick Test

```bash
curl -H "apikey: REDACTED_API_KEY" \
  "https://zebra-api.highvelocitynetworking.com/zebra/e112b779-b0e8-4c01-b146-2920330121d6/v2/data/devices/operation/analytics/visibility/total-devices"
```

---

## Comparison: Mock vs Real Zebra API

| Aspect | Real Zebra API | This Mock |
|--------|---------------|-----------|
| Base URL | `api.zebra.com` or internal `172.28.6.55:8866` | `zebra-api.highvelocitynetworking.com` |
| URL Pattern | `/zebra/{uuid}/v2/data/devices/.../visibility/{ep}` | Same |
| Auth | API key (`apikey` header) or OAuth 2.0 | Same (validated against Secrets Manager) |
| Response format | `{ "data": [...] }` | Same |
| Device fields | `serialNum`, `model`, `fullModel`, `imei`, etc. | Same schema |
| Token TTL | 1 hour | 1 hour |
| Data source | Real EMM + device telemetry | Seeded mock data (100 devices, 12 sites) |

---

## Zebra Developer Portal Reference

The official Zebra VisibilityIQ API documentation is available at [developer.zebra.com/apis/visibilityiq](https://developer.zebra.com/apis/visibilityiq) (requires authenticated Zebra Developer Portal account).

Key resources:
- **Authentication**: `apikey` header for simple key auth, OAuth 2.0 Client Credentials or Authorization Code for production
- **Token endpoint**: Bearer tokens last 1 hour, authorization codes expire in 10 seconds
- **30+ APIs** covering: Device inventory, Battery health, Utilization analytics, Printer management, Support/Repair lifecycle, LifeGuard security patches, Predictive insights
- **Product tiers**: Value-Add APIs (10 APIs) + Aggregated Data APIs (8 APIs)
- **Requires**: Zebra OneCare maintenance plan for VisibilityIQ features
