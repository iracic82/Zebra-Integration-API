import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  QueryCommand,
  PutCommand,
  DeleteCommand,
} from '@aws-sdk/lib-dynamodb';
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from '@aws-sdk/client-secrets-manager';

const client = new DynamoDBClient({});
const ddb = DynamoDBDocumentClient.from(client);
const smClient = new SecretsManagerClient({});
const TABLE = process.env.TABLE_NAME!;
const SECRET_NAME = process.env.SECRET_NAME!;

// ─── Cached Secret ──────────────────────────────────────────────
let cachedSecret: {
  keys: string[];
  oauth_clients: Record<string, { client_id: string; client_secret: string }>;
} | null = null;
let secretLastFetched = 0;
const SECRET_CACHE_TTL = 5 * 60 * 1000;

const issuedTokens = new Map<string, { clientId: string; expiresAt: number }>();

async function getSecret() {
  const now = Date.now();
  if (cachedSecret && now - secretLastFetched < SECRET_CACHE_TTL) {
    return cachedSecret;
  }
  const result = await smClient.send(
    new GetSecretValueCommand({ SecretId: SECRET_NAME })
  );
  cachedSecret = JSON.parse(result.SecretString!);
  secretLastFetched = now;
  return cachedSecret!;
}

// ─── Types ──────────────────────────────────────────────────────
interface ApiEvent {
  requestContext: { http: { method: string; path: string } };
  headers: Record<string, string | undefined>;
  queryStringParameters?: Record<string, string>;
  body?: string;
}

interface ApiResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

// ─── Auth ───────────────────────────────────────────────────────
async function validateAuth(
  headers: Record<string, string | undefined>
): Promise<string | null> {
  const secret = await getSecret();

  const apiKey = headers['apikey'] || headers['x-api-key'];
  if (apiKey) {
    if (secret.keys.includes(apiKey)) return null;
    return 'Invalid API key. Check your credentials in the Zebra Developer Portal.';
  }

  const authHeader = headers['authorization'];
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    const tokenInfo = issuedTokens.get(token);
    if (tokenInfo && tokenInfo.expiresAt > Date.now()) return null;
    if (token.startsWith('mock_token_')) return null;
    return 'Invalid or expired Bearer token. Obtain a new token via POST /v2/oauth/token.';
  }

  return 'Authentication required. Provide apikey header or Authorization: Bearer <token>';
}

// ─── Response Helpers ───────────────────────────────────────────
function json(statusCode: number, body: unknown): ApiResponse {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'X-Zebra-Mock': 'true',
    },
    body: JSON.stringify(body),
  };
}

function stripKeys(item: any) {
  const { PK, SK, GSI1PK, GSI1SK, GSI2PK, GSI2SK, _category, _siteObj, ...rest } = item;
  return rest;
}

// ─── DynamoDB Helpers ───────────────────────────────────────────
async function queryByPK(pk: string, skPrefix?: string) {
  const params: any = {
    TableName: TABLE,
    KeyConditionExpression: skPrefix
      ? 'PK = :pk AND begins_with(SK, :sk)'
      : 'PK = :pk',
    ExpressionAttributeValues: { ':pk': pk },
  };
  if (skPrefix) params.ExpressionAttributeValues[':sk'] = skPrefix;

  const result = await ddb.send(new QueryCommand(params));
  return result.Items || [];
}

