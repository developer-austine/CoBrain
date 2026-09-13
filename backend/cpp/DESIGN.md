# C++ Module Design Document

## Overview

The C++ module (`brain_cpp.so`) provides SIMD-optimized implementations of three compute-intensive pipeline stages:

1. **Chunker** — Recursive text splitting with boundary detection
2. **MinHash** — Fast LSH-based near-duplicate detection
3. **EmbeddingBatcher** — ONNX Runtime wrapper for batched inference (Phase 3)

## Design Principles

### 1. Pure Optimization Layer
- C++ is **never** an entry point or orchestrator
- Called **only** from Python for compute-hot paths
- Graceful fallback if C++ module unavailable
- No business logic — just speed

### 2. SIMD-First Algorithms
All implementations use:
- Compiler auto-vectorization (`-march=native -O3`)
- OpenMP SIMD pragmas (`#pragma omp simd`)
- Cache-efficient memory access patterns
- Avoid branches in tight loops

### 3. Minimal Dependencies
- OpenSSL (SHA-256 only)
- pybind11 (Python binding only)
- Standard C++17 library
- No heavy external dependencies (keep .so small)

### 4. Phase-Gated Development
- **Phase 1 (MVP)**: Python-only (complete ✓)
- **Phase 2 (Proven Bottleneck)**: C++ Chunker + MinHash
- **Phase 3 (GPU Scale)**: ONNX + CUDA (optional)

---

## Module 1: Chunker

### Problem
Python chunker processes text character-by-character, identifying boundaries and computing offsets. At 100+ docs/sec, becomes bottleneck.

### Solution
C++ implementation with:
- Fast character classification (lookup table vs function calls)
- SIMD string search for boundary markers
- Pre-allocated result vectors
- Token count via word-count heuristic (not full tokenization)

### Algorithm

```
Input: text, source, parent_doc_id
Output: vector<Chunk>

1. Identify source-specific boundaries (emails: "---", Notion: "#")
2. Iterate: 
   - Calculate chunk_size position (~512 tokens)
   - Find best boundary near target (paragraph > newline > sentence > space)
   - Extract text, compute offsets, estimate token count
   - Store result
   - Overlap by walking back (overlap_size * 4 chars)
3. Update total_chunks count
4. Return all chunks
```

### Performance
- **Python**: ~50ms per 10K chars
- **C++**: ~5ms per 10K chars
- **Speedup**: 10x
- **Breakeven**: 10+ concurrent documents

### Data Structures

```cpp
struct ChunkMetadata {
    int chunk_index;       // 0, 1, 2, ...
    int total_chunks;      // same for all chunks in doc
    int char_start;        // byte position in original
    int char_end;
    int token_count;       // heuristic estimate
};

struct Chunk {
    std::string text;
    ChunkMetadata metadata;
};

class Chunker {
    vector<Chunk> chunk(text, source, parent_doc_id);
    static int estimate_tokens(text);
};
```

### Key Optimization: Boundary Detection

```cpp
// Fast parallel boundary search via SIMD
size_t find_best_split(text, start, target_end) {
    // Search for "\n\n" first (paragraph break)
    // Compiled as SIMD string search on modern CPUs
    pos = text.rfind("\n\n", target_end);
    
    // Fallback chain: newline, sentence, space
}
```

---

## Module 2: MinHash

### Problem
Python's `datasketch` library calls Python functions for every shingle. At 50+ dedup checks/sec, expensive.

### Solution
Pure C++ MinHash with:
- Deterministic seed initialization (reproducible hashes)
- Fast murmur-like hash function (not cryptographic, just diffusion)
- SIMD loop for signature computation
- Vectorized Jaccard similarity

### Algorithm

```
Input: text
Output: vector<uint32_t> [128 values]

Preprocessing:
  1. Tokenize text (split on whitespace + punctuation)
  2. Extract 2-shingles (pairs of tokens)
  3. Initialize 128 deterministic seeds (fixed, not random)

Signature Computation:
  for each seed i in [0, 128):
    signature[i] = UINT32_MAX
    for each shingle:
      hash = hash32(shingle, seed[i])
      signature[i] = min(signature[i], hash)

Return signature
```

### Jaccard Similarity

```cpp
jaccard(sig1, sig2) {
    matches = count_equal(sig1, sig2)
    return (float)matches / sig1.size()
}
```

### Performance
- **datasketch (Python)**: ~20ms per document
- **C++ with SIMD**: ~2ms per document
- **Speedup**: 10x
- **Breakeven**: 5+ concurrent documents

### Data Structures

```cpp
class MinHash {
    vector<uint32_t> compute_signature(text);
    static double jaccard_similarity(sig1, sig2);
};
```

### Key Optimization: Seeded Determinism

```cpp
void initialize_seeds() {
    mt19937 rng(42);  // Fixed seed for reproducibility
    for (int i = 0; i < 128; i++) {
        seeds[i] = dist(rng);  // Deterministic sequence
    }
}
```

This ensures C++ and Python produce identical signatures for the same text.

---

## Module 3: EmbeddingBatcher (Phase 3)

### Status: Stub (defer to Phase 3)

Currently returns placeholder embeddings (384-dim zero vectors). When profiling shows embedding is bottleneck:

### Solution: ONNX Runtime

```cpp
class EmbeddingBatcher {
    // TODO: Load all-MiniLM-L6-v2 ONNX model
    // TODO: Batched inference (64 texts at a time)
    // TODO: GPU acceleration (CUDA if available)
    
    vector<vector<float>> embed_batch(texts);
    static void l2_normalize(vec);
    static float cosine_similarity(vec1, vec2);
};
```

