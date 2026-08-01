FROM python:3.11-slim

WORKDIR /app

# Install docker CLI for dashboard log streaming
RUN apt-get update && \
    apt-get install -y docker.io nodejs npm && \
    rm -rf /var/lib/apt/lists/*

# Install Node dependencies used by ProMED resolver
COPY package.json package-lock.json ./
RUN npm install --omit=dev
RUN npx playwright install --with-deps chromium

# Install dependencies
RUN pip install --no-cache-dir \
    openai-agents \
    fastapi \
    uvicorn[standard] \
    pydantic \
    pydantic-settings \
    httpx \
    pdfplumber \
    python-dotenv \
    aiosqlite \
    openai \
    beautifulsoup4 \
    lxml

# Copy application code
COPY health_agents/ ./health_agents/
COPY tools/ ./tools/
COPY workflows/ ./workflows/
COPY parsers/ ./parsers/
COPY config/ ./config/
COPY static/ ./static/
COPY promed.js ./
COPY main.py server.py ./

# Copy dashboard files
COPY dashboard/index.html ./dashboard/
COPY dashboard/server.py ./dashboard/dashboard_server.py

# Copy live dashboard and project overview
COPY live-dashboard.html ./
COPY v3.html ./
COPY globe.html ./
COPY globe-pha.html ./

# Copy public files (documentation, etc.)
COPY public/ ./public/

# Copy docs (flowchart, etc.)
COPY docs/ ./docs/

# Health check
HEALTHCHECK --interval=30s --timeout=10s --retries=3 --start-period=10s \
    CMD python -c "import httpx; httpx.get('http://localhost:8080/status', timeout=5)"

# Run server
CMD ["python", "server.py"]
