# Task 027: Phase 3 - NLQ Reframing and Structured Query DSL

## Goal

Turn natural-language querying into a reliable assistive layer on top of a structured explorer query model.

## Why

The current UI suggests "AI generating SQL", but the backend does not execute arbitrary SQL. That mismatch is acceptable in a demo and harmful in production. NLQ should produce structured, inspectable query intent that the explorer can execute consistently.

## Scope

### Backend

- redefine the natural-language translation output to a structured query plan:
  - text terms
  - filters
  - inferred time range
  - sort suggestion
  - confidence or warnings
- keep an optional explanation string for display
- remove any implication that arbitrary SQL is passed through directly

### Frontend

- relabel the current SQL preview panel to "AI interpretation" or "AI plan"
- show extracted filters and inferred scope as chips before execution when appropriate
- allow users to accept, edit, or discard AI-generated filters
- keep a deterministic non-AI path for every explorer capability

## Suggested response shape

```ts
interface NaturalQueryPlan {
  explanation: string;
  inferredTimeRange?: { startTime: string; endTime: string };
  filtersApplied: LogFilter[];
  textTerms?: string[];
  warnings?: string[];
}
```

## Acceptance criteria

- the UI no longer claims to execute arbitrary SQL when it does not
- AI-generated search intent is visible and editable before or after execution
- failed NLQ translation still leaves the user with a fully functional structured explorer

## Test plan

- unit tests for NLQ translation mapping
- frontend tests for query-plan rendering and chip editing
- regression test ensuring non-AI search still works when AI services are unavailable

## Dependencies

- depends on `020`
- benefits from `023` and `024`

## Out of scope

- autonomous root-cause analysis
- automatic incident generation from NLQ sessions

## Estimated effort

2 to 3 days