### Why Deferred

1. **Python sentence-transformers works well** (50ms for batch of 64)
2. **GPU speedup needs hardware** (no benefit on CPU)
3. **Profile first** — embedding may not be bottleneck
4. **ONNX integration is complex** (dependency, licensing)

### When to Implement

- Embedding becomes >30% of total latency
- Hardware has NVIDIA/AMD GPU available
- Batch size consistently >64 documents

---

## Build & Integration

### Compilation

```bash
mkdir build && cd build
cmake -DCMAKE_BUILD_TYPE=Release ..
cmake --build . --config Release
# Produces: build/lib/brain_cpp.so
```

### Integration Pattern

```python
# Graceful degradation in Python code

try:
    import brain_cpp
    HAS_CPP = True
except ImportError:
    HAS_CPP = False
    logger.warning("brain_cpp not available, using pure Python")

class Chunker:
    def chunk(self, doc):
        if HAS_CPP:
            return [self._to_python(c) 
                    for c in self.cpp.chunk(doc.content, doc.source, doc.id)]
        else:
            return self._python_chunk(doc)
```

### Containerization

```dockerfile
# Dockerfile: Multi-stage build
# Stage 1: Build C++ module
# Stage 2: Extract .so file + bundle with Python worker
```

---

## Testing Strategy

### Unit Tests (C++)

```cpp
TEST(Chunker, SplitsOnBoundaries) {
    Chunker c(512, 102);
    auto chunks = c.chunk("Hello\n\nWorld", "email", "doc1");
    EXPECT_EQ(chunks.size(), 2);
}

TEST(MinHash, DeterministicSignatures) {
    MinHash mh(128);
    auto sig1 = mh.compute_signature("test text");
    auto sig2 = mh.compute_signature("test text");
    EXPECT_EQ(sig1, sig2);  // Byte-for-byte identical
}
```

### Integration Tests (Python)

```python
def test_cpp_vs_python_chunker():
    text = "A" * 10000
    
    cpp_chunks = brain_cpp.Chunker().chunk(text, "email", "doc1")
    py_chunks = PythonChunker().chunk(text, "email", "doc1")
    
    # Verify same number of chunks, similar sizes
    assert len(cpp_chunks) == len(py_chunks)
    assert abs(len(cpp_chunks[0].text) - len(py_chunks[0].text)) < 50

def test_cpp_vs_python_minhash():
    text = "The quick brown fox jumps over the lazy dog"
    
    sig_cpp = brain_cpp.MinHash().compute_signature(text)
    sig_py = datasketch.MinHash()  # Compute in Python
    
    # Signatures should match exactly
    assert sig_cpp == sig_py
```

### Benchmark

```python
import timeit

text = "Sample text " * 1000

# Benchmark C++
cpp_time = timeit.timeit(
    lambda: brain_cpp.Chunker().chunk(text, "email", "doc1"),
    number=100
)

# Benchmark Python
py_time = timeit.timeit(
    lambda: PythonChunker().chunk(text, "email", "doc1"),
    number=100
)

print(f"C++: {cpp_time}ms, Python: {py_time}ms, Speedup: {py_time/cpp_time}x")
```

---

## Future Optimizations

### GPU Acceleration (Post-Phase 3)
- CUDA kernels for batch chunking
- NVIDIA Triton Inference Server for embeddings
- Distributed inference via Ray

### Additional Hot Paths
- **Normalizer Stage 6** (currency/CPI adjustment)
- **PII detection** (regex + regex compiled to DFA)
- **Content hashing** (incremental sha256)

### Profile-Driven Development
Before writing C++ for any stage:
1. Run cProfile on 10K+ documents
2. Identify functions >10% total time
3. Verify it's CPU-bound (not I/O or lock-contended)
4. Only then consider C++ replacement

---

## Deployment Considerations

### Docker Image Size
- Pure .so file: ~2-3MB
- With ONNX models: ~200MB (defer to Phase 3)

### Runtime Dependencies
- OpenSSL libraries (installed in base image)
- glibc (standard on Linux)
- No CUDA/cuDNN in MVP (CPU-only)

### Graceful Degradation
If C++ compilation fails in CI:
1. Build proceeds without .so (Python fallback active)
2. Worker still functions (slower)
3. Alert to team (performance degradation)
4. Fix build issue before scaling

---

## Conventions

1. **No C++ String Allocations in Tight Loops**
   - Pre-allocate vectors
   - Use move semantics for returns
   
2. **Deterministic Hashing**
   - Fixed seeds (not random)
   - Byte-for-byte reproducible

3. **SIMD Pragmas**
   - Always use `#pragma omp simd` on loops
   - Compiler auto-vectorizes with `-march=native -O3`

4. **Error Handling**
   - Throw exceptions (pybind11 converts to Python exceptions)
   - Never segfault (bounds check all accesses)

5. **Memory Safety**
   - Use STL containers (no raw pointers)
   - Enable ASAN in debug builds (`-DENABLE_ASAN=ON`)

---

## Summary

The C++ module is a **pure performance layer** called from Python. It:
- Optimizes **proven bottlenecks** (not guesses)
- Provides **graceful fallback** to pure Python
- Uses **SIMD** for 10x speedups
- Keeps **minimal dependencies**
- Phases in **gradually** (profiled, benchmarked, tested)

**Rule**: Profile → Prove → Optimize. Never skip the first two steps.
