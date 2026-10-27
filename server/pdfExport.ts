import type { ReadingSummary } from "./reporting";
import { format } from "date-fns";

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character]!,
  );
}

// PDF generation types
export interface DeviceReportData {
  summary?: ReadingSummary;
  metadata?: {
    scope: string;
    statisticsComplete: boolean;
    totalReadings: number;
    totalIncidents: number;
    returnedIncidents: number;
    hasMoreIncidents: boolean;
    incidentDetailLimit: number;
    truncated: boolean;
  };
  device: {
    id: number;
    deviceId: string;
    name: string;
    type: string;
    status: string;
    zone: string | null;
    location: string | null;
    firmwareVersion: string | null;
    lastSeen: Date | null;
  };
  readings: {
    timestamp: number;
    temperature: number | null;
    humidity: number | null;
    vibration: number | null;
    power: number | null;
    rpm: number | null;
    pressure: number | null;
  }[];
  thresholds: {
    metric: string;
    minValue: number | null;
    maxValue: number | null;
    warningMin: number | null;
    warningMax: number | null;
    enabled: boolean;
  }[];
  alerts: {
    id: number;
    message: string;
    severity: string;
    status: string;
    createdAt: Date;
  }[];
  dateRange: {
    start: Date;
    end: Date;
  };
}

export interface AssetAnalyticsReportData {
  metadata?: {
    scope: string;
    intervalMs: number;
    total: number;
    returned: number;
    truncated: boolean;
    unitPolicy: string;
  };
  assetCount: number;
  sampleCount: number;
  avgPower: number | null;
  avgTemperature: number | null;
  avgVibration: number | null;
  assets: {
    name: string;
    assetType: string;
    zone: string | null;
    sampleCount: number;
  }[];
  timeline: {
    timestamp: number;
    avgPower: number | null;
    avgTemperature: number | null;
    avgHumidity: number | null;
    avgVibration: number | null;
    count: number;
  }[];
  dateRange: {
    start: Date;
    end: Date;
  };
}

export interface AlertHistoryReportData {
  metadata?: {
    total: number;
    returned: number;
    hasMore: boolean;
    truncated: boolean;
    scope: unknown;
    statisticsComplete: boolean;
    detailLimit: number;
  };
  alerts: {
    id: number;
    deviceName: string;
    errorCode: string;
    message: string;
    type: string;
    severity: string;
    status: string;
    createdAt: Date;
    assignedToId: number | null;
    downtimeStartedAt: Date | null;
    resolvedAt: Date | null;
  }[];
  summary: {
    total: number;
    critical: number;
    warning: number;
    info: number;
    resolved: number;
  };
  dateRange: {
    start: Date;
    end: Date;
  };
}

