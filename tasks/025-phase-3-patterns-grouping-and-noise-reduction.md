# Task 025: Phase 3 - Patterns, Grouping, and Noise Reduction

## Goal

Help operators identify noisy error classes and recurring event shapes by grouping similar log lines into patterns.

## Why

High-volume systems become unreadable as raw event lists. Datadog's patterns view and Elastic's categorization features reduce noise by collapsing repeated message templates into grouped investigation units.

## Scope

### Backend

- add `POST /logs/patterns`
- implement an initial patterning algorithm:
  - normalize message tokens
  - replace IDs, UUIDs, numbers, timestamps, and quoted values with placeholders
  - group by normalized signature plus optional level/service partition
- return:
  - pattern key
  - sample message
  - count
  - latest timestamp
  - optional representative field values

### Frontend

- add a "Patterns" toggle on the logs page
- show grouped patterns instead of raw events
- allow drilling from a pattern into matching raw events
- allow converting a pattern to filter chips

## Acceptance criteria

- users can switch between raw events and patterns for the same search scope
- grouped patterns reduce repeated noisy lines into a smaller actionable list
- selecting a pattern scopes the explorer to matching logs

## Test plan

- unit tests for message normalization
- integration tests for pattern grouping over sample logs
- frontend tests for switching between list and pattern view

## Dependencies

- depends on `023`
- pairs well with `021`

## Out of scope

- ML-based anomaly scoring
- parser rule generation

## Estimated effort

3 to 5 days
