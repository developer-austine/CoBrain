#include "minhash.h"
#include "utils.h"
#include <algorithm>
#include <random>
#include <functional>
#include <cctype>

namespace brain {

MinHash::MinHash(int num_hashes)
    : num_hashes_(num_hashes) {
    initialize_seeds();
}

void MinHash::initialize_seeds() {
    // Deterministic seed initialization for reproducible hashes
    std::mt19937 rng(42); // Fixed seed for reproducibility
    std::uniform_int_distribution<uint32_t> dist(1, UINT32_MAX);

    for (int i = 0; i < num_hashes_; i++) {
        seeds_.push_back(dist(rng));
    }
}

std::vector<uint32_t> MinHash::compute_signature(const std::string& text) {
    std::vector<uint32_t> signature(num_hashes_, UINT32_MAX);

    // Extract k-shingles (2-grams of tokens)
    auto shingles = extract_shingles(text, 2);

    // For each shingle, compute hash with all seed functions
    for (const auto& shingle : shingles) {
        for (int i = 0; i < num_hashes_; i++) {
            uint32_t hash = shingle_hash(shingle, seeds_[i]);
            // MinHash keeps the minimum hash value
            signature[i] = std::min(signature[i], hash);
        }
    }

    return signature;
}

double MinHash::jaccard_similarity(
    const std::vector<uint32_t>& sig1,
    const std::vector<uint32_t>& sig2) {

    if (sig1.size() != sig2.size()) {
        return 0.0;
    }

    int matches = 0;
    for (size_t i = 0; i < sig1.size(); i++) {
        if (sig1[i] == sig2[i]) {
            matches++;
        }
    }

    return static_cast<double>(matches) / sig1.size();
}

std::vector<std::string> MinHash::extract_shingles(
    const std::string& text,
    int k) const {

    // Tokenize the text
    auto tokens = utils::tokenize(text);

    std::vector<std::string> shingles;
    for (size_t i = 0; i + k <= tokens.size(); i++) {
        std::string shingle;
        for (int j = 0; j < k; j++) {
            if (j > 0) shingle += " ";
            shingle += tokens[i + j];
        }
        shingles.push_back(shingle);
    }

    return shingles;
}

uint32_t MinHash::hash32(const std::string& s, uint32_t seed) const {
    // MurmurHash3 32-bit variant (simplified for speed)
    uint32_t h1 = seed;

    for (char c : s) {
        h1 ^= (uint32_t)c;
        h1 = (h1 << 13) | (h1 >> 19);
        h1 *= 0x85ebca6b;
    }

    h1 ^= h1 >> 13;
    h1 *= 0xc2b2ae35;
    h1 ^= h1 >> 16;

    return h1;
}

uint32_t MinHash::shingle_hash(const std::string& shingle, uint32_t seed) const {
    return hash32(shingle, seed);
}

} // namespace brain
