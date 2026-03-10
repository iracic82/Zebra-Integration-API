import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  BatchWriteCommand,
} from '@aws-sdk/lib-dynamodb';

const client = new DynamoDBClient({});
const ddb = DynamoDBDocumentClient.from(client);
const TABLE = process.env.TABLE_NAME!;
const TENANT = 'e112b779-b0e8-4c01-b146-2920330121d6';

// ─── Helpers ────────────────────────────────────────────────────
function randomFrom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomDate(daysBack: number): string {
  const d = new Date();
  d.setDate(d.getDate() - Math.floor(Math.random() * daysBack));
  return d.toISOString();
}

function randomHex(len: number): string {
  return Array.from({ length: len }, () =>
    Math.floor(Math.random() * 16).toString(16).toUpperCase()
  ).join('');
}

function randomMac(): string {
  // Zebra OUI prefix 00:A0:C6
  return `00:A0:C6:${randomHex(2)}:${randomHex(2)}:${randomHex(2)}`;
}

function randomBssid(): string {
  return Array.from({ length: 6 }, () => randomHex(2)).join(':');
}

function randomImei(): string {
  return `35462709${randomInt(1000000, 9999999)}`;
}

// ─── Site Definitions ───────────────────────────────────────────
const SITES = [
  { name: 'NYC Distribution Center', state: 'New York', tz: 'EST', lat: '40.7128', lng: '-74.0060', code: 'NYC' },
  { name: 'Chicago Warehouse', state: 'Illinois', tz: 'CST', lat: '41.8781', lng: '-87.6298', code: 'CHI' },
  { name: 'Dallas Fulfillment Hub', state: 'Texas', tz: 'CST', lat: '32.7767', lng: '-96.7970', code: 'DAL' },
  { name: 'LA Retail Store 412', state: 'California', tz: 'PST', lat: '34.0522', lng: '-118.2437', code: 'LAX' },
  { name: 'Seattle Cold Storage', state: 'Washington', tz: 'PST', lat: '47.6062', lng: '-122.3321', code: 'SEA' },
  { name: 'Miami Port Terminal', state: 'Florida', tz: 'EST', lat: '25.7617', lng: '-80.1918', code: 'MIA' },
  { name: 'Phoenix Assembly Plant', state: 'Arizona', tz: 'MST', lat: '33.4484', lng: '-112.0740', code: 'PHX' },
  { name: 'Denver Grocery Store 88', state: 'Colorado', tz: 'MST', lat: '39.7392', lng: '-104.9903', code: 'DEN' },
  { name: 'Boston Medical Center', state: 'Massachusetts', tz: 'EST', lat: '42.3601', lng: '-71.0589', code: 'BOS' },
  { name: 'Atlanta Sorting Facility', state: 'Georgia', tz: 'EST', lat: '33.7490', lng: '-84.3880', code: 'ATL' },
  { name: 'Houston Logistics Hub', state: 'Texas', tz: 'CST', lat: '29.7604', lng: '-95.3698', code: 'HOU' },
  { name: 'San Francisco DC', state: 'California', tz: 'PST', lat: '37.7749', lng: '-122.4194', code: 'SFO' },
];

const COMPANY = 'Acme Corp';

// ─── Device Models ──────────────────────────────────────────────
interface DeviceModel {
  model: string;
  fullModel: string;
  deviceType: string;
  category: 'mc' | 'printer' | 'scanner';
}

