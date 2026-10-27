import { z } from "zod";
import { GAClient, friendlyGoogleError } from "./ga-client.js";

const DEFAULT_ROW_LIMIT = 100;
const MAX_ROW_LIMIT = 1000;

const PROPERTY_ID_DESCRIPTION =
  "Numeric GA4 property ID, e.g. '123456789' ('properties/123456789' also works). Get IDs from ga_list_properties.";

// GA4 FilterExpression JSON, passed through to the Data API as-is
const filterExpressionSchema = z.record(z.string(), z.any());

const FILTER_DESCRIPTION = `GA4 FilterExpression JSON. Examples:
- Exact match: {"filter":{"fieldName":"sessionDefaultChannelGroup","stringFilter":{"matchType":"EXACT","value":"Organic Search"}}}
- Contains: {"filter":{"fieldName":"landingPage","stringFilter":{"matchType":"CONTAINS","value":"/blog/"}}}
- One of: {"filter":{"fieldName":"country","inListFilter":{"values":["United States","Canada"]}}}
- Combine: {"andGroup":{"expressions":[<filter>,<filter>]}} (also "orGroup", or {"notExpression":<filter>})
- Numeric (metricFilter only): {"filter":{"fieldName":"sessions","numericFilter":{"operation":"GREATER_THAN","value":{"int64Value":"100"}}}}
matchType options: EXACT, BEGINS_WITH, ENDS_WITH, CONTAINS, FULL_REGEXP, PARTIAL_REGEXP.`;

const orderBySchema = z.object({
  dimension: z.string().optional(),
  metric: z.string().optional(),
  desc: z.boolean().optional(),
});

// Zod schemas for tool parameters
export const listPropertiesSchema = z.object({});

export const getPropertySchema = z.object({
  propertyId: z.string(),
});

export const runReportSchema = z.object({
  propertyId: z.string(),
  dateRanges: z
    .array(
      z.object({
        startDate: z.string(),
        endDate: z.string(),
        name: z.string().optional(),
      })
    )
    .min(1)
    .max(4)
    .optional()
    .default([{ startDate: "28daysAgo", endDate: "yesterday" }]),
  dimensions: z.array(z.string()).max(9).optional().default([]),
  metrics: z.array(z.string()).min(1).max(10),
  dimensionFilter: filterExpressionSchema.optional(),
  metricFilter: filterExpressionSchema.optional(),
  orderBys: z.array(orderBySchema).optional(),
  limit: z.number().int().min(1).max(MAX_ROW_LIMIT).optional().default(DEFAULT_ROW_LIMIT),
  offset: z.number().int().min(0).optional().default(0),
  includeTotals: z.boolean().optional().default(false),
});

export const runRealtimeReportSchema = z.object({
  propertyId: z.string(),
  dimensions: z.array(z.string()).max(9).optional().default([]),
  metrics: z.array(z.string()).min(1).max(10).optional().default(["activeUsers"]),
  dimensionFilter: filterExpressionSchema.optional(),
  metricFilter: filterExpressionSchema.optional(),
  orderBys: z.array(orderBySchema).optional(),
  minuteRanges: z
    .array(
      z.object({
        startMinutesAgo: z.number().int().min(0).max(59).optional(),
        endMinutesAgo: z.number().int().min(0).max(59).optional(),
        name: z.string().optional(),
      })
    )
    .max(2)
    .optional(),
  limit: z.number().int().min(1).max(MAX_ROW_LIMIT).optional().default(DEFAULT_ROW_LIMIT),
});

export const getMetadataSchema = z.object({
  propertyId: z.string(),
  includeStandard: z.boolean().optional().default(false),
});

const filterJsonSchema = {
  type: "object",
  description: FILTER_DESCRIPTION,
};

const orderBysJsonSchema = {
  type: "array",
  description:
    "Sort order. Each entry names ONE dimension or metric from this request, e.g. [{\"metric\":\"sessions\",\"desc\":true}] or [{\"dimension\":\"date\"}].",
  items: {
    type: "object",
    properties: {
      dimension: { type: "string" },
      metric: { type: "string" },
      desc: { type: "boolean", description: "Descending order (default false)" },
    },
  },
};

