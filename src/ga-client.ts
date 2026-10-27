import { v1beta as adminV1beta } from "@google-analytics/admin";
import type { protos as adminProtos } from "@google-analytics/admin";
import { v1beta as dataV1beta } from "@google-analytics/data";
import { protos as dataProtos } from "@google-analytics/data";
import { OAuth2Client } from "google-auth-library";

// Use the stable v1beta APIs (the packages' default Admin export is v1alpha)
const { AnalyticsAdminServiceClient } = adminV1beta;
const { BetaAnalyticsDataClient } = dataV1beta;
type AnalyticsAdminServiceClient = InstanceType<typeof AnalyticsAdminServiceClient>;
type BetaAnalyticsDataClient = InstanceType<typeof BetaAnalyticsDataClient>;

type IRunReportRequest = dataProtos.google.analytics.data.v1beta.IRunReportRequest;
type IRunRealtimeReportRequest =
  dataProtos.google.analytics.data.v1beta.IRunRealtimeReportRequest;
type IFilterExpression = dataProtos.google.analytics.data.v1beta.IFilterExpression;
type IDimensionHeader = dataProtos.google.analytics.data.v1beta.IDimensionHeader;
type IMetricHeader = dataProtos.google.analytics.data.v1beta.IMetricHeader;
type IRow = dataProtos.google.analytics.data.v1beta.IRow;
type ITimestamp = adminProtos.google.protobuf.ITimestamp;

export interface PropertySummary {
  propertyId: string;
  displayName: string;
  propertyType: string;
}

export interface AccountSummary {
  accountId: string;
  displayName: string;
  properties: PropertySummary[];
}

export interface OrderBy {
  dimension?: string;
  metric?: string;
  desc?: boolean;
}

export interface ReportQuery {
  propertyId: string;
  dateRanges: { startDate: string; endDate: string; name?: string }[];
  dimensions: string[];
  metrics: string[];
  dimensionFilter?: IFilterExpression;
  metricFilter?: IFilterExpression;
  orderBys?: OrderBy[];
  limit: number;
  offset: number;
  includeTotals: boolean;
}

export interface RealtimeQuery {
  propertyId: string;
  dimensions: string[];
  metrics: string[];
  dimensionFilter?: IFilterExpression;
  metricFilter?: IFilterExpression;
  orderBys?: OrderBy[];
  minuteRanges?: { startMinutesAgo?: number; endMinutesAgo?: number; name?: string }[];
  limit: number;
}

export interface ReportResult {
  rowCount: number;
  returnedRows: number;
  rows: Record<string, string | number>[];
  totals?: Record<string, string | number>[];
  notes?: string[];
}

export interface CustomDefinition {
  apiName: string;
  uiName: string;
  description?: string;
  category?: string;
  type?: string;
}

/**
 * Accept "123456789" or "properties/123456789" and return the bare ID.
 */