const DEVICE_MODELS: DeviceModel[] = [
  { model: 'TC58', fullModel: 'TC58HO-1PEZU4P-US', deviceType: 'Mobile Computer', category: 'mc' },
  { model: 'TC52', fullModel: 'TC520K-1PEZU4P-NA', deviceType: 'Mobile Computer', category: 'mc' },
  { model: 'MC93', fullModel: 'MC930B-GSEEG4NA', deviceType: 'Ultra-Rugged Mobile Computer', category: 'mc' },
  { model: 'TC21', fullModel: 'TC210K-01B212-NA', deviceType: 'Touch Computer', category: 'mc' },
  { model: 'TC73', fullModel: 'TC73B0-3T4J1B0-NA', deviceType: 'Rugged Touch Computer', category: 'mc' },
  { model: 'ET40', fullModel: 'ET40AB-001C1B0-NA', deviceType: 'Enterprise Tablet', category: 'mc' },
  { model: 'WT6300', fullModel: 'WT63B0-TS0QNERW', deviceType: 'Wearable Computer', category: 'mc' },
  { model: 'PS20', fullModel: 'PS20J-B2C1US00', deviceType: 'Personal Shopper', category: 'mc' },
  { model: 'MC3300x', fullModel: 'MC330X-GJ4EG4NA', deviceType: 'Rugged Mobile Computer', category: 'mc' },
  { model: 'MC9300', fullModel: 'MC930B-GSAEG4NA', deviceType: 'Ultra-Rugged Mobile Computer', category: 'mc' },
  { model: 'TC72', fullModel: 'TC720L-0MJ24B0-NA', deviceType: 'Touch Computer', category: 'mc' },
  { model: 'EC50', fullModel: 'EC500K-01B222-NA', deviceType: 'Enterprise Computer', category: 'mc' },
  { model: 'ET45', fullModel: 'ET45AB-001C1B0-A6', deviceType: 'Enterprise Tablet', category: 'mc' },
  { model: 'TC57', fullModel: 'TC57HO-1PEZU4P-NA', deviceType: 'Mobile Computer', category: 'mc' },
  { model: 'DS8178', fullModel: 'DS8178-SR7U2100SFW', deviceType: 'Handheld Scanner', category: 'scanner' },
  { model: 'DS3608', fullModel: 'DS3608-SR00003VZWW', deviceType: 'Ultra-Rugged Scanner', category: 'scanner' },
  { model: 'LI3608', fullModel: 'LI3608-SR3U4600VZW', deviceType: 'Linear Scanner', category: 'scanner' },
  { model: 'DS9908', fullModel: 'DS9908-SR00004ZZWW', deviceType: 'Presentation Scanner', category: 'scanner' },
  { model: 'ZT411', fullModel: 'ZT41142-T010000Z', deviceType: 'Industrial Printer', category: 'printer' },
  { model: 'ZT421', fullModel: 'ZT42162-T010000Z', deviceType: 'Industrial Printer', category: 'printer' },
  { model: 'ZD621', fullModel: 'ZD6A042-301F00EZ', deviceType: 'Desktop Printer', category: 'printer' },
  { model: 'ZQ630', fullModel: 'ZQ63-AUWA004-00', deviceType: 'Mobile Printer', category: 'printer' },
  { model: 'ZT610', fullModel: 'ZT61042-T010100Z', deviceType: 'Industrial Printer', category: 'printer' },
];

const OS_VERSIONS = ['Android 10', 'Android 11', 'Android 12', 'Android 13', 'Android 14'];
const STATUSES = ['In-Use', 'In-Use', 'In-Use', 'In-Use', 'Available', 'Maintenance', 'Decommissioned'];
const NETWORK_TYPES = ['WiFi 5', 'WiFi 6', 'WiFi 6', 'WiFi 6E', '5G', 'Bluetooth 5.0'];
const CONTRACT_TYPES = ['ZBR-ENT', 'ZBR-SMB', 'ZBR-MFG', 'ZBR-RET', 'ZBR-HLT', 'ZBR-LOG'];

const BATTERY_HEALTH = ['Good', 'Good', 'Good', 'Fair', 'Replace Soon', 'Critical'];
const FAULT_CODES = [
  'DISPLAY_CRACK', 'BATTERY_FAIL', 'WIFI_MODULE', 'SCANNER_FAIL',
  'KEYPAD_WORN', 'USB_PORT', 'TOUCH_SCREEN', 'POWER_BUTTON',
  'SPEAKER_FAIL', 'CAMERA_FAIL',
];

const APPS = [
  { name: 'Warehouse Management', category: 'Business' },
  { name: 'Inventory Scanner', category: 'Business' },
  { name: 'Pick & Pack', category: 'Business' },
  { name: 'Shipping Label', category: 'Business' },
  { name: 'Chrome Browser', category: 'Non-Business' },
  { name: 'Settings', category: 'Non-Business' },
  { name: 'Teams', category: 'Business' },
  { name: 'Workforce Connect', category: 'Business' },
];

const SYMBOLOGIES = ['Code128', 'Code39', 'QRCode', 'DataMatrix', 'EAN13', 'UPC-A', 'PDF417', 'Interleaved2of5'];

