\set ON_ERROR_STOP on
\getenv memory_password JALECO_MEMORY_PASSWORD

BEGIN;

CREATE SCHEMA IF NOT EXISTS jaleco_memory;

SELECT 'CREATE ROLE jaleco_memory LOGIN'
WHERE NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'jaleco_memory')
\gexec

ALTER ROLE jaleco_memory WITH LOGIN PASSWORD :'memory_password';
GRANT CONNECT ON DATABASE jaleco TO jaleco_memory;
REVOKE ALL ON SCHEMA jaleco_memory FROM PUBLIC;
GRANT USAGE, CREATE ON SCHEMA jaleco_memory TO jaleco_memory;

COMMIT;
