#pragma once

#include <vector>
#include <string>
#include <memory>
#include <cstddef>

namespace brain {

class EmbeddingBatcher {
public:
    /**
     * Wrapper for batched embedding inference.
     * Phase 2 optimization: wraps ONNX runtime for fast inference on GPU/CPU.
     * For MVP: this is optional — Python uses sentence-transformers directly.
     *
     * TODO: Integrate ONNX Runtime for all-MiniLM-L6-v2 model
     * Expected speedup: 2-5x on batches of 64+ texts
     */
    explicit EmbeddingBatcher(const std::string& model_path = "", bool use_gpu = false);
    ~EmbeddingBatcher() = default;

    /**
     * Embed a batch of text chunks in parallel.
     *
     * @param texts Vector of input texts (chunk.text values)
     * @return Vector of embeddings (each 384-dim for all-MiniLM-L6-v2)
     */
    std::vector<std::vector<float>> embed_batch(const std::vector<std::string>& texts);

    /**
     * L2 normalize a vector in-place (SIMD-optimized).
     * Enables cosine distance in Qdrant.
     */
    static void l2_normalize(std::vector<float>& vec);

    /**
     * Compute cosine similarity between two vectors.
     * Used for deduplication and relevance scoring.
     */
    static float cosine_similarity(
        const std::vector<float>& vec1,
        const std::vector<float>& vec2
    );

private:
    std::string model_path_;
    bool use_gpu_;
    // TODO: ONNX Runtime session handle
    // std::unique_ptr<Ort::Session> session_;

    // SIMD-optimized dot product (SSE/AVX)
    static float dot_product(
        const float* vec1,
        const float* vec2,
        size_t dim
    );

    // Compute Euclidean norm efficiently
    static float euclidean_norm(const std::vector<float>& vec);
};

} // namespace brain
