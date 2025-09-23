# Telemetry Setup Guide

This guide covers setting up and using the local telemetry stack for Latchflow Core development.

## Overview

The telemetry stack provides comprehensive observability for local development with:
- **Structured Logging**: JSON logs with OpenTelemetry correlation
- **Metrics Collection**: Authorization decisions, performance, and business metrics
- **Distributed Tracing**: Request flow visualization (infrastructure ready)
- **Unified Dashboards**: Pre-configured Grafana dashboards

## Quick Start

### 1. Start the Telemetry Stack

```bash
# Start all telemetry services
pnpm telemetry:start

# View logs from all services
pnpm telemetry:logs

# Stop the stack
pnpm telemetry:stop
```

### 2. Start Latchflow Core

```bash
# Ensure Authorization v2 is enabled (default in .env.defaults)
pnpm core:dev
```

### 3. Access Dashboards

| Service | URL | Credentials | Purpose |
|---------|-----|-------------|---------|
| **Grafana** | http://localhost:3000 | admin/admin | Unified dashboards and visualization |
| **Prometheus** | http://localhost:9090 | None | Metrics storage and queries |
| **Jaeger** | http://localhost:16686 | None | Distributed tracing |

## Generating Test Data

To see metrics in action, trigger some authorization decisions:

```bash
# Make requests that trigger authorization (will get 401/403 but generate metrics)
curl http://localhost:3001/bundles
curl http://localhost:3001/files
curl http://localhost:3001/triggers

# Or use fake API tokens
curl -H "Authorization: Bearer fake-token" http://localhost:3001/bundles
```

After 15-20 seconds (export interval), metrics will appear in Prometheus and Grafana.

## Stack Components

### OpenTelemetry Collector
- **Purpose**: Receives telemetry from core, routes to storage backends
- **Config**: `telemetry/configs/otel-collector.yaml`
- **Ports**:
  - 4317 (gRPC), 4318 (HTTP) - OTLP receivers
  - 8889 - Prometheus exporter

### Prometheus
- **Purpose**: Metrics storage and alerting
- **Config**: `telemetry/configs/prometheus.yml`
- **Port**: 9090
- **Data**: Scrapes metrics from OpenTelemetry Collector every 15s

### Jaeger
- **Purpose**: Distributed tracing storage and UI
- **Port**: 16686 (UI), 14250 (OTLP)
- **Status**: Infrastructure ready, core app doesn't send traces yet

### Grafana
- **Purpose**: Visualization and dashboards
- **Port**: 3000
- **Datasources**: Pre-configured Prometheus and Jaeger connections
- **Dashboards**: `telemetry/dashboards/latchflow-core.json`

## Available Metrics

With Authorization v2 enabled, these metrics are collected:

### Authorization Decisions (`authz_decision_total`)
- **Labels**: route_id, http_method, evaluation_mode, policy_outcome, effective_decision, reason, resource, action, user_role
- **Purpose**: Track all authorization decisions (allow/deny)

### Authorization Duration (`authz_decision_duration_ms`)
- **Labels**: Same as above
- **Purpose**: Authorization evaluation performance

### Rules Cache Events (`authz_rules_cache_events_total`)
- **Labels**: operation (hit/miss/invalidate), rules_hash, reason
- **Purpose**: Authorization cache efficiency

### Rule Compilation (`authz_compilation_total`, `authz_compilation_duration_ms`)
- **Labels**: result (success/failure), rules_hash, preset_id
- **Purpose**: Policy compilation performance and errors

### 2FA Events (`authz_two_factor_events_total`)
- **Labels**: event, route_id, user_role, reason
- **Purpose**: Two-factor authentication flow tracking

## Configuration

### Environment Variables

Key telemetry configuration in `.env.defaults`:

```bash
# Authorization v2 (required for metrics)
AUTHZ_V2=true
AUTHZ_V2_SHADOW=false

# OpenTelemetry Metrics
AUTHZ_METRICS_ENABLED=true
AUTHZ_METRICS_OTLP_URL=http://host.docker.internal:4318/v1/metrics
AUTHZ_METRICS_SERVICE_NAME=latchflow-core
AUTHZ_METRICS_EXPORT_INTERVAL_MS=15000
AUTHZ_METRICS_EXPORT_TIMEOUT_MS=10000
AUTHZ_METRICS_ENABLE_DIAGNOSTICS=true

# Structured Logging
LOG_LEVEL=info
LOG_PRETTY=true
```

### Customizing the Stack

#### Modify OpenTelemetry Collector
Edit `telemetry/configs/otel-collector.yaml` to:
- Add new exporters (e.g., external OTLP endpoints)
- Change processing pipelines
- Modify sampling rates

#### Customize Prometheus
Edit `telemetry/configs/prometheus.yml` to:
- Add additional scrape targets
- Change scrape intervals
- Configure alerting rules

#### Add Grafana Dashboards
1. Create JSON dashboard files in `telemetry/dashboards/`
2. Restart Grafana: `docker restart grafana`
3. Dashboards auto-load from the mounted volume

## Troubleshooting

### No Metrics in Prometheus

1. **Check Authorization v2**: Ensure `AUTHZ_V2=true`
2. **Verify Requests**: Make requests that trigger authorization
3. **Check Export Interval**: Wait 15-20 seconds for metrics to export
4. **View Collector Logs**: `docker logs otel-collector`

### Grafana Access Issues

```bash
# Reset Grafana admin password
docker exec -it grafana grafana-cli admin reset-admin-password admin
```

### Container Connection Issues

If running in dev containers, ensure:
- Core app uses `host.docker.internal:4318` for OTLP endpoint
- Browser access uses `localhost` ports
- All containers are on the same network

### Performance Impact

The telemetry stack is designed for development use:
- **Metrics**: Minimal overhead, 15s export interval
- **Logging**: Structured JSON, async writes
- **Resources**: ~200-300MB RAM for full stack

## Production Considerations

This local stack is **not** intended for production. For production:

1. **External OTLP**: Point `AUTHZ_METRICS_OTLP_URL` to production collector
2. **Disable Diagnostics**: Set `AUTHZ_METRICS_ENABLE_DIAGNOSTICS=false`
3. **Secure Storage**: Use managed Prometheus/Grafana services
4. **Access Control**: Implement proper authentication/authorization

## Next Steps

- **Add Tracing**: Core application can be extended to send traces to Jaeger
- **Custom Dashboards**: Create domain-specific visualizations in Grafana
- **Alerting**: Configure Prometheus alerts for critical metrics
- **Log Forwarding**: Send structured logs to the OpenTelemetry Collector