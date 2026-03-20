# Task 004: Demo Seed Data

**Priority:** P1
**Estimate:** 2h
**Status:** Open

## Problem

Empty Telerithm instance doesn't look impressive for LinkedIn screenshots. Need realistic demo data.

## Solution

Seed script that generates realistic log data from our actual services.

### Services to Simulate

| Service | Log Types |
|---------|-----------|
| triologue-api | Message sent, WebSocket connect/disconnect, Auth login, Room created |
| event-booking | Booking confirmed, Slot decremented, Email sent, Event created |
| traefik | HTTP requests, SSL cert renewed, Route added |
| health-dashboard | Health check passed/failed, Metrics collected |
| gateway | Agent connected/disconnected, SSE stream |

### Log Patterns

```json
// Normal operation (80%)
{"level":"info","service":"triologue-api","message":"Message sent in room memory-weaver","fields":{"roomId":"abc","senderId":"ice"}}

// Warnings (15%)  
{"level":"warn","service":"event-booking","message":"Slot count low for event","fields":{"eventId":"xyz","remaining":2}}

// Errors (5%)
{"level":"error","service":"gateway","message":"SSE connection dropped","fields":{"agentId":"lava","reason":"timeout"}}
```

### Time Distribution

- Generate 7 days of data
- Higher volume during business hours (9-18 UTC)
- Spike patterns (deploy events, traffic bursts)
- Error clusters (simulate incident)

## Files to Create

```
scripts/seed-demo-logs.ts  — NEW: Generate demo log data
```

## Notes

- Insert directly into ClickHouse (bypass API for speed)
- Use team_id from seed user
- Create at least one alert rule that would trigger on the demo data
- Create at least one incident from the demo errors
