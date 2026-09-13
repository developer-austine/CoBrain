# C++ Module Build Stage
FROM ubuntu:22.04 AS builder

WORKDIR /app

# Install build dependencies
RUN apt-get update && apt-get install -y \
    build-essential \
    cmake \
    git \
    libssl-dev \
    libomp-dev \
    && rm -rf /var/lib/apt/lists/*

# Install pybind11
RUN apt-get update && apt-get install -y \
    pybind11-dev \
    && rm -rf /var/lib/apt/lists/*

# Copy C++ source
COPY . .

# Build the C++ module
RUN mkdir -p build && \
    cd build && \
    cmake -DCMAKE_BUILD_TYPE=Release .. && \
    cmake --build . --config Release

# Final stage: only keep the compiled .so file
FROM ubuntu:22.04

WORKDIR /app

# Copy only the compiled module from builder
COPY --from=builder /app/build/lib/brain_cpp.so /usr/local/lib/

# Install runtime dependencies
RUN apt-get update && apt-get install -y \
    libssl3 \
    libomp-dev \
    && rm -rf /var/lib/apt/lists/*

# Make the module discoverable
ENV LD_LIBRARY_PATH=/usr/local/lib:$LD_LIBRARY_PATH
ENV PYTHONPATH=/usr/local/lib:$PYTHONPATH

CMD ["/bin/bash"]
