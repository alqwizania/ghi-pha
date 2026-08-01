#!/bin/bash
# Convenience script to run main.py using uv's virtual environment
source .venv/bin/activate
python main.py "$@"
