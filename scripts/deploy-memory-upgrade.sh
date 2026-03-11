#!/bin/bash
# Deploy collectLeague with increased memory (1024MB) to fix Puppeteer OOM at 488MB
# Run on deploy VM: curl -X POST http://35.209.45.82:8080/exec -d '{"cmd":"bash scripts/deploy-memory-upgrade.sh"}'

set -e

echo "=== Deploying collectLeague with 1024MB memory ==="

gcloud functions deploy collectLeague \
  --gen2 \
  --runtime=nodejs20 \
  --region=us-central1 \
  --source=. \
  --entry-point=collectLeague \
  --trigger-http \
  --allow-unauthenticated \
  --memory=1024MB \
  --timeout=540s \
  --project=teams-united

echo "=== collectLeague deployed with 1024MB memory ==="

# Also deploy collectAll with the same memory since it calls the same adapters
echo "=== Deploying collectAll with 1024MB memory ==="

gcloud functions deploy collectAll \
  --gen2 \
  --runtime=nodejs20 \
  --region=us-central1 \
  --source=. \
  --entry-point=collectAll \
  --trigger-http \
  --allow-unauthenticated \
  --memory=1024MB \
  --timeout=540s \
  --project=teams-united

echo "=== collectAll deployed with 1024MB memory ==="
echo "Done. Both functions now have 1024MB memory."