const PRINTER_SETTINGS = ['darkness', 'speed', 'mediaType', 'printWidth', 'printMode', 'tearOff', 'labelLength'];
const ALERT_TYPES = ['HEAD_OPEN', 'PAPER_OUT', 'RIBBON_OUT', 'HEAD_COLD', 'HEAD_OVER_TEMP', 'CUTTER_JAM', 'MEDIA_JAM'];

// ─── Generators ─────────────────────────────────────────────────
function generateSerialNum(model: string, index: number): string {
  const year = randomFrom(['22', '23', '24', '25']);
  const dayOfYear = String(randomInt(1, 365)).padStart(3, '0');
  const modelCode = model.replace(/[^A-Z0-9]/gi, '').slice(0, 4).toUpperCase();
  const seq = String(index).padStart(4, '0');
  return `${year}${dayOfYear}${modelCode}${seq}`;
}

function generateAssetName(model: string, site: typeof SITES[0], index: number): string {
  const seq = String(index).padStart(3, '0');
  const yearStr = randomFrom(['2022', '2023', '2024', '2025']);
  return `ZBR-${model.slice(0, 4).toUpperCase()}-${yearStr}${site.code}${seq}`;
}

function generateLgVersion(): string {
  return `${randomInt(8, 12)}.${randomInt(0, 8)}.${randomInt(0, 4)}.${randomInt(0, 9)}`;
}

function generateContractId(): string {
  const type = randomFrom(CONTRACT_TYPES);
  const year = randomFrom(['2022', '2023', '2024', '2025']);
  return `${type}-${year}-${String(randomInt(1000, 99999)).padStart(5, '0')}`;
}

function generateDevices(count: number) {
  const items: any[] = [];
  for (let i = 0; i < count; i++) {
    const dm = randomFrom(DEVICE_MODELS);
    const site = randomFrom(SITES);
    const status = randomFrom(STATUSES);
    const serialNum = generateSerialNum(dm.model, i + 1);
    const os = dm.category === 'mc' ? randomFrom(OS_VERSIONS) : undefined;
    const ipOctet3 = randomInt(15, 25);
    const ipOctet4 = randomInt(1, 254);

    items.push({
      PK: `TENANT#${TENANT}#DEVICE`,
      SK: `DEVICE#${serialNum}`,
      GSI1PK: `SITE#${site.name}`,
      GSI1SK: `DEVICE#${serialNum}`,
      GSI2PK: `MODEL#${dm.model}`,
      GSI2SK: `DEVICE#${serialNum}`,
      // Real Zebra fields
      serialNum,
      model: dm.model,
      fullModel: dm.fullModel,
      deviceType: dm.deviceType,
      os: os || (dm.category === 'printer' ? 'Link-OS 6' : undefined),
      status,
      siteName: site.name,
      siteHierarchy: `${COMPANY}/North America/USA/${site.tz}/${site.state}/${site.name}`,
      assetName: generateAssetName(dm.model, site, i + 1),
      contractId: generateContractId(),
      macAddress: randomMac(),
      bssid: randomBssid(),
      imei: dm.category === 'mc' ? randomImei() : undefined,
      ipAddr: `10.42.${ipOctet3}.${ipOctet4}`,
      phoneNum: dm.category === 'mc' ? parseInt(`1555${randomInt(1000000, 9999999)}`) : undefined,
      lgVersion: dm.category === 'mc' ? generateLgVersion() : undefined,
      gpsCoordinates: `${site.lat},${site.lng}`,
      networkConnectionType: randomFrom(NETWORK_TYPES),
      // Internal fields for other generators
      _category: dm.category,
      _siteObj: site,
    });
  }
  return items;
}

function generateBatteries(devices: any[]) {
  const items: any[] = [];
  const mcDevices = devices.filter((d) => d._category === 'mc');

  for (const device of mcDevices) {
    const batSerial = `BAT${randomHex(10)}`;
    items.push({
      PK: `TENANT#${TENANT}#BATTERY`,
      SK: `BATTERY#${device.serialNum}`,
      GSI1PK: `SITE#${device.siteName}`,
      GSI1SK: `BATTERY#${device.serialNum}`,
      serialNum: device.serialNum,
      model: device.model,
      siteName: device.siteName,
      batterySerialNum: batSerial,
      batteryLevel: randomInt(5, 100),
      voltage: (3.2 + Math.random() * 1.0).toFixed(2),
      capacity: randomInt(2000, 5000),
      healthStatus: randomFrom(BATTERY_HEALTH),
      predictedRemainingLife: randomInt(30, 730),
      dischargeRate: (Math.random() * 15 + 2).toFixed(1),
      swapCount: randomInt(0, 50),
      lastReportedDate: randomDate(1),
    });
  }
  return items;
}