export function normalizePropertyId(propertyId: string): string {
  const id = propertyId.trim().replace(/^properties\//, "");
  if (!/^\d+$/.test(id)) {
    throw new Error(
      `"${propertyId}" is not a GA4 property ID. Use the numeric ID (e.g. "123456789"); ga_list_properties lists the IDs you can access.`
    );
  }
  return id;
}

function lastSegment(resourceName: string | null | undefined): string {
  return (resourceName || "").split("/").pop() || "";
}

function timestampToIso(ts: ITimestamp | null | undefined): string | undefined {
  if (!ts?.seconds) return undefined;
  return new Date(Number(ts.seconds) * 1000).toISOString();
}

function toOrderBys(orderBys: OrderBy[] | undefined) {
  return orderBys?.map((o) => {
    if (o.metric) {
      return { metric: { metricName: o.metric }, desc: o.desc ?? false };
    }
    if (o.dimension) {
      return { dimension: { dimensionName: o.dimension }, desc: o.desc ?? false };
    }
    throw new Error("Each orderBys entry needs either a dimension or a metric name.");
  });
}

const NUMERIC_METRIC_TYPES = new Set([
  "TYPE_INTEGER",
  "TYPE_FLOAT",
  "TYPE_SECONDS",
  "TYPE_MILLISECONDS",
  "TYPE_MINUTES",
  "TYPE_HOURS",
  "TYPE_STANDARD",
  "TYPE_CURRENCY",
  "TYPE_FEET",
  "TYPE_MILES",
  "TYPE_METERS",
  "TYPE_KILOMETERS",
]);

/**
 * Flatten GA's header/row arrays into plain objects keyed by API name,
 * with numeric metrics converted to numbers.
 */
function flattenRows(
  rows: IRow[] | null | undefined,
  dimensionHeaders: IDimensionHeader[] | null | undefined,
  metricHeaders: IMetricHeader[] | null | undefined
): Record<string, string | number>[] {
  const dims = dimensionHeaders || [];
  const mets = metricHeaders || [];
  return (rows || []).map((row) => {
    const out: Record<string, string | number> = {};
    dims.forEach((h, i) => {
      out[h.name || `dimension${i}`] = row.dimensionValues?.[i]?.value ?? "";
    });
    mets.forEach((h, i) => {
      const raw = row.metricValues?.[i]?.value ?? "";
      const type = String(h.type || "");
      out[h.name || `metric${i}`] =
        NUMERIC_METRIC_TYPES.has(type) && raw !== "" ? Number(raw) : raw;
    });
    return out;
  });
}

export class GAClient {
  private admin: AnalyticsAdminServiceClient;
  private data: BetaAnalyticsDataClient;

  constructor(auth: OAuth2Client) {
    this.admin = new AnalyticsAdminServiceClient({ authClient: auth });
    this.data = new BetaAnalyticsDataClient({ authClient: auth });
  }

  async listAccountSummaries(): Promise<AccountSummary[]> {
    const accounts: AccountSummary[] = [];
    for await (const summary of this.admin.listAccountSummariesAsync(
      { pageSize: 200 },
      { autoPaginate: false }
    )) {
      accounts.push({
        accountId: lastSegment(summary.account),
        displayName: summary.displayName || "",
        properties: (summary.propertySummaries || []).map((p) => ({
          propertyId: lastSegment(p.property),
          displayName: p.displayName || "",
          propertyType: String(p.propertyType || ""),
        })),
      });
    }
    return accounts;
  }

  async getProperty(propertyId: string) {
    const id = normalizePropertyId(propertyId);
    const [property] = await this.admin.getProperty({ name: `properties/${id}` });

    const dataStreams: { name: string; type: string; websiteUrl?: string; measurementId?: string }[] = [];
    for await (const stream of this.admin.listDataStreamsAsync(
      { parent: `properties/${id}` },
      { autoPaginate: false }
    )) {
      dataStreams.push({
        name: stream.displayName || "",
        type: String(stream.type || ""),
        websiteUrl: stream.webStreamData?.defaultUri || undefined,
        measurementId: stream.webStreamData?.measurementId || undefined,
      });
    }

    return {
      propertyId: id,
      displayName: property.displayName,
      accountId: lastSegment(property.account),
      propertyType: property.propertyType,
      timeZone: property.timeZone,
      currencyCode: property.currencyCode,
      industryCategory: property.industryCategory,
      serviceLevel: property.serviceLevel,
      createTime: timestampToIso(property.createTime),
      dataStreams,
    };
  }

  async runReport(query: ReportQuery): Promise<ReportResult> {
    const id = normalizePropertyId(query.propertyId);
    const request: IRunReportRequest = {
      property: `properties/${id}`,
      dateRanges: query.dateRanges,
      dimensions: query.dimensions.map((name) => ({ name })),
      metrics: query.metrics.map((name) => ({ name })),
      dimensionFilter: query.dimensionFilter,
      metricFilter: query.metricFilter,
      orderBys: toOrderBys(query.orderBys),
      limit: query.limit,
      offset: query.offset,
      metricAggregations: query.includeTotals
        ? [dataProtos.google.analytics.data.v1beta.MetricAggregation.TOTAL]
        : undefined,
    };
    const [response] = await this.data.runReport(request);

    const rows = flattenRows(response.rows, response.dimensionHeaders, response.metricHeaders);
    const rowCount = response.rowCount ?? rows.length;
    const notes: string[] = [];
    if (rowCount > query.offset + rows.length) {
      notes.push(
        `Showing rows ${query.offset + 1}-${query.offset + rows.length} of ${rowCount}. Use offset to page through the rest.`
      );
    }
    if (response.metadata?.subjectToThresholding) {
      notes.push("Some rows may be withheld by GA4 thresholding (common with demographic or low-volume data).");
    }
    if (response.metadata?.samplingMetadatas?.length) {
      notes.push("This report is based on sampled data.");
    }
    if (response.metadata?.dataLossFromOtherRow) {
      notes.push('Some low-volume values were grouped into an "(other)" row.');
    }

    return {
      rowCount,
      returnedRows: rows.length,
      rows,
      totals: query.includeTotals
        ? flattenRows(response.totals, response.dimensionHeaders, response.metricHeaders)
        : undefined,
      notes: notes.length ? notes : undefined,
    };
  }

  async runRealtimeReport(query: RealtimeQuery): Promise<ReportResult> {
    const id = normalizePropertyId(query.propertyId);
    const request: IRunRealtimeReportRequest = {
      property: `properties/${id}`,
      dimensions: query.dimensions.map((name) => ({ name })),
      metrics: query.metrics.map((name) => ({ name })),
      dimensionFilter: query.dimensionFilter,
      metricFilter: query.metricFilter,
      orderBys: toOrderBys(query.orderBys),
      minuteRanges: query.minuteRanges,
      limit: query.limit,
    };
    const [response] = await this.data.runRealtimeReport(request);

    const rows = flattenRows(response.rows, response.dimensionHeaders, response.metricHeaders);
    return {
      rowCount: response.rowCount ?? rows.length,
      returnedRows: rows.length,
      rows,
    };
  }

  async getMetadata(propertyId: string, includeStandard: boolean) {
    const id = normalizePropertyId(propertyId);
    const [metadata] = await this.data.getMetadata({ name: `properties/${id}/metadata` });

    const dimensions: CustomDefinition[] = (metadata.dimensions || [])
      .filter((d) => includeStandard || d.customDefinition)
      .map((d) => ({
        apiName: d.apiName || "",
        uiName: d.uiName || "",
        description: d.description || undefined,
        category: d.category || undefined,
      }));
    const metrics: CustomDefinition[] = (metadata.metrics || [])
      .filter((m) => includeStandard || m.customDefinition)
      .map((m) => ({
        apiName: m.apiName || "",
        uiName: m.uiName || "",
        description: m.description || undefined,
        category: m.category || undefined,
        type: m.type ? String(m.type) : undefined,
      }));

    return { propertyId: id, dimensions, metrics };
  }
}

/**
 * Turn Google API errors into messages a non-developer can act on.
 * gRPC status codes: 3 INVALID_ARGUMENT, 5 NOT_FOUND, 7 PERMISSION_DENIED,
 * 8 RESOURCE_EXHAUSTED, 16 UNAUTHENTICATED.
 */
export function friendlyGoogleError(error: unknown): string {
  const err = error as { code?: number | string; message?: string; details?: string };
  const message = err?.message || String(error);
  const lower = message.toLowerCase();

  if (lower.includes("invalid_grant")) {
    return "Google rejected the refresh token (invalid_grant). It may have been revoked, expired (tokens from OAuth apps in 'Testing' status expire after 7 days), or created with a different OAuth client. Run `npm run setup-auth` again and update GOOGLE_REFRESH_TOKEN.";
  }
  if (lower.includes("invalid_client") || lower.includes("unauthorized_client")) {
    return "Google rejected the OAuth client. Check that GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET match the client the refresh token was created with.";
  }
  if (lower.includes("has not been used in project") || lower.includes("service_disabled") || lower.includes("is disabled")) {
    return `The Google Analytics API is not enabled for this Google Cloud project. Enable both the "Google Analytics Data API" and "Google Analytics Admin API" in Google Cloud Console (APIs & Services > Library), wait a few minutes, then retry. Details: ${message}`;
  }

  switch (err?.code) {
    case 7:
    case 403:
      return `Permission denied (403). The Google account behind this server needs at least Viewer access on this GA4 property (GA4 Admin > Property access management). Double-check the property ID too. Details: ${message}`;
    case 16:
    case 401:
      return `Google authentication failed (401). The refresh token may be revoked or invalid; run \`npm run setup-auth\` again and update GOOGLE_REFRESH_TOKEN. Details: ${message}`;
    case 5:
    case 404:
      return `Not found. Check the property ID (use ga_list_properties to see valid IDs). Details: ${message}`;
    case 3:
    case 400:
      return `Google Analytics rejected the request: ${message}. Check dimension and metric names (ga_get_metadata lists the valid ones), that they are compatible with each other, and that dates use YYYY-MM-DD, "today", "yesterday" or "NdaysAgo".`;
    case 8:
    case 429:
      return `Google Analytics quota exhausted for this property (too many or too heavy requests). Wait a while, then retry with a shorter date range or fewer dimensions. Details: ${message}`;
  }
  return message;
}