// ─── Path Parsing ───────────────────────────────────────────────
// Real Zebra URL: /zebra/{tenant-uuid}/v2/data/devices/operation/analytics/visibility/{endpoint}
// Also support legacy: /v2/visibilityiq/{endpoint}
function parsePath(rawPath: string): { tenantId: string | null; endpoint: string } {
  // /zebra/{uuid}/v2/data/devices/operation/analytics/visibility/{endpoint}
  const zebraMatch = rawPath.match(
    /^\/zebra\/([a-f0-9-]+)\/v2\/data\/devices\/operation\/analytics\/visibility\/(.+)$/
  );
  if (zebraMatch) {
    return { tenantId: zebraMatch[1], endpoint: zebraMatch[2] };
  }

  // /zebra/{uuid}/v2/data/devices/{sub-path}
  const zebraDevicesMatch = rawPath.match(
    /^\/zebra\/([a-f0-9-]+)\/v2\/data\/devices\/(.+)$/
  );
  if (zebraDevicesMatch) {
    return { tenantId: zebraDevicesMatch[1], endpoint: `devices/${zebraDevicesMatch[2]}` };
  }

  // /zebra/{uuid}/v2/{sub-path}
  const zebraGenericMatch = rawPath.match(
    /^\/zebra\/([a-f0-9-]+)\/v2\/(.+)$/
  );
  if (zebraGenericMatch) {
    return { tenantId: zebraGenericMatch[1], endpoint: zebraGenericMatch[2] };
  }

  // Legacy: /v2/visibilityiq/{endpoint}
  const legacyMatch = rawPath.match(/^\/v2\/visibilityiq\/(.+)$/);
  if (legacyMatch) {
    return { tenantId: null, endpoint: legacyMatch[1] };
  }

  // Legacy: /v2/{path}
  const v2Match = rawPath.match(/^\/v2\/(.+)$/);
  if (v2Match) {
    return { tenantId: null, endpoint: v2Match[1] };
  }

  return { tenantId: null, endpoint: rawPath };
}

// ─── Route Handler Type ─────────────────────────────────────────
type RouteHandler = (
  params: Record<string, string>,
  tenant: string,
  body?: any
) => Promise<ApiResponse>;

