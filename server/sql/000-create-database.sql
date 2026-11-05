-- 000 — Create the Commissaire database and its own login role.
--
-- Run ONCE, by you, as a PostgreSQL superuser on the existing server
-- (e.g. `sudo -u postgres psql -v app_password='<new secret>' -f 000-create-database.sql`).
-- The migration runner never runs this file. It touches nothing that belongs
-- to El Niño: no existing database, role or grant is changed.
--
-- Names: the server already has a database "commissaire" and a role
-- "commissaire_app" of unknown origin (probably the `commissaire-api` PM2
-- process, decision D-1). They are left alone; this service uses new names.

\set ON_ERROR_STOP on

CREATE ROLE commissaire_live
  LOGIN PASSWORD :'app_password'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS
  CONNECTION LIMIT 30;

CREATE DATABASE commissaire_live
  OWNER commissaire_live
  ENCODING 'UTF8'
  TEMPLATE template0;

-- Only the Commissaire role may connect (El Niño's role and PUBLIC may not).
REVOKE ALL ON DATABASE commissaire_live FROM PUBLIC;
GRANT CONNECT, TEMPORARY ON DATABASE commissaire_live TO commissaire_live;

\connect commissaire_live
ALTER SCHEMA public OWNER TO commissaire_live;
REVOKE ALL ON SCHEMA public FROM PUBLIC;

-- Then allow the role in pg_hba.conf, for the host the API runs on only, e.g.:
--   hostssl  commissaire_live  commissaire_live  127.0.0.1/32  scram-sha-256
-- and reload:  SELECT pg_reload_conf();