function generateBatterySwaps(devices: any[]) {
  const items: any[] = [];
  const mcDevices = devices.filter((d) => d._category === 'mc').slice(0, 30);

  for (const device of mcDevices) {
    for (let s = 0; s < randomInt(1, 5); s++) {
      items.push({
        PK: `TENANT#${TENANT}#BATTERY_SWAP`,
        SK: `SWAP#${device.serialNum}#${s}`,
        GSI1PK: `SITE#${device.siteName}`,
        GSI1SK: `SWAP#${device.serialNum}#${s}`,
        serialNum: device.serialNum,
        model: device.model,
        siteName: device.siteName,
        swapDate: randomDate(30),
        batteryLevelBefore: randomInt(5, 25),
        batteryLevelAfter: randomInt(80, 100),
      });
    }
  }
  return items;
}

function generateAppAnalytics(devices: any[]) {
  const items: any[] = [];
  const siteNames = [...new Set(devices.map((d) => d.siteName))];
  for (const siteName of siteNames) {
    for (const app of APPS) {
      items.push({
        PK: `TENANT#${TENANT}#APP_ANALYTICS`,
        SK: `APP#${siteName}#${app.name}`,
        GSI1PK: `SITE#${siteName}`,
        GSI1SK: `APP#${app.name}`,
        applicationName: app.name,
        applicationVersion: `${randomInt(1, 5)}.${randomInt(0, 9)}.${randomInt(0, 20)}`,
        category: app.category,
        totalMinutesUsed: randomInt(100, 50000),
        siteName,
        reportDate: randomDate(1),
      });
    }
  }
  return items;
}

function generateDisruptions(devices: any[]) {
  const items: any[] = [];
  const mcDevices = devices.filter((d) => d._category === 'mc').slice(0, 40);

  for (const device of mcDevices) {
    items.push({
      PK: `TENANT#${TENANT}#DISRUPTION`,
      SK: `DISRUPTION#${device.serialNum}`,
      GSI1PK: `SITE#${device.siteName}`,
      GSI1SK: `DISRUPTION#${device.serialNum}`,
      serialNum: device.serialNum,
      model: device.model,
      siteName: device.siteName,
      rebootCount: randomInt(0, 20),
      anrCount: randomInt(0, 10),
      source: randomFrom(['USER', 'SYSTEM', 'APPLICATION']),
      reportDate: randomDate(7),
    });
  }
  return items;
}

function generateMemory(devices: any[]) {
  const items: any[] = [];
  const mcDevices = devices.filter((d) => d._category === 'mc').slice(0, 50);

  for (const device of mcDevices) {
    items.push({
      PK: `TENANT#${TENANT}#MEMORY`,
      SK: `MEMORY#RAM#${device.serialNum}`,
      GSI1PK: `SITE#${device.siteName}`,
      GSI1SK: `MEMORY#RAM#${device.serialNum}`,
      serialNum: device.serialNum, model: device.model, siteName: device.siteName,
      memoryType: 'RAM', totalMB: randomFrom([2048, 3072, 4096]),
      usedMB: randomInt(500, 3500), utilizationPercent: randomInt(20, 95),
      thresholdExceeded: Math.random() > 0.8, reportDate: randomDate(1),
    });
    items.push({
      PK: `TENANT#${TENANT}#MEMORY`,
      SK: `MEMORY#STORAGE#${device.serialNum}`,
      GSI1PK: `SITE#${device.siteName}`,
      GSI1SK: `MEMORY#STORAGE#${device.serialNum}`,
      serialNum: device.serialNum, model: device.model, siteName: device.siteName,
      memoryType: 'STORAGE', totalMB: randomFrom([16384, 32768, 65536]),
      usedMB: randomInt(2000, 60000), utilizationPercent: randomInt(10, 90),
      thresholdExceeded: Math.random() > 0.85, reportDate: randomDate(1),
    });
  }
  return items;
}

function generateScanMetrics(devices: any[]) {
  const items: any[] = [];
  const mcDevices = devices.filter((d) => d._category === 'mc').slice(0, 40);

  for (const device of mcDevices) {
    items.push({
      PK: `TENANT#${TENANT}#SCAN`,
      SK: `SCAN#${device.serialNum}`,
      GSI1PK: `SITE#${device.siteName}`,
      GSI1SK: `SCAN#${device.serialNum}`,
      serialNum: device.serialNum, model: device.model, siteName: device.siteName,
      successfulScans: randomInt(100, 50000),
      unsuccessfulScans: randomInt(0, 500),
      topSymbology: randomFrom(SYMBOLOGIES),
      symbologyBreakdown: SYMBOLOGIES.slice(0, 4).map((s) => ({ symbology: s, count: randomInt(10, 5000) })),
      reportDate: randomDate(7),
    });
  }
  return items;
}

function generateUtilization(devices: any[]) {
  const siteNames = [...new Set(devices.map((d) => d.siteName))];
  return siteNames.map((siteName) => ({
    PK: `TENANT#${TENANT}#UTILIZATION`,
    SK: `UTIL#${siteName}`,
    GSI1PK: `SITE#${siteName}`,
    GSI1SK: `UTIL#${siteName}`,
    siteName,
    totalDevices: randomInt(20, 200),
    utilizedDevices: randomInt(15, 180),
    unutilizedDevices: randomInt(0, 30),
    utilizationPercent: randomInt(60, 98),
    recommendedAction: Math.random() > 0.7 ? 'REDUCE_FLEET' : 'OPTIMAL',
    reportDate: randomDate(1),
  }));
}

function generateWlan(devices: any[]) {
  const items: any[] = [];
  const mcDevices = devices.filter((d) => d._category === 'mc').slice(0, 30);

  for (const device of mcDevices) {
    items.push({
      PK: `TENANT#${TENANT}#WLAN`,
      SK: `WLAN#${device.serialNum}`,
      GSI1PK: `SITE#${device.siteName}`,
      GSI1SK: `WLAN#${device.serialNum}`,
      serialNum: device.serialNum, siteName: device.siteName,
      accessPointBSSID: randomBssid(),
      accessPointFriendlyName: `AP-${device.siteName.replace(/\s/g, '-')}-${randomInt(1, 20)}`,
      signalStrength: -randomInt(30, 85),
      channel: randomFrom([1, 6, 11, 36, 40, 44, 48]),
      reportDate: randomDate(1),
    });
  }
  return items;
}

function generatePrinterUtils(devices: any[]) {
  const printers = devices.filter((d) => d._category === 'printer');
  return printers.map((p) => ({
    PK: `TENANT#${TENANT}#PRINTER_UTIL`,
    SK: `PRUTIL#${p.serialNum}`,
    GSI1PK: `SITE#${p.siteName}`,
    GSI1SK: `PRUTIL#${p.serialNum}`,
    serialNum: p.serialNum, model: p.model, siteName: p.siteName,
    lengthPrintedMeters: randomInt(100, 100000),
    labelsPrinted: randomInt(500, 500000),
    reportDate: randomDate(7),
  }));
}

function generatePrinterSettings(devices: any[]) {
  const items: any[] = [];
  const printers = devices.filter((d) => d._category === 'printer').slice(0, 15);

  for (const printer of printers) {
    for (let c = 0; c < randomInt(1, 4); c++) {
      const setting = randomFrom(PRINTER_SETTINGS);
      items.push({
        PK: `TENANT#${TENANT}#PRINTER_SETTINGS`,
        SK: `PRSETTING#${printer.serialNum}#${c}`,
        GSI1PK: `SITE#${printer.siteName}`,
        GSI1SK: `PRSETTING#${printer.serialNum}#${c}`,
        serialNum: printer.serialNum, model: printer.model, siteName: printer.siteName,
        settingName: setting, previousValue: `old_${setting}_value`,
        newValue: `new_${setting}_value`,
        changedBy: randomFrom(['USER', 'SYSTEM', 'REMOTE']),
        changeDate: randomDate(30),
      });
    }
  }
  return items;
}

