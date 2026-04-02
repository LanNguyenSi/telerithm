CREATE TABLE IF NOT EXISTS logs (
    id String,
    team_id String,
    source_id String,
    timestamp DateTime64(3),
    level LowCardinality(String),
    service LowCardinality(String),
    host LowCardinality(String),
    message String,
    fields Map(String, String)
)
ENGINE = MergeTree()
PARTITION BY toYYYYMMDD(timestamp)
ORDER BY (team_id, source_id, timestamp)
TTL toDateTime(timestamp) + INTERVAL 30 DAY;

CREATE TABLE IF NOT EXISTS anomalies (
    team_id String,
    detected_at DateTime64(3),
    anomaly_type LowCardinality(String),
    severity LowCardinality(String),
    description String,
    affected_services Array(String),
    sample_logs Array(String),
    resolved Boolean DEFAULT false
)
ENGINE = MergeTree()
ORDER BY (team_id, detected_at);
