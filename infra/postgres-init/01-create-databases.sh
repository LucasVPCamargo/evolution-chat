#!/bin/bash
# Cria os bancos do Evolution e do Chatwoot no primeiro boot do Postgres.
# Roda automaticamente via /docker-entrypoint-initdb.d (só na primeira vez,
# quando o volume postgres_data ainda está vazio).
set -e

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "postgres" <<-EOSQL
    SELECT 'CREATE DATABASE evolution'
      WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'evolution')\gexec
    SELECT 'CREATE DATABASE chatwoot'
      WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'chatwoot')\gexec
EOSQL

echo "Bancos 'evolution' e 'chatwoot' criados."
