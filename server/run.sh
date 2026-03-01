#!/usr/bin/env bash
# Run the backend using the project venv (avoids system Python / missing psycopg)
cd "$(dirname "$0")"
exec ./venv/bin/python -m uvicorn app.main:app --reload --port 8000