// Generate HTML for PDF conversion
export function generateDeviceReportHtml(data: DeviceReportData): string {
  const { device, readings, thresholds, alerts, dateRange } = data;

  // Calculate statistics from readings
  const stats = data.summary?.metrics ?? calculateReadingStats(readings);

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body {
      font-family: 'Segoe UI', Arial, sans-serif;
      color: #1a1a2e;
      line-height: 1.6;
      padding: 40px;
      max-width: 800px;
      margin: 0 auto;
    }
    .header {
      border-bottom: 3px solid #3b82f6;
      padding-bottom: 20px;
      margin-bottom: 30px;
    }
    .header h1 {
      margin: 0;
      color: #1a1a2e;
      font-size: 28px;
    }
    .header .subtitle {
      color: #64748b;
      font-size: 14px;
      margin-top: 5px;
    }
    .section {
      margin-bottom: 30px;
    }
    .section h2 {
      color: #3b82f6;
      font-size: 18px;
      border-bottom: 1px solid #e2e8f0;
      padding-bottom: 10px;
      margin-bottom: 15px;
    }
    .info-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 15px;
    }
    .info-item {
      background: #f8fafc;
      padding: 12px;
      border-radius: 8px;
    }
    .info-item .label {
      font-size: 12px;
      color: #64748b;
      text-transform: uppercase;
    }
    .info-item .value {
      font-size: 16px;
      font-weight: 600;
      color: #1a1a2e;
    }
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 15px;
    }
    .stat-card {
      background: #f8fafc;
      padding: 15px;
      border-radius: 8px;
      text-align: center;
    }
    .stat-card .metric {
      font-size: 12px;
      color: #64748b;
      text-transform: uppercase;
    }
    .stat-card .value {
      font-size: 24px;
      font-weight: 700;
      color: #3b82f6;
    }
    .stat-card .range {
      font-size: 11px;
      color: #94a3b8;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 10px;
    }
    th, td {
      padding: 10px;
      text-align: left;
      border-bottom: 1px solid #e2e8f0;
    }
    th {
      background: #f8fafc;
      font-weight: 600;
      font-size: 12px;
      text-transform: uppercase;
      color: #64748b;
    }
    .status-badge {
      display: inline-block;
      padding: 4px 8px;
      border-radius: 4px;
      font-size: 12px;
      font-weight: 500;
    }
    .status-online { background: #dcfce7; color: #166534; }
    .status-offline { background: #f1f5f9; color: #475569; }
    .status-critical { background: #fee2e2; color: #991b1b; }
    .status-warning { background: #fef3c7; color: #92400e; }
    .status-info { background: #dbeafe; color: #1e40af; }
    .footer {
      margin-top: 40px;
      padding-top: 20px;
      border-top: 1px solid #e2e8f0;
      font-size: 12px;
      color: #94a3b8;
      text-align: center;
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>Device Report: ${escapeHtml(device.name)}</h1>
    <div class="subtitle">
      Generated on ${format(new Date(), "MMMM d, yyyy 'at' HH:mm")} | 
      Data from ${format(dateRange.start, "MMM d, yyyy")} to ${format(dateRange.end, "MMM d, yyyy")}
    </div>
  </div>

  <div class="section">
    <h2>Device Information</h2>
    <div class="info-grid">
      <div class="info-item">
        <div class="label">Device ID</div>
        <div class="value">${escapeHtml(device.deviceId)}</div>
      </div>
      <div class="info-item">
        <div class="label">Type</div>
        <div class="value">${escapeHtml(device.type)}</div>
      </div>
      <div class="info-item">
        <div class="label">Status</div>
        <div class="value"><span class="status-badge status-${escapeHtml(device.status)}">${escapeHtml(device.status)}</span></div>
      </div>
      <div class="info-item">
        <div class="label">Firmware</div>
        <div class="value">${escapeHtml(device.firmwareVersion ?? "N/A")}</div>
      </div>
      <div class="info-item">
        <div class="label">Zone</div>
        <div class="value">${escapeHtml(device.zone ?? "N/A")}</div>
      </div>
      <div class="info-item">
        <div class="label">Location</div>
        <div class="value">${escapeHtml(device.location ?? "N/A")}</div>
      </div>
    </div>
  </div>

  <div class="section">
    <h2>Sensor Statistics (${data.summary?.total ?? readings.length} readings)</h2>
    <p>${data.summary ? `Full-range statistics. Evidence scope: ${escapeHtml(data.summary.scope)}. Only reviewed canonical units with good source quality enter averages. Missing values remain unavailable.` : "Statistics describe only the supplied detail rows; completeness was not attested."}</p>
    <div class="stats-grid">
      ${
        stats.temperature
          ? `
      <div class="stat-card">
        <div class="metric">Temperature</div>
        <div class="value">${stats.temperature.avg.toFixed(1)}°C</div>
        <div class="range">${stats.temperature.min.toFixed(1)} - ${stats.temperature.max.toFixed(1)}°C</div>
      </div>
      `
          : ""
      }
      ${
        stats.humidity
          ? `
      <div class="stat-card">
        <div class="metric">Humidity</div>
        <div class="value">${stats.humidity.avg.toFixed(1)}%</div>
        <div class="range">${stats.humidity.min.toFixed(1)} - ${stats.humidity.max.toFixed(1)}%</div>
      </div>
      `
          : ""
      }
      ${
        stats.power
          ? `
      <div class="stat-card">
        <div class="metric">Power</div>
        <div class="value">${stats.power.avg.toFixed(0)}W</div>
        <div class="range">${stats.power.min.toFixed(0)} - ${stats.power.max.toFixed(0)}W</div>
      </div>
      `
          : ""
      }
      ${
        stats.vibration
          ? `
      <div class="stat-card">
        <div class="metric">Vibration</div>
        <div class="value">${stats.vibration.avg.toFixed(2)}</div>
        <div class="range">${stats.vibration.min.toFixed(2)} - ${stats.vibration.max.toFixed(2)}</div>
      </div>
      `
          : ""
      }
      ${
        stats.rpm
          ? `
      <div class="stat-card">
        <div class="metric">RPM</div>
        <div class="value">${stats.rpm.avg.toFixed(0)}</div>
        <div class="range">${stats.rpm.min.toFixed(0)} - ${stats.rpm.max.toFixed(0)}</div>
      </div>
      `
          : ""
      }
      ${
        stats.pressure
          ? `
      <div class="stat-card">
        <div class="metric">Pressure</div>
        <div class="value">${stats.pressure.avg.toFixed(2)} Pa</div>
        <div class="range">${stats.pressure.min.toFixed(2)} - ${stats.pressure.max.toFixed(2)} Pa</div>
      </div>
      `
          : ""
      }
    </div>
  </div>

  ${
    thresholds.length > 0
      ? `
  <div class="section">
    <h2>Alert Thresholds</h2>
    <table>
      <thead>
        <tr>
          <th>Metric</th>
          <th>Critical Min</th>
          <th>Critical Max</th>
          <th>Warning Min</th>
          <th>Warning Max</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        ${thresholds
          .map(
            (t) => `
        <tr>
          <td>${escapeHtml(t.metric)}</td>
          <td>${t.minValue ?? "—"}</td>
          <td>${t.maxValue ?? "—"}</td>
          <td>${t.warningMin ?? "—"}</td>
          <td>${t.warningMax ?? "—"}</td>
          <td>${t.enabled ? "Enabled" : "Disabled"}</td>
        </tr>
        `,
          )
          .join("")}
      </tbody>
    </table>
  </div>
  `
      : ""
  }

  ${
    alerts.length > 0
      ? `
  <div class="section">
    <h2>Incident details (${alerts.length} returned; ${data.metadata?.totalIncidents ?? alerts.length} total in period)</h2>
    <table>
      <thead>
        <tr>
          <th>Time</th>
          <th>Severity</th>
          <th>Message</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        ${alerts
          .map(
            (a) => `
        <tr>
          <td>${format(new Date(a.createdAt), "MMM d, HH:mm")}</td>
          <td><span class="status-badge status-${escapeHtml(a.severity)}">${escapeHtml(a.severity)}</span></td>
          <td>${escapeHtml(a.message)}</td>
          <td>${escapeHtml(a.status)}</td>
        </tr>
        `,
          )
          .join("")}
      </tbody>
    </table>
  </div>
  `
      : ""
  }

  <div class="footer">
    ${data.metadata ? `Incident detail limit: ${data.metadata.incidentDetailLimit}. ${data.metadata.hasMoreIncidents ? "Additional matching incidents are available through the paginated incident queue." : "All matching incident details are included."}` : ""}<br>
    Smart Factory IoT Dashboard | Device Report
  </div>
</body>
</html>
  `;
}

export function generateAssetAnalyticsReportHtml(
  data: AssetAnalyticsReportData,
): string {
  const {
    assetCount,
    sampleCount,
    avgPower,
    avgTemperature,
    avgVibration,
    assets,
    timeline,
    dateRange,
  } = data;
  const escapeHtml = (value: string) =>
    value.replace(
      /[&<>"']/g,
      (character) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[character]!,
    );
  const display = (value: number | null, digits = 1) =>
    value === null ? "—" : value.toFixed(digits);
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body{font:14px/1.55 'Segoe UI',Arial,sans-serif;color:#172033;padding:36px;max-width:900px;margin:auto}
    header{border-bottom:3px solid #2563eb;padding-bottom:16px;margin-bottom:24px}h1{margin:0;font-size:26px}
    .muted{color:#64748b}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:20px 0}
    .card{background:#f1f5f9;border-radius:8px;padding:14px}.label{font-size:11px;text-transform:uppercase;color:#64748b}
    .value{font-size:22px;font-weight:700;margin-top:4px}section{margin:26px 0}h2{font-size:17px;color:#1d4ed8}
    table{width:100%;border-collapse:collapse;margin-top:10px}th,td{text-align:left;padding:9px;border-bottom:1px solid #e2e8f0}
    th{font-size:11px;text-transform:uppercase;color:#64748b;background:#f8fafc}.footer{border-top:1px solid #e2e8f0;padding-top:14px;margin-top:32px;color:#64748b;font-size:12px}
    @media print{body{padding:16px}.grid{grid-template-columns:repeat(2,1fr)}}
  </style>
</head>
<body>
  <header>
    <h1>Asset Telemetry Report</h1>
    <div class="muted">
      Generated on ${format(new Date(), "MMMM d, yyyy 'at' HH:mm")} | 
      Data from ${format(dateRange.start, "MMM d, yyyy")} to ${format(dateRange.end, "MMM d, yyyy")}
    </div>
  </header>
  <div class="grid">
    <div class="card"><div class="label">Assets in scope</div><div class="value">${assetCount}</div></div>
    <div class="card"><div class="label">Samples</div><div class="value">${sampleCount}</div></div>
    <div class="card"><div class="label">Average power (W)</div><div class="value">${display(avgPower, 0)}</div></div>
    <div class="card"><div class="label">Average temperature (°C)</div><div class="value">${display(avgTemperature)}</div></div>
  </div>
  <section><h2>Assets in scope</h2>
    <table><thead><tr><th>Asset</th><th>Type</th><th>Zone</th><th>Samples</th></tr></thead><tbody>
      ${assets.map((asset) => `<tr><td>${escapeHtml(asset.name)}</td><td>${escapeHtml(asset.assetType)}</td><td>${escapeHtml(asset.zone ?? "—")}</td><td>${asset.sampleCount}</td></tr>`).join("") || '<tr><td colspan="4">No assets matched this selection.</td></tr>'}
    </tbody></table>
  </section>
  ${
    timeline.length > 0
      ? `
  <section>
    <h2>Telemetry averages by interval</h2><p>Complete displayed bucket series: ${timeline.length} buckets. ${data.metadata ? `Scope: ${escapeHtml(data.metadata.scope)}. Effective interval: ${data.metadata.intervalMs} ms. Full-range statistics cover ${data.metadata.total} stored observations. ${escapeHtml(data.metadata.unitPolicy)}` : "Legacy report scope and completeness were not attested."} UTC window: ${escapeHtml(dateRange.start.toISOString())} to ${escapeHtml(dateRange.end.toISOString())}.</p>
    <table>
      <thead>
        <tr>
          <th>Time Period</th>
          <th>Avg Power (W)</th>
          <th>Avg Temp (°C)</th>
          <th>Avg Humidity (%)</th>
          <th>Avg Vibration (mm/s)</th>
          <th>Samples</th>
        </tr>
      </thead>
      <tbody>
        ${timeline
          .map(
            (d) => `
        <tr>
          <td>${new Date(d.timestamp).toISOString()}</td>
          <td>${display(d.avgPower, 0)}</td>
          <td>${display(d.avgTemperature)}</td>
          <td>${display(d.avgHumidity)}</td>
          <td>${display(d.avgVibration, 2)}</td>
          <td>${d.count}</td>
        </tr>
        `,
          )
          .join("")}
      </tbody>
    </table>
  </section>
  `
      : ""
  }

  <div class="footer">
    Smart Factory IoT Dashboard | Asset telemetry report · vibration average ${display(avgVibration, 2)}
  </div>
</body>
</html>
  `;
}

export function generateAlertHistoryReportHtml(
  data: AlertHistoryReportData,
): string {
  const { alerts, summary, dateRange } = data;
  const escapeHtml = (value: string) =>
    value.replace(
      /[&<>"']/g,
      (character) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[character] ?? character,
    );
  const duration = (seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
  };

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body {
      font-family: 'Segoe UI', Arial, sans-serif;
      color: #1a1a2e;
      line-height: 1.6;
      padding: 40px;
      max-width: 800px;
      margin: 0 auto;
    }
    @page { size: A4 landscape; margin: 12mm; }
    .header {
      border-bottom: 3px solid #f59e0b;
      padding-bottom: 20px;
      margin-bottom: 30px;
    }
    .header h1 {
      margin: 0;
      color: #1a1a2e;
      font-size: 28px;
    }
    .header .subtitle {
      color: #64748b;
      font-size: 14px;
      margin-top: 5px;
    }
    .section {
      margin-bottom: 30px;
    }
    .section h2 {
      color: #f59e0b;
      font-size: 18px;
      border-bottom: 1px solid #e2e8f0;
      padding-bottom: 10px;
      margin-bottom: 15px;
    }
    .summary-grid {
      display: grid;
      grid-template-columns: repeat(5, 1fr);
      gap: 15px;
    }
    .summary-card {
      background: #f8fafc;
      padding: 15px;
      border-radius: 8px;
      text-align: center;
    }
    .summary-card .label {
      font-size: 12px;
      color: #64748b;
      text-transform: uppercase;
    }
    .summary-card .value {
      font-size: 24px;
      font-weight: 700;
    }
    .summary-card.critical .value { color: #ef4444; }
    .summary-card.warning .value { color: #f59e0b; }
    .summary-card.info .value { color: #3b82f6; }
    .summary-card.resolved .value { color: #10b981; }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 10px;
    }
    th, td {
      padding: 10px;
      text-align: left;
      border-bottom: 1px solid #e2e8f0;
      font-size: 13px;
    }
    th {
      background: #f8fafc;
      font-weight: 600;
      font-size: 11px;
      text-transform: uppercase;
      color: #64748b;
    }
    .status-badge {
      display: inline-block;
      padding: 3px 6px;
      border-radius: 4px;
      font-size: 11px;
      font-weight: 500;
    }
    .status-critical { background: #fee2e2; color: #991b1b; }
    .status-warning { background: #fef3c7; color: #92400e; }
    .status-info { background: #dbeafe; color: #1e40af; }
    .status-active { background: #fee2e2; color: #991b1b; }
    .status-acknowledged { background: #fef3c7; color: #92400e; }
    .status-resolved { background: #dcfce7; color: #166534; }
    .footer {
      margin-top: 40px;
      padding-top: 20px;
      border-top: 1px solid #e2e8f0;
      font-size: 12px;
      color: #94a3b8;
      text-align: center;
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>Alert History Report</h1>
    <div class="subtitle">
      Generated on ${format(new Date(), "MMMM d, yyyy 'at' HH:mm")} | 
      Data from ${format(dateRange.start, "MMM d, yyyy")} to ${format(dateRange.end, "MMM d, yyyy")}
    </div>
  </div>

  <div class="section">
    <h2>Summary</h2>
    <div class="summary-grid">
      <div class="summary-card">
        <div class="label">Total</div>
        <div class="value">${summary.total}</div>
      </div>
      <div class="summary-card critical">
        <div class="label">Critical</div>
        <div class="value">${summary.critical}</div>
      </div>
      <div class="summary-card warning">
        <div class="label">Warning</div>
        <div class="value">${summary.warning}</div>
      </div>
      <div class="summary-card info">
        <div class="label">Info</div>
        <div class="value">${summary.info}</div>
      </div>
      <div class="summary-card resolved">
        <div class="label">Resolved</div>
        <div class="value">${summary.resolved}</div>
      </div>
    </div>
  </div>

  <div class="section">
    <h2>Alert Details (${alerts.length} returned / ${summary.total} total)</h2>
    <table>
      <thead>
        <tr>
          <th>Time</th>
          <th>Device</th>
          <th>Error code</th>
          <th>Severity</th>
          <th>Message</th>
          <th>Assigned engineer ID</th>
          <th>Downtime</th>
          <th>Resolution</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        ${alerts
          .map(
            (a) => `
        <tr>
          <td>${format(new Date(a.createdAt), "MMM d, HH:mm")}</td>
          <td>${escapeHtml(a.deviceName)}</td>
          <td>${escapeHtml(a.errorCode)}</td>
          <td><span class="status-badge status-${escapeHtml(a.severity)}">${escapeHtml(a.severity)}</span></td>
          <td>${escapeHtml(a.message)}<br><small>${escapeHtml(a.type.replace(/_/g, " "))}</small></td>
          <td>${a.assignedToId ?? "Unassigned"}</td>
          <td>${a.downtimeStartedAt ? format(new Date(a.downtimeStartedAt), "MMM d, HH:mm") : "Not recorded"}</td>
          <td>${a.downtimeStartedAt && a.resolvedAt ? duration(Math.max(0, Math.floor((new Date(a.resolvedAt).getTime() - new Date(a.downtimeStartedAt).getTime()) / 1000))) : "—"}</td>
          <td><span class="status-badge status-${escapeHtml(a.status)}">${escapeHtml(a.status)}</span></td>
        </tr>
        `,
          )
          .join("")}
      </tbody>
    </table>
  </div>

  <div class="footer">
    ${data.metadata ? `Full-range statistics; detail limit ${data.metadata.detailLimit}; returned ${data.metadata.returned} of ${data.metadata.total}; ${data.metadata.truncated ? "details truncated; use the paginated queue for the remainder" : "all matching details included"}.` : "Completeness is not attested for supplied rows."}<br>Smart Factory IoT Dashboard | Alert History Report
  </div>
</body>
</html>
  `;
}

// Helper function to calculate statistics from readings
function calculateReadingStats(readings: DeviceReportData["readings"]) {
  const stats: Record<
    string,
    { min: number; max: number; avg: number; count: number } | null
  > = {
    temperature: null,
    humidity: null,
    vibration: null,
    power: null,
    rpm: null,
    pressure: null,
  };

  const metrics = [
    "temperature",
    "humidity",
    "vibration",
    "power",
    "rpm",
    "pressure",
  ] as const;

  for (const metric of metrics) {
    const values = readings
      .map((r) => r[metric])
      .filter((v): v is number => v !== null && v !== undefined);

    if (values.length > 0) {
      stats[metric] = {
        min: Math.min(...values),
        max: Math.max(...values),
        avg: values.reduce((a, b) => a + b, 0) / values.length,
        count: values.length,
      };
    }
  }

  return stats;
}
