# Brain C++ Module

Compute bottleneck optimizations for the Company Brain intelligence pipeline. This module provides SIMD-optimized implementations of:

1. **Chunker** — 10x faster recursive text splitter (phase 2)
2. **MinHash** — SIMD-accelerated near-duplicate detection via LSH
3. **EmbeddingBatcher** — ONNX Runtime batched inference wrapper (phase 3)

## Architecture

The C++ module is **optional** and called from Python via pybind11. It never runs as an entry point; it only optimizes profiled hot paths.

```
Python (brain/pipeline/) 
    ↓
import brain_cpp
    ↓
C++ Module (brain_cpp.so)
    ↓
Return results to Python
```

### Design Philosophy

- **Phase 1 (MVP)**: Python implementations with profiling points
- **Phase 2 (Profiling)**: Profile to identify actual bottlenecks (don't guess)
- **Phase 3 (C++ Opt)**: Replace only profiled-hot components

**Rule**: Do NOT write C++ until the Python path is proven slow.

## Building

### Prerequisites

- CMake 3.12+
- C++17 compiler (GCC 7+, Clang 5+)
- pybind11
- OpenSSL (for SHA-256)
- Python 3.9+ dev headers

### Build from Source

```bash
cd backend/cpp
mkdir build && cd build
cmake -DCMAKE_BUILD_TYPE=Release ..
cmake --build . --config Release
```

Output: `build/lib/brain_cpp.so`

### Using Docker

```bash
docker build -f Dockerfile -t brain-cpp:latest .
docker run --rm -v $(pwd):/app brain-cpp cp /app/build/lib/brain_cpp.so /app/
```

## Integration with Python

### 1. Add to Python Imports

```python
# In python/workers/ingest.py or python/pipeline/chunker.py

try:
    import brain_cpp
    HAS_CPP = True
except ImportError:
    HAS_CPP = False
    print("Warning: brain_cpp not available, using pure Python")
```

### 2. Use in Chunking Pipeline

```python
from python.pipeline.chunker import Chunker as PythonChunker

class Chunker:
    def __init__(self):
        if HAS_CPP:
            self.cpp_chunker = brain_cpp.Chunker(chunk_size=512, overlap=102)
        else:
            self.cpp_chunker = None
    
    def chunk(self, document):
        if self.cpp_chunker:
            chunks = self.cpp_chunker.chunk(
                document.content,
                document.source,
                document.id
            )
            # Convert C++ Chunk objects to Python Chunk dataclasses
            return [self._to_python_chunk(c) for c in chunks]
        else:
            # Fallback to Python implementation
            return PythonChunker.chunk(document)
```

### 3. Use in MinHash Deduplication

```python
from python.pipeline.deduplicator import Deduplicator

class Deduplicator:
    def __init__(self):
        if HAS_CPP:
            self.minhash = brain_cpp.MinHash(num_hashes=128)
        else:
            self.minhash = None
    
    def get_signature(self, text):
        if self.minhash:
            return self.minhash.compute_signature(text)
        else:
            # Fallback to datasketch
            from datasketch import MinHash as PyMinHash
            m = PyMinHash(num_perm=128)
            for shingle in self._get_shingles(text):
                m.update(shingle.encode())
            return m.hashvalues
    
    def compute_jaccard(self, sig1, sig2):
        if self.minhash:
            return brain_cpp.MinHash.jaccard_similarity(sig1, sig2)
        else:
            # Fallback to datasketch
            return estimate_jaccard(sig1, sig2)
```

### 4. Optional: ONNX Embedding (Phase 3)

```python
from python.pipeline.embedder import Embedder

class Embedder:
    def __init__(self):
        if HAS_CPP:
            try:
                self.cpp_embedder = brain_cpp.EmbeddingBatcher(
                    model_path="/path/to/all-MiniLM-L6-v2.onnx",
                    use_gpu=True
                )
            except Exception as e:
                logger.warning(f"ONNX embedder init failed: {e}, using sentence-transformers")
                self.cpp_embedder = None
        else:
            self.cpp_embedder = None
    
    def embed_batch(self, chunks):
        texts = [c.text for c in chunks]
        
        if self.cpp_embedder:
            embeddings = self.cpp_embedder.embed_batch(texts)
            # L2 normalize in C++
            for emb in embeddings:
                brain_cpp.EmbeddingBatcher.l2_normalize(emb)
            return embeddings
        else:
            # Fallback to sentence-transformers (production MVP)
            from sentence_transformers import SentenceTransformer
            model = SentenceTransformer("all-MiniLM-L6-v2")
            return model.encode(texts, normalize_embeddings=True).tolist()
```

## Performance Expectations

### Chunker (Phase 2)
- **Python**: ~50ms per 10K-char document
- **C++ SIMD**: ~5ms (10x speedup)
- **Breakeven**: 100+ concurrent documents

### MinHash (Phase 2)
- **datasketch (Python)**: ~20ms per document
- **C++ SIMD**: ~2ms (10x speedup)
- **Breakeven**: 50+ dedup checks per second

### ONNX Embedder (Phase 3)
- **sentence-transformers (CPU)**: ~50ms per batch of 64
- **ONNX + GPU**: ~5ms (10x speedup)
- **Breakeven**: GPU available + 100+ docs/sec throughput

## Profiling Guide

Before optimizing, profile with Python's `cProfile`:

```python
import cProfile
import pstats

profiler = cProfile.Profile()
profiler.enable()

# Run your pipeline
for doc in documents:
    process_document(doc)

profiler.disable()
stats = pstats.Stats(profiler)
stats.sort_stats("cumulative")
stats.print_stats(20)  # Top 20 functions
```

Look for:
1. Functions called 1000+ times
2. Functions taking >10% total time
3. Pure computation (no I/O, no locks)

These are C++ candidates.

## Testing

### Unit Tests

```bash
cd backend/cpp/tests
cmake --build . --target test
ctest --verbose
```

### Integration Tests (Python)

```python
# python/tests/test_brain_cpp.py
import brain_cpp

def test_chunker():
    chunker = brain_cpp.Chunker(512, 102)
    chunks = chunker.chunk("Hello world " * 100, "email", "doc123")
    assert len(chunks) > 0
    assert chunks[0].metadata.chunk_index == 0

def test_minhash():
    mh = brain_cpp.MinHash(128)
    sig1 = mh.compute_signature("The quick brown fox")
    sig2 = mh.compute_signature("The quick brown fox")
    assert brain_cpp.MinHash.jaccard_similarity(sig1, sig2) > 0.99

def test_l2_normalize():
    vec = [1.0, 2.0, 3.0]
    brain_cpp.EmbeddingBatcher.l2_normalize(vec)
    assert abs(sum(v*v for v in vec) - 1.0) < 1e-6
```

## Roadmap

- **v0.1 (Done)**: Chunker + MinHash core
- **v0.2 (TODO)**: ONNX Runtime integration (all-MiniLM-L6-v2)
- **v0.3 (TODO)**: GPU acceleration (CUDA/cuDNN)
- **v0.4 (TODO)**: Quantized inference (INT8)

## Troubleshooting

### ImportError: No module named brain_cpp

1. Ensure the .so file was built:
   ```bash
   ls -la build/lib/brain_cpp.so
   ```

2. Check PYTHONPATH includes the library directory:
   ```bash
   export PYTHONPATH=/path/to/cpp/build/lib:$PYTHONPATH
   ```

3. Check for linking issues:
   ```bash
   ldd build/lib/brain_cpp.so | grep "not found"
   ```

### Segmentation Fault

- Ensure Python's pybind11 version matches the compiled module
- Check for buffer overflows in STL containers (use asan: `cmake -DENABLE_ASAN=ON`)

### Wrong Results from MinHash

- Ensure seed initialization is deterministic (not random)
- Verify shingle extraction matches Python's tokenizer

## Contributing

When adding optimizations:
1. **Profile first** — prove the bottleneck with cProfile
2. **Benchmark** — measure Python baseline, C++ improvement, and breakeven
3. **Fallback gracefully** — always have a pure-Python fallback
4. **Test thoroughly** — unit tests + integration tests
5. **Document trade-offs** — speed vs memory vs accuracy

## References

- [pybind11 Docs](https://pybind11.readthedocs.io/)
- [ONNX Runtime C++ API](https://onnxruntime.ai/docs/api/cpp/)
- [MinHash LSH (datasketch)](https://datasketch.readthedocs.io/)