function generatePrinterAlerts(devices: any[]) {
  const items: any[] = [];
  const printers = devices.filter((d) => d._category === 'printer').slice(0, 20);

  for (const printer of printers) {
    for (let a = 0; a < randomInt(0, 3); a++) {
      items.push({
        PK: `TENANT#${TENANT}#PRINTER_ALERT`,
        SK: `PRALERT#${printer.serialNum}#${a}`,
        GSI1PK: `SITE#${printer.siteName}`,
        GSI1SK: `PRALERT#${printer.serialNum}#${a}`,
        serialNum: printer.serialNum, model: printer.model, siteName: printer.siteName,
        alertType: randomFrom(ALERT_TYPES),
        severity: randomFrom(['WARNING', 'CRITICAL']),
        alertDate: randomDate(14),
        clearedWithinThreshold: Math.random() > 0.3,
        clearedDate: Math.random() > 0.2 ? randomDate(7) : undefined,
      });
    }
  }
  return items;
}

function generateContracts(devices: any[]) {
  const contracts = [
    { id: generateContractId(), level: 'OneCare Essential', days: 90 },
    { id: generateContractId(), level: 'OneCare Select', days: 200 },
    { id: generateContractId(), level: 'OneCare SV', days: 400 },
    { id: generateContractId(), level: 'VisibilityIQ Foresight', days: 180 },
    { id: generateContractId(), level: 'OneCare Essential', days: -30 },
  ];

  return contracts.map((contract) => {
    const expDate = new Date();
    expDate.setDate(expDate.getDate() + contract.days);
    const assigned = devices.slice(0, randomInt(10, 30)).map((d) => d.serialNum);
    return {
      PK: `TENANT#${TENANT}#CONTRACT`,
      SK: `CONTRACT#${contract.id}`,
      GSI1PK: `CONTRACT_STATUS#${contract.days > 0 ? 'ACTIVE' : 'EXPIRED'}`,
      GSI1SK: `CONTRACT#${contract.id}`,
      contractId: contract.id, serviceLevel: contract.level,
      status: contract.days > 0 ? 'ACTIVE' : 'EXPIRED',
      expirationDate: expDate.toISOString(),
      expirationBucket: contract.days <= 0 ? 'EXPIRED' : contract.days <= 90 ? '0-90d' : contract.days <= 179 ? '91-179d' : '180+d',
      serialNumbers: assigned, deviceCount: assigned.length,
    };
  });
}

function generateCases(devices: any[]) {
  const items: any[] = [];
  for (let i = 0; i < 25; i++) {
    const openDays = randomInt(0, 120);
    const closed = Math.random() > 0.4;
    const site = randomFrom(devices);
    items.push({
      PK: `TENANT#${TENANT}#CASE`,
      SK: `CASE#CSE-${String(i + 1).padStart(4, '0')}`,
      GSI1PK: `CASE_STATUS#${closed ? 'CLOSED' : 'OPEN'}`,
      GSI1SK: `CASE#CSE-${String(i + 1).padStart(4, '0')}`,
      caseId: `CSE-${String(i + 1).padStart(4, '0')}`,
      caseType: randomFrom(['TECHNICAL', 'NON_TECHNICAL']),
      status: closed ? 'CLOSED' : 'OPEN',
      openDate: randomDate(openDays),
      closeDate: closed ? randomDate(Math.max(0, openDays - randomInt(1, 30))) : undefined,
      agingDays: closed ? randomInt(1, openDays || 1) : openDays,
      agingBucket: openDays < 30 ? '0-29d' : openDays < 90 ? '30-89d' : '90+d',
      siteName: site.siteName,
      description: `Mock case for device issue - ${randomFrom(FAULT_CODES)}`,
    });
  }
  return items;
}

function generateRepairs(devices: any[]) {
  const items: any[] = [];
  for (let i = 0; i < 40; i++) {
    const device = randomFrom(devices);
    items.push({
      PK: `TENANT#${TENANT}#REPAIR`,
      SK: `REPAIR#RMA-${String(i + 1).padStart(4, '0')}`,
      GSI1PK: `SITE#${device.siteName}`,
      GSI1SK: `REPAIR#RMA-${String(i + 1).padStart(4, '0')}`,
      rmaNumber: `RMA-${String(i + 1).padStart(4, '0')}`,
      repairStatus: randomFrom(['RECEIVED', 'IN_PROGRESS', 'SHIPPED', 'COMPLETED']),
      siteName: device.siteName,
      faultCode: randomFrom(FAULT_CODES),
      problemDescription: `Device requires repair - ${randomFrom(FAULT_CODES)}`,
      shipDate: randomDate(30), dueDate: randomDate(14),
      onTimeDelivery: Math.random() > 0.15,
      ntf: Math.random() > 0.8,
      damageIndicator: Math.random() > 0.85,
      repeatRepair: Math.random() > 0.9,
      serialNum: device.serialNum,
    });
  }
  return items;
}