// ─── Endpoint Handlers ──────────────────────────────────────────
const endpoints: Record<string, RouteHandler> = {
  // ══════ DEVICE APIs ══════
  'total-devices': async (_params, tenant) => {
    const items = await queryByPK(`TENANT#${tenant}#DEVICE`);
    return json(200, { data: items.map(stripKeys) });
  },

  'devices-in-operation': async (_params, tenant) => {
    const items = await queryByPK(`TENANT#${tenant}#DEVICE`);
    const filtered = items.filter((i: any) => i.status === 'In-Use');
    return json(200, { data: filtered.map(stripKeys) });
  },

  'newly-activated-devices': async (_params, tenant) => {
    const items = await queryByPK(`TENANT#${tenant}#DEVICE`);
    // All devices are "newly activated" in mock (seeded recently)
    return json(200, { data: items.slice(0, 20).map(stripKeys) });
  },

  'out-of-contact-devices': async (_params, tenant) => {
    const items = await queryByPK(`TENANT#${tenant}#DEVICE`);
    const filtered = items.filter((i: any) => i.status === 'Decommissioned' || i.status === 'Maintenance');
    return json(200, { data: filtered.map(stripKeys) });
  },

  'predictive-state-insights': async (_params, tenant) => {
    const items = await queryByPK(`TENANT#${tenant}#PREDICTIVE`);
    return json(200, { data: items.map(stripKeys) });
  },

  // ══════ BATTERY APIs ══════
  'battery-level': async (_params, tenant) => {
    const items = await queryByPK(`TENANT#${tenant}#BATTERY`);
    return json(200, { data: items.map(stripKeys) });
  },

  'battery-discharge': async (_params, tenant) => {
    const items = await queryByPK(`TENANT#${tenant}#BATTERY`);
    return json(200, { data: items.map((i: any) => ({ ...stripKeys(i), avgDischargeRate: i.dischargeRate })) });
  },

  'battery-swap': async (_params, tenant) => {
    const items = await queryByPK(`TENANT#${tenant}#BATTERY_SWAP`);
    return json(200, { data: items.map(stripKeys) });
  },

  'critical-battery-events': async (_params, tenant) => {
    const items = await queryByPK(`TENANT#${tenant}#BATTERY`);
    const filtered = items.filter((i: any) => i.batteryLevel <= 30);
    return json(200, { data: filtered.map(stripKeys) });
  },

  'smart-battery-health': async (_params, tenant) => {
    const items = await queryByPK(`TENANT#${tenant}#BATTERY`);
    return json(200, {
      data: items.map((i: any) => ({
        serialNum: i.serialNum || i.deviceSerialNumber,
        batterySerialNum: i.batterySerialNum || i.batterySerialNumber,
        healthStatus: i.healthStatus,
        predictedRemainingLife: i.predictedRemainingLife,
        capacity: i.capacity,
        voltage: i.voltage,
        lastReportedDate: i.lastReportedDate,
      })),
    });
  },

  // ══════ UTILIZATION APIs ══════
  'application-analytics': async (_params, tenant) => {
    const items = await queryByPK(`TENANT#${tenant}#APP_ANALYTICS`);
    return json(200, { data: items.map(stripKeys) });
  },

  'device-disruptions': async (_params, tenant) => {
    const items = await queryByPK(`TENANT#${tenant}#DISRUPTION`);
    return json(200, { data: items.map(stripKeys) });
  },

  'physical-memory-utilization': async (_params, tenant) => {
    const items = await queryByPK(`TENANT#${tenant}#MEMORY`);
    return json(200, { data: items.filter((i: any) => i.memoryType === 'RAM').map(stripKeys) });
  },

  'storage-memory-utilization': async (_params, tenant) => {
    const items = await queryByPK(`TENANT#${tenant}#MEMORY`);
    return json(200, { data: items.filter((i: any) => i.memoryType === 'STORAGE').map(stripKeys) });
  },

  'scan-metrics': async (_params, tenant) => {
    const items = await queryByPK(`TENANT#${tenant}#SCAN`);
    return json(200, { data: items.map(stripKeys) });
  },

  'utilization-rightsizing': async (_params, tenant) => {
    const items = await queryByPK(`TENANT#${tenant}#UTILIZATION`);
    return json(200, { data: items.map(stripKeys) });
  },

  'wlan-signal-strength': async (_params, tenant) => {
    const items = await queryByPK(`TENANT#${tenant}#WLAN`);
    return json(200, { data: items.map(stripKeys) });
  },

  'geo-location': async (_params, tenant) => {
    const items = await queryByPK(`TENANT#${tenant}#DEVICE`);
    return json(200, {
      data: items.map((i: any) => ({
        serialNum: i.serialNum,
        model: i.model,
        siteName: i.siteName,
        gpsCoordinates: i.gpsCoordinates,
        status: i.status,
      })),
    });
  },

  // ══════ PRINTER APIs ══════
  'printer-utilization': async (_params, tenant) => {
    const items = await queryByPK(`TENANT#${tenant}#PRINTER_UTIL`);
    return json(200, { data: items.map(stripKeys) });
  },

  'printer-setting-changes': async (_params, tenant) => {
    const items = await queryByPK(`TENANT#${tenant}#PRINTER_SETTINGS`);
    return json(200, { data: items.map(stripKeys) });
  },

  'printer-alerts': async (_params, tenant) => {
    const items = await queryByPK(`TENANT#${tenant}#PRINTER_ALERT`);
    return json(200, { data: items.map(stripKeys) });
  },

  // ══════ SUPPORT & MAINTENANCE ══════
  'entitlement': async (_params, tenant) => {
    const items = await queryByPK(`TENANT#${tenant}#CONTRACT`);
    return json(200, { data: items.map(stripKeys) });
  },

  'case-lifecycle': async (_params, tenant) => {
    const items = await queryByPK(`TENANT#${tenant}#CASE`);
    return json(200, { data: items.map(stripKeys) });
  },

  'repair-lifecycle': async (_params, tenant) => {
    const items = await queryByPK(`TENANT#${tenant}#REPAIR`);
    return json(200, { data: items.map(stripKeys) });
  },

  'repair-return-rate': async (_params, tenant) => {
    const items = await queryByPK(`TENANT#${tenant}#REPAIR`);
    const sites = [...new Set(items.map((i: any) => i.siteName))];
    const data = sites.map((siteName) => {
      const siteItems = items.filter((i: any) => i.siteName === siteName);
      return {
        siteName,
        totalRepairs: siteItems.length,
        returnRate: ((siteItems.length / items.length) * 100).toFixed(1),
        ntfRate: ((siteItems.filter((i: any) => i.ntf).length / siteItems.length) * 100).toFixed(1),
        damageRate: ((siteItems.filter((i: any) => i.damageIndicator).length / siteItems.length) * 100).toFixed(1),
      };
    });
    return json(200, { data });
  },

  'repair-repeat-rate': async (_params, tenant) => {
    const items = await queryByPK(`TENANT#${tenant}#REPAIR`);
    const repeated = items.filter((i: any) => i.repeatRepair);
    return json(200, {
      repeatRate: items.length ? ((repeated.length / items.length) * 100).toFixed(1) : '0',
      totalRepairs: items.length,
      repeatRepairs: repeated.length,
      trend: [
        { month: '2026-01', rate: '3.2' },
        { month: '2026-02', rate: '2.8' },
        { month: '2026-03', rate: '2.5' },
      ],
    });
  },

  'top-repair-metrics': async (_params, tenant) => {
    const items = await queryByPK(`TENANT#${tenant}#REPAIR`);
    const faultCounts: Record<string, number> = {};
    items.forEach((i: any) => { faultCounts[i.faultCode] = (faultCounts[i.faultCode] || 0) + 1; });
    const topFaults = Object.entries(faultCounts)
      .sort((a, b) => b[1] - a[1]).slice(0, 10)
      .map(([fault, count]) => ({ faultCode: fault, count }));
    return json(200, { topFaults, totalRepairs: items.length });
  },

  'on-time-delivery': async (_params, tenant) => {
    const items = await queryByPK(`TENANT#${tenant}#REPAIR`);
    const onTime = items.filter((i: any) => i.onTimeDelivery);
    return json(200, {
      onTimeRate: items.length ? ((onTime.length / items.length) * 100).toFixed(1) : '0',
      totalRepairs: items.length,
      onTimeCount: onTime.length,
      lateCount: items.length - onTime.length,
    });
  },

  'lifeguard-analytics': async (_params, tenant) => {
    const items = await queryByPK(`TENANT#${tenant}#LIFEGUARD`);
    return json(200, { data: items.map(stripKeys) });
  },

  // ══════ DEVICE MANAGEMENT ══════
  'devices/information': async (params, tenant) => {
    const serialNum = params.serialNum || params.serialNumber;
    if (serialNum) {
      const items = await queryByPK(`TENANT#${tenant}#DEVICE`, `DEVICE#${serialNum}`);
      if (items.length === 0) return json(404, { error: 'Device not found' });
      return json(200, stripKeys(items[0]));
    }
    const items = await queryByPK(`TENANT#${tenant}#DEVICE`);
    return json(200, { data: items.map(stripKeys) });
  },

  'devices/management/enroll': async (_params, tenant, body) => {
    if (!body?.serialNum || !body?.model) {
      return json(400, { error: 'serialNum and model are required' });
    }
    const item = {
      PK: `TENANT#${tenant}#DEVICE`,
      SK: `DEVICE#${body.serialNum}`,
      GSI1PK: `SITE#${body.siteName || 'UNASSIGNED'}`,
      GSI1SK: `DEVICE#${body.serialNum}`,
      GSI2PK: `MODEL#${body.model}`,
      GSI2SK: `DEVICE#${body.serialNum}`,
      status: 'Available',
      ...body,
    };
    await ddb.send(new PutCommand({ TableName: TABLE, Item: item }));
    return json(201, { message: 'Device enrolled', device: stripKeys(item) });
  },

  'devices/management/update': async (_params, tenant, body) => {
    if (!body?.serialNum) return json(400, { error: 'serialNum is required' });
    const existing = await queryByPK(`TENANT#${tenant}#DEVICE`, `DEVICE#${body.serialNum}`);
    if (existing.length === 0) return json(404, { error: 'Device not found' });
    const updated = { ...existing[0], ...body };
    await ddb.send(new PutCommand({ TableName: TABLE, Item: updated }));
    return json(200, { message: 'Device updated', device: stripKeys(updated) });
  },

  'devices/management/remove': async (params, tenant) => {
    const serialNum = params.serialNum || params.serialNumber;
    if (!serialNum) return json(400, { error: 'serialNum query parameter is required' });
    await ddb.send(new DeleteCommand({
      TableName: TABLE,
      Key: { PK: `TENANT#${tenant}#DEVICE`, SK: `DEVICE#${serialNum}` },
    }));
    return json(200, { message: `Device ${serialNum} removed` });
  },

  // ══════ AUTH ══════
  'oauth/token': async (_params, _tenant, body) => {
    const secret = await getSecret();
    const clientId = body?.client_id;
    const clientSecret = body?.client_secret;

    if (!clientId || !clientSecret) {
      return json(400, { error: 'invalid_request', error_description: 'client_id and client_secret are required' });
    }

    const matchingClient = Object.values(secret.oauth_clients).find(
      (c) => c.client_id === clientId && c.client_secret === clientSecret
    );
    if (!matchingClient) {
      return json(401, { error: 'invalid_client', error_description: 'Invalid client credentials' });
    }

    const token = `zviq_${Date.now()}_${Math.random().toString(36).slice(2, 14)}`;
    issuedTokens.set(token, { clientId, expiresAt: Date.now() + 3600_000 });
    return json(200, { access_token: token, token_type: 'Bearer', expires_in: 3600, scope: 'visibilityiq' });
  },

  'devices/credentials/token': async (_params, _tenant, body) => {
    const secret = await getSecret();
    const apiKey = body?.apikey || body?.api_key;
    if (!apiKey || !secret.keys.includes(apiKey)) {
      return json(401, { error: 'Invalid API key for service token request' });
    }
    const token = `zviq_svc_${Date.now()}_${Math.random().toString(36).slice(2, 14)}`;
    issuedTokens.set(token, { clientId: 'service', expiresAt: Date.now() + 3600_000 });
    return json(200, { token, expires_in: 3600 });
  },

  'mytenant': async (_params, tenant) => {
    return json(200, {
      tenantId: tenant,
      companyName: 'Acme Corp',
      partnerName: 'Mock Partner Corp.',
      status: 'ACTIVE',
    });
  },
};

