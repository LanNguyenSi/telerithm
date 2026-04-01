export const openApiSpec = {
  openapi: "3.0.3",
  info: {
    title: "Telerithm API",
    version: "1.0.0",
    description: "AI-powered log analytics platform",
  },
  servers: [{ url: "/api/v1" }],
  paths: {
    "/health": {
      get: {
        summary: "Health check",
        tags: ["System"],
        responses: {
          200: {
            description: "All services healthy",
            content: { "application/json": { schema: { $ref: "#/components/schemas/HealthResponse" } } },
          },
          503: { description: "One or more services degraded" },
        },
      },
    },
    "/auth/register": {
      post: {
        summary: "Register a new user",
        tags: ["Auth"],
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/RegisterRequest" } } },
        },
        responses: {
          201: {
            description: "User registered",
            content: { "application/json": { schema: { $ref: "#/components/schemas/AuthResponse" } } },
          },
          400: { description: "Validation error or user exists" },
        },
      },
    },
    "/auth/login": {
      post: {
        summary: "Login with credentials",
        tags: ["Auth"],
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/LoginRequest" } } },
        },
        responses: {
          200: {
            description: "Login successful",
            content: { "application/json": { schema: { $ref: "#/components/schemas/AuthResponse" } } },
          },
          401: { description: "Invalid credentials" },
        },
      },
    },
    "/teams": {
      get: {
        summary: "List teams for authenticated user",
        tags: ["Teams"],
        security: [{ bearerAuth: [] }],
        responses: { 200: { description: "List of teams" }, 401: { description: "Unauthorized" } },
      },
      post: {
        summary: "Create a new team",
        tags: ["Teams"],
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/CreateTeamRequest" } } },
        },
        responses: { 201: { description: "Team created" }, 401: { description: "Unauthorized" } },
      },
    },
    "/sources": {
      get: {
        summary: "List log sources for a team",
        tags: ["Sources"],
        parameters: [{ name: "teamId", in: "query", required: true, schema: { type: "string" } }],
        responses: { 200: { description: "List of sources" } },
      },
      post: {
        summary: "Create a new log source",
        tags: ["Sources"],
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/CreateSourceRequest" } } },
        },
        responses: { 201: { description: "Source created" } },
      },
    },
    "/ingest/{sourceId}": {
      post: {
        summary: "Ingest log entries",
        tags: ["Ingest"],
        security: [{ apiKeyAuth: [] }],
        parameters: [{ name: "sourceId", in: "path", required: true, schema: { type: "string" } }],
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/IngestRequest" } } },
        },
        responses: {
          202: {
            description: "Logs accepted",
            content: { "application/json": { schema: { $ref: "#/components/schemas/IngestResponse" } } },
          },
          401: { description: "Missing API key" },
          403: { description: "Invalid API key" },
        },
      },
    },
    "/logs/search": {
      post: {
        summary: "Search logs",
        tags: ["Logs"],
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/SearchRequest" } } },
        },
        responses: {
          200: {
            description: "Search results",
            content: { "application/json": { schema: { $ref: "#/components/schemas/SearchResponse" } } },
          },
        },
      },
    },
    "/logs/context": {
      post: {
        summary: "Fetch surrounding events around an anchor log",
        tags: ["Logs"],
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/ContextRequest" } } },
        },
        responses: {
          200: {
            description: "Context events",
            content: { "application/json": { schema: { $ref: "#/components/schemas/ContextResponse" } } },
          },
        },
      },
    },
    "/logs": {
      get: {
        summary: "Query logs via GET",
        tags: ["Logs"],
        parameters: [
          { name: "teamId", in: "query", required: true, schema: { type: "string" } },
          { name: "query", in: "query", schema: { type: "string" } },
          { name: "queryType", in: "query", schema: { type: "string", enum: ["sql", "natural"] } },
          { name: "limit", in: "query", schema: { type: "integer", default: 100 } },
          { name: "offset", in: "query", schema: { type: "integer", default: 0 } },
        ],
        responses: { 200: { description: "Search results" } },
      },
    },
    "/query/natural": {
      post: {
        summary: "Translate natural language query to SQL",
        tags: ["Logs"],
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/NaturalQueryRequest" } } },
        },
        responses: { 200: { description: "Translated query" } },
      },
    },
    "/alerts/rules": {
      get: {
        summary: "List alert rules",
        tags: ["Alerts"],
        parameters: [{ name: "teamId", in: "query", required: true, schema: { type: "string" } }],
        responses: { 200: { description: "List of alert rules" } },
      },
    },
    "/alerts/incidents": {
      get: {
        summary: "List alert incidents",
        tags: ["Alerts"],
        parameters: [{ name: "teamId", in: "query", required: true, schema: { type: "string" } }],
        responses: { 200: { description: "List of incidents" } },
      },
    },
    "/dashboards/overview": {
      get: {
        summary: "Get dashboard overview metrics",
        tags: ["Dashboards"],
        parameters: [{ name: "teamId", in: "query", required: true, schema: { type: "string" } }],
        responses: { 200: { description: "Dashboard summary" } },
      },
    },
    "/stream/logs": {
      get: {
        summary: "Server-Sent Events log stream",
        tags: ["Streaming"],
        parameters: [
          { name: "teamId", in: "query", required: true, schema: { type: "string" } },
          { name: "sourceId", in: "query", schema: { type: "string" } },
          { name: "service", in: "query", schema: { type: "string" } },
          { name: "host", in: "query", schema: { type: "string" } },
          { name: "level", in: "query", schema: { type: "string" } },
          { name: "query", in: "query", schema: { type: "string" } },
        ],
        responses: { 200: { description: "SSE stream", content: { "text/event-stream": {} } } },
      },
    },
  },
  components: {
    securitySchemes: {
      bearerAuth: { type: "http", scheme: "bearer" },
      apiKeyAuth: { type: "apiKey", in: "header", name: "X-API-Key" },
    },
    schemas: {
      HealthResponse: {
        type: "object",
        properties: {
          status: { type: "string", enum: ["ok", "degraded"] },
          checks: {
            type: "object",
            properties: {
              postgres: { type: "string" },
              clickhouse: { type: "string" },
              redis: { type: "string" },
            },
          },
        },
      },
      RegisterRequest: {
        type: "object",
        required: ["email", "password", "name"],
        properties: {
          email: { type: "string", format: "email" },
          password: { type: "string", minLength: 6 },
          name: { type: "string", minLength: 2 },
        },
      },
      LoginRequest: {
        type: "object",
        required: ["email", "password"],
        properties: {
          email: { type: "string", format: "email" },
          password: { type: "string", minLength: 6 },
        },
      },
      AuthResponse: {
        type: "object",
        properties: {
          token: { type: "string" },
          user: {
            type: "object",
            properties: { id: { type: "string" }, email: { type: "string" }, name: { type: "string" } },
          },
        },
      },
      CreateTeamRequest: {
        type: "object",
        required: ["name", "slug"],
        properties: { name: { type: "string" }, slug: { type: "string", pattern: "^[a-z0-9-]+$" } },
      },
      CreateSourceRequest: {
        type: "object",
        required: ["teamId", "name", "type"],
        properties: {
          teamId: { type: "string" },
          name: { type: "string" },
          type: {
            type: "string",
            enum: ["HTTP", "SYSLOG_UDP", "SYSLOG_TCP", "FILEBEAT", "DOCKER", "CLOUDWATCH"],
          },
        },
      },
      IngestRequest: {
        type: "object",
        required: ["logs"],
        properties: {
          logs: { type: "array", minItems: 1, items: { oneOf: [{ type: "string" }, { type: "object" }] } },
          format: { type: "string", enum: ["json", "syslog_rfc3164", "syslog_rfc5424", "plain"] },
          batchId: { type: "string" },
        },
      },
      IngestResponse: {
        type: "object",
        properties: {
          accepted: { type: "integer" },
          rejected: { type: "integer" },
          errors: { type: "array" },
          batchId: { type: "string" },
        },
      },
      SearchRequest: {
        type: "object",
        required: ["teamId"],
        properties: {
          teamId: { type: "string" },
          sourceId: { type: "string" },
          startTime: { type: "string", format: "date-time" },
          endTime: { type: "string", format: "date-time" },
          query: { type: "string" },
          queryType: { type: "string", enum: ["sql", "natural"], default: "sql" },
          limit: { type: "integer", default: 100, maximum: 500 },
          offset: { type: "integer", default: 0 },
        },
      },
      ContextRequest: {
        type: "object",
        required: ["teamId", "sourceId", "timestamp"],
        properties: {
          teamId: { type: "string" },
          sourceId: { type: "string" },
          timestamp: { type: "string", format: "date-time" },
          before: { type: "integer", default: 20, minimum: 1, maximum: 100 },
          after: { type: "integer", default: 20, minimum: 1, maximum: 100 },
          scope: { type: "string", enum: ["source", "service", "host"], default: "source" },
          service: { type: "string" },
          host: { type: "string" },
        },
      },
      ContextResponse: {
        type: "object",
        properties: {
          before: { type: "array" },
          after: { type: "array" },
        },
      },
      SearchResponse: {
        type: "object",
        properties: {
          logs: { type: "array" },
          total: { type: "integer" },
          query: { type: "string" },
          executionTimeMs: { type: "number" },
          cached: { type: "boolean" },
        },
      },
      NaturalQueryRequest: {
        type: "object",
        required: ["teamId", "query"],
        properties: { teamId: { type: "string" }, query: { type: "string", minLength: 3 } },
      },
    },
  },
};