function generateLifeGuard(devices: any[]) {
  const mcDevices = devices.filter((d) => d._category === 'mc').slice(0, 30);
  return mcDevices.map((device) => ({
    PK: `TENANT#${TENANT}#LIFEGUARD`,
    SK: `LIFEGUARD#${device.serialNum}`,
    GSI1PK: `SITE#${device.siteName}`,
    GSI1SK: `LIFEGUARD#${device.serialNum}`,
    serialNum: device.serialNum, model: device.model, siteName: device.siteName,
    currentPatchLevel: device.lgVersion,
    latestAvailablePatch: '12.1.0.3',
    patchStatus: Math.random() > 0.3 ? 'UP_TO_DATE' : 'UPDATE_AVAILABLE',
    recommendedUpdate: Math.random() > 0.3 ? null : `LG-U${randomInt(10, 50)}-${device.model}`,
    lastChecked: randomDate(1),
  }));
}

function generatePredictiveInsights(devices: any[]) {
  return devices.slice(0, 15).map((device) => ({
    PK: `TENANT#${TENANT}#PREDICTIVE`,
    SK: `PREDICT#${device.serialNum}`,
    GSI1PK: `SITE#${device.siteName}`,
    GSI1SK: `PREDICT#${device.serialNum}`,
    serialNum: device.serialNum, model: device.model, siteName: device.siteName,
    alertCategory: randomFrom(['BATTERY_DEGRADATION', 'HARDWARE_FAILURE', 'CONNECTIVITY_ISSUE', 'PERFORMANCE_DEGRADATION', 'END_OF_LIFE']),
    severity: randomFrom(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']),
    predictedIssue: randomFrom([
      'Battery replacement needed within 30 days',
      'Display failure likely within 60 days',
      'WiFi module degradation detected',
      'Storage approaching capacity',
      'Device approaching end of useful life',
    ]),
    confidence: (Math.random() * 0.4 + 0.6).toFixed(2),
    reportDate: randomDate(7),
  }));
}

// ─── Batch Write Helper ─────────────────────────────────────────
async function batchWrite(items: any[]) {
  const batches: any[][] = [];
  for (let i = 0; i < items.length; i += 25) {
    batches.push(items.slice(i, i + 25));
  }

  for (const batch of batches) {
    await ddb.send(
      new BatchWriteCommand({
        RequestItems: {
          [TABLE]: batch.map((item) => ({
            PutRequest: { Item: item },
          })),
        },
      })
    );
  }
}

// ─── Main Seed Handler ──────────────────────────────────────────
export async function handler(event: any) {
  console.log('Seeding Zebra VisibilityIQ mock data...');

  const devices = generateDevices(100);
  console.log(`Generated ${devices.length} devices`);
  await batchWrite(devices);

  const allData = [
    ...generateBatteries(devices),
    ...generateBatterySwaps(devices),
    ...generateAppAnalytics(devices),
    ...generateDisruptions(devices),
    ...generateMemory(devices),
    ...generateScanMetrics(devices),
    ...generateUtilization(devices),
    ...generateWlan(devices),
    ...generatePrinterUtils(devices),
    ...generatePrinterSettings(devices),
    ...generatePrinterAlerts(devices),
    ...generateContracts(devices),
    ...generateCases(devices),
    ...generateRepairs(devices),
    ...generateLifeGuard(devices),
    ...generatePredictiveInsights(devices),
  ];

  console.log(`Generated ${allData.length} additional records`);
  await batchWrite(allData);

  const totalRecords = devices.length + allData.length;
  console.log(`Seed complete: ${totalRecords} total records`);

  return {
    statusCode: 200,
    body: JSON.stringify({ message: 'Seed complete', totalRecords }),
  };
}
