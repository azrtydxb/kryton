-- Enable pgvector for embedding storage and similarity search.
-- Runs once on first container start (Postgres official-image init hook).
CREATE EXTENSION IF NOT EXISTS vector;
