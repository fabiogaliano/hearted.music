-- Enable pgvector extension for embedding storage and similarity search
-- This must be enabled before creating tables with vector columns

CREATE EXTENSION IF NOT EXISTS vector;
