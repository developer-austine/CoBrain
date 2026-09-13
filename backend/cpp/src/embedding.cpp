#include "embedding.h"
#include <cmath>
#include <algorithm>
#include <numeric>

namespace brain {

EmbeddingBatcher::EmbeddingBatcher(const std::string& model_path, bool use_gpu)
    : model_path_(model_path), use_gpu_(use_gpu) {
    // TODO: Initialize ONNX Runtime session with all-MiniLM-L6-v2 model
    // This is Phase 2 optimization. For MVP, Python handles embedding.
}

std::vector<std::vector<float>> EmbeddingBatcher::embed_batch(
    const std::vector<std::string>& texts) {

    std::vector<std::vector<float>> embeddings;

    // TODO: Replace with ONNX Runtime inference
    // For now, return placeholder embeddings (384-dim zero vectors)
    for (const auto& text : texts) {
        std::vector<float> embedding(384, 0.0f);
        embeddings.push_back(embedding);
    }

    return embeddings;
}

void EmbeddingBatcher::l2_normalize(std::vector<float>& vec) {
    float norm = euclidean_norm(vec);

    if (norm > 1e-9) { // Avoid division by zero
        std::transform(vec.begin(), vec.end(), vec.begin(),
                       [norm](float x) { return x / norm; });
    }
}

float EmbeddingBatcher::cosine_similarity(
    const std::vector<float>& vec1,
    const std::vector<float>& vec2) {

    if (vec1.size() != vec2.size()) {
        return 0.0f;
    }

    // Vectors should already be L2-normalized, so cosine = dot product
    return dot_product(vec1.data(), vec2.data(), vec1.size());
}

float EmbeddingBatcher::dot_product(
    const float* vec1,
    const float* vec2,
    size_t dim) {

    float result = 0.0f;

    // SIMD-optimized (will be compiled with SSE/AVX flags)
#pragma omp simd reduction(+:result)
    for (size_t i = 0; i < dim; i++) {
        result += vec1[i] * vec2[i];
    }

    return result;
}

float EmbeddingBatcher::euclidean_norm(const std::vector<float>& vec) {
    float sum = 0.0f;

#pragma omp simd reduction(+:sum)
    for (const auto& val : vec) {
        sum += val * val;
    }

    return std::sqrt(sum);
}

} // namespace brain