// ─── Main Handler ───────────────────────────────────────────────
export async function handler(event: ApiEvent): Promise<ApiResponse> {
  const method = event.requestContext.http.method;
  const rawPath = event.requestContext.http.path;
  const params = event.queryStringParameters || {};
  const headers = Object.fromEntries(
    Object.entries(event.headers || {}).map(([k, v]) => [k.toLowerCase(), v])
  );

  if (method === 'OPTIONS') {
    return json(200, { status: 'ok' });
  }

  // Health check
  if (rawPath === '/' || rawPath === '/health') {
    return json(200, {
      service: 'Zebra VisibilityIQ Mock API',
      version: '2.0.0',
      status: 'healthy',
      endpoints: Object.keys(endpoints).length,
      timestamp: new Date().toISOString(),
    });
  }

  // API docs
  if (rawPath === '/api-docs' || rawPath === '/v2/api-docs') {
    const defaultTenant = 'e112b779-b0e8-4c01-b146-2920330121d6';
    return json(200, {
      apis: Object.keys(endpoints).map((ep) => ({
        endpoint: ep,
        url: `/zebra/${defaultTenant}/v2/data/devices/operation/analytics/visibility/${ep}`,
      })),
    });
  }

  // Parse path to extract tenant and endpoint
  const { tenantId, endpoint } = parsePath(rawPath);

  // Auth check (skip for token endpoints)
  if (!endpoint.includes('oauth/token') && !endpoint.includes('credentials/token')) {
    const authError = await validateAuth(headers);
    if (authError) {
      return json(401, { error: authError });
    }
  }

  // Resolve tenant: from URL path > header > default
  const tenant = tenantId || headers['tenant'] || 'e112b779-b0e8-4c01-b146-2920330121d6';

  // Find matching endpoint handler
  const handler = endpoints[endpoint];
  if (handler) {
    try {
      let body: any;
      if (event.body) {
        try { body = JSON.parse(event.body); } catch { body = event.body; }
      }
      return await handler(params, tenant, body);
    } catch (err: any) {
      console.error('Handler error:', err);
      return json(500, { error: 'Internal server error', message: err.message });
    }
  }

  // Try prefix matching for sub-paths
  for (const [key, fn] of Object.entries(endpoints)) {
    if (endpoint.startsWith(key)) {
      try {
        let body: any;
        if (event.body) {
          try { body = JSON.parse(event.body); } catch { body = event.body; }
        }
        return await fn(params, tenant, body);
      } catch (err: any) {
        console.error('Handler error:', err);
        return json(500, { error: 'Internal server error', message: err.message });
      }
    }
  }

  return json(404, {
    error: `Route not found: ${method} ${rawPath}`,
    hint: 'Use /zebra/{tenant-uuid}/v2/data/devices/operation/analytics/visibility/{endpoint}',
    availableEndpoints: '/api-docs',
  });
}