export const TOOL_DEFINITIONS = [
  {
    name: "ga_list_properties",
    description:
      "List all Google Analytics 4 accounts and properties this server can read, with their numeric property IDs. Call this first when you don't know the property ID, or to match a website/client name to a property.",
    inputSchema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "ga_get_property",
    description:
      "Get details for one GA4 property: display name, time zone, currency, industry, creation date, and its data streams (including the website URL and measurement ID). Useful to confirm which site a property tracks and which time zone 'today'/'yesterday' refer to.",
    inputSchema: {
      type: "object" as const,
      properties: {
        propertyId: { type: "string", description: PROPERTY_ID_DESCRIPTION },
      },
      required: ["propertyId"],
    },
  },
  {
    name: "ga_run_report",
    description: `Run a Google Analytics 4 report (Data API runReport) for historical data. Returns one row per combination of dimension values, with the requested metrics.

Pick dimensions (how to break data down) and metrics (what to count) by their API names. Common choices:
- Traffic sources / channels: sessionDefaultChannelGroup (Organic Search, Paid Search, Direct, Referral, Organic Social, Email...), sessionSource, sessionMedium, sessionSourceMedium, sessionCampaignName. For how NEW users were acquired use firstUserDefaultChannelGroup / firstUserSourceMedium.
- Pages: landingPage (first page of a session, path only; best for SEO/entry-page questions), pagePath, pageTitle, hostName.
- Time: date (YYYYMMDD), yearWeek, yearMonth, dayOfWeekName, hour.
- Audience / tech: country, region, city, deviceCategory, browser, operatingSystem, newVsReturning, language.
- Events: eventName. Ecommerce: itemName, transactionId.

Metrics:
- Traffic: sessions, activeUsers (what the GA4 UI calls "Users"), totalUsers, newUsers, screenPageViews, eventCount.
- Engagement: engagedSessions, engagementRate, bounceRate, averageSessionDuration (seconds), screenPageViewsPerSession, userEngagementDuration.
- Conversions: keyEvents (GA4 renamed "conversions" to "key events"; prefer keyEvents over the deprecated conversions), sessionKeyEventRate, userKeyEventRate. For one specific key event use keyEvents:<event_name>, e.g. keyEvents:generate_lead.
- Revenue: totalRevenue, purchaseRevenue, ecommercePurchases, transactions.

Tips: keep session-scoped dimensions (session*, landingPage) with session metrics, and first-user dimensions (firstUser*) with user metrics. Custom dimensions/metrics look like customEvent:<name> or customUser:<name>; use ga_get_metadata to list them. Dates accept YYYY-MM-DD, "today", "yesterday" or "NdaysAgo"; add a second date range to compare periods. Results default to ${DEFAULT_ROW_LIMIT} rows (max ${MAX_ROW_LIMIT}); use orderBys to get the top rows and offset to page.`,
    inputSchema: {
      type: "object" as const,
      properties: {
        propertyId: { type: "string", description: PROPERTY_ID_DESCRIPTION },
        dateRanges: {
          type: "array",
          description:
            "1-4 date ranges. Default: last 28 days ([{\"startDate\":\"28daysAgo\",\"endDate\":\"yesterday\"}]). With 2+ ranges a dateRange column is added to each row.",
          items: {
            type: "object",
            properties: {
              startDate: { type: "string", description: "YYYY-MM-DD, 'today', 'yesterday' or 'NdaysAgo'" },
              endDate: { type: "string", description: "YYYY-MM-DD, 'today', 'yesterday' or 'NdaysAgo'" },
              name: { type: "string", description: "Optional label, e.g. 'current' or 'previous'" },
            },
            required: ["startDate", "endDate"],
          },
        },
        dimensions: {
          type: "array",
          items: { type: "string" },
          description:
            "Up to 9 dimension API names, e.g. ['sessionDefaultChannelGroup'] or ['landingPage']. Omit for a single totals row.",
        },
        metrics: {
          type: "array",
          items: { type: "string" },
          description: "1-10 metric API names, e.g. ['sessions', 'activeUsers', 'keyEvents'].",
        },
        dimensionFilter: filterJsonSchema,
        metricFilter: {
          ...filterJsonSchema,
          description: "Filter applied after aggregation, on metric values. " + FILTER_DESCRIPTION,
        },
        orderBys: orderBysJsonSchema,
        limit: {
          type: "number",
          description: `Max rows to return (default ${DEFAULT_ROW_LIMIT}, max ${MAX_ROW_LIMIT})`,
        },
        offset: {
          type: "number",
          description: "Row offset for paging (default 0)",
        },
        includeTotals: {
          type: "boolean",
          description: "Also return a totals row across all rows (default false)",
        },
      },
      required: ["propertyId", "metrics"],
    },
  },
  {
    name: "ga_run_realtime_report",
    description: `Run a GA4 realtime report: activity in the last 30 minutes (up to 60 on GA4 360). Use for "right now" questions; use ga_run_report for anything historical.

Realtime supports a limited set of fields.
- Dimensions: country, city, deviceCategory, platform, unifiedScreenName (page title / screen name), eventName, minutesAgo, appVersion, audienceName.
- Metrics: activeUsers, screenPageViews, eventCount, keyEvents.
Default: activeUsers with no dimensions.`,
    inputSchema: {
      type: "object" as const,
      properties: {
        propertyId: { type: "string", description: PROPERTY_ID_DESCRIPTION },
        dimensions: {
          type: "array",
          items: { type: "string" },
          description: "Realtime dimension API names, e.g. ['country'] or ['unifiedScreenName']",
        },
        metrics: {
          type: "array",
          items: { type: "string" },
          description: "Realtime metric API names (default ['activeUsers'])",
        },
        dimensionFilter: filterJsonSchema,
        metricFilter: {
          ...filterJsonSchema,
          description: "Filter on metric values. " + FILTER_DESCRIPTION,
        },
        orderBys: orderBysJsonSchema,
        minuteRanges: {
          type: "array",
          description:
            "Optional 1-2 minute windows, e.g. [{\"startMinutesAgo\":4,\"endMinutesAgo\":0}] for the last 5 minutes. Default: last 30 minutes.",
          items: {
            type: "object",
            properties: {
              startMinutesAgo: { type: "number" },
              endMinutesAgo: { type: "number" },
              name: { type: "string" },
            },
          },
        },
        limit: {
          type: "number",
          description: `Max rows to return (default ${DEFAULT_ROW_LIMIT}, max ${MAX_ROW_LIMIT})`,
        },
      },
      required: ["propertyId"],
    },
  },
  {
    name: "ga_get_metadata",
    description:
      "List the custom dimensions and custom metrics defined on a GA4 property, with the exact API names to use in ga_run_report (e.g. customEvent:form_name, customUser:plan_type). Set includeStandard=true to list every dimension and metric available on the property (long output); use that to check an API name you're unsure of.",
    inputSchema: {
      type: "object" as const,
      properties: {
        propertyId: { type: "string", description: PROPERTY_ID_DESCRIPTION },
        includeStandard: {
          type: "boolean",
          description: "Include all standard GA4 dimensions and metrics too (default false: custom only)",
        },
      },
      required: ["propertyId"],
    },
  },
];

