FROM python:3.11-slim

WORKDIR /app

# Make pip resilient to slow/flaky connections (default socket timeout is 15s)
ENV PIP_DEFAULT_TIMEOUT=300 \
    PIP_RETRIES=10

# Install system dependencies. Configure apt to retry on a flaky connection
# (otherwise a dropped download fails the whole layer).
RUN echo 'Acquire::Retries "10";' > /etc/apt/apt.conf.d/80-retries && \
    apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    curl \
    git \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements
COPY requirements.txt .

# Install Python dependencies.
# Install the CPU-only PyTorch wheel FIRST from the PyTorch CPU index. This is
# ~190MB and pulls in NO CUDA/nvidia packages, vs the default PyPI torch which
# drags in several GB of CUDA deps. sentence-transformers then sees torch as
# already satisfied and won't pull the CUDA build.
RUN pip install --upgrade pip setuptools wheel && \
    pip install torch --index-url https://download.pytorch.org/whl/cpu && \
    pip install -r requirements.txt

# datasketch (MinHash LSH near-dup detection, used by the ingest pipeline) is
# missing from backend/requirements.txt. Installed as its own layer so the large
# torch/requirements layer above stays cached across rebuilds.
RUN pip install datasketch

# Forecasting engine (m_learning) deps. Separate layer for the same
# cache reason as above.
RUN pip install pandas pyarrow

# Copy backend code
COPY . /app/backend/python

# Set PYTHONPATH so imports work correctly. Include pipeline/ too: some pipeline
# modules import their siblings bare (e.g. embedder.py: `from chunker import Chunk`)
# rather than by full package path, so the pipeline dir must be importable.
ENV PYTHONPATH=/app/backend/python:/app/backend/python/pipeline

# Default command: start worker
CMD ["celery", "-A", "workers.celery_app", "worker", "--loglevel=info"]