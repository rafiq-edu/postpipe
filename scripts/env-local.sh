#!/usr/bin/env bash
set -euo pipefail

if [ -e .env.local ] && [ "${1:-}" != "--force" ]; then
  echo ".env.local exists, use --force to overwrite"
  exit 1
fi

{
  supabase status -o env \
    --override-name api.url=NEXT_PUBLIC_SUPABASE_URL \
    --override-name auth.anon_key=NEXT_PUBLIC_SUPABASE_ANON_KEY \
    --override-name auth.service_role_key=SUPABASE_SERVICE_ROLE_KEY \
    --override-name db.url=DATABASE_URL |
    grep -E '^(NEXT_PUBLIC_SUPABASE_URL|NEXT_PUBLIC_SUPABASE_ANON_KEY|SUPABASE_SERVICE_ROLE_KEY|DATABASE_URL)='
  echo "SECRETS_SOURCE=env"
  echo "STAGE=dev"
  echo "NEXT_PUBLIC_APP_URL=http://localhost:3000"
  echo "NEXT_PUBLIC_CONNECT_URL=http://localhost:3000"
  echo "CURRENT_TOKEN_KEY_VERSION=1"
  echo "TOKEN_KEY_V1=$(openssl rand -base64 32)"
  echo "AWS_ENDPOINT_URL=http://localhost:4566"
  echo "AWS_REGION=us-east-1"
  echo "AWS_ACCESS_KEY_ID=test"
  echo "AWS_SECRET_ACCESS_KEY=test"
  echo "MEDIA_BUCKET=postpipe-media-local"
  echo "POLAR_SERVER=sandbox"
  echo "POLAR_ACCESS_TOKEN="
  echo "POLAR_WEBHOOK_SECRET="
  echo "POLAR_ORGANIZATION_ID="
  echo "POLAR_PRODUCT_BUILDER="
  echo "POLAR_PRODUCT_SCALE="
  echo "# WORKER_CONCURRENCY=5"
} >.env.local

echo "wrote .env.local ($(grep -c '=' .env.local) variables)"