function textResult(value: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(value, null, 2),
      },
    ],
  };
}

export async function handleToolCall(
  client: GAClient,
  toolName: string,
  args: Record<string, unknown>
): Promise<{ content: { type: "text"; text: string }[]; isError?: boolean }> {
  try {
    switch (toolName) {
      case "ga_list_properties": {
        listPropertiesSchema.parse(args);
        const accounts = await client.listAccountSummaries();
        if (accounts.length === 0) {
          return textResult({
            accounts: [],
            note: "No GA4 accounts found. The Google account behind this server needs at least Viewer access on the GA4 properties you want to query.",
          });
        }
        return textResult({ accounts });
      }

      case "ga_get_property": {
        const params = getPropertySchema.parse(args);
        return textResult(await client.getProperty(params.propertyId));
      }

      case "ga_run_report": {
        const params = runReportSchema.parse(args);
        return textResult(await client.runReport(params));
      }

      case "ga_run_realtime_report": {
        const params = runRealtimeReportSchema.parse(args);
        return textResult(await client.runRealtimeReport(params));
      }

      case "ga_get_metadata": {
        const params = getMetadataSchema.parse(args);
        return textResult(await client.getMetadata(params.propertyId, params.includeStandard));
      }

      default:
        return {
          content: [
            {
              type: "text",
              text: `Unknown tool: ${toolName}`,
            },
          ],
          isError: true,
        };
    }
  } catch (error) {
    const message =
      error instanceof z.ZodError
        ? `Invalid arguments: ${error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ")}`
        : friendlyGoogleError(error);
    return {
      content: [
        {
          type: "text",
          text: `Error executing ${toolName}: ${message}`,
        },
      ],
      isError: true,
    };
  }
}
