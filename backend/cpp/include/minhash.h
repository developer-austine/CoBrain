#pragma once

#include <vector>
#include <string>
#include <cstdint>
#include <memory>

namespace brain {

class MinHash {
public:
    /**
     * Initialize MinHash with a fixed number of hash functions.
     * Default: 128 (from config.py MINHASH_NUM_HASHES)
     */
    explicit MinHash(int num_hashes = 128);
    ~MinHash() = default;

    /**
     * Compute MinHash signature from text.
     *
     * @param text The input text to hash
     * @return Vector of 128 uint32_t hash values representing the document signature
     */
    std::vector<uint32_t> compute_signature(const std::string& text);

    /**
     * Compute Jaccard similarity between two MinHash signatures.
     * Range: [0.0, 1.0] where 1.0 = identical, 0.0 = no overlap
     *
     * @param sig1 First signature
     * @param sig2 Second signature
     * @return Jaccard similarity estimate
     */
    static double jaccard_similarity(
        const std::vector<uint32_t>& sig1,
        const std::vector<uint32_t>& sig2
    );

private:
    int num_hashes_;
    std::vector<uint32_t> seeds_;  // Random seeds for each hash function

    // Initialize random seeds for deterministic hashing
    void initialize_seeds();

    // Murmur3-like fast hash function (SIMD-friendly)
    uint32_t hash32(const std::string& s, uint32_t seed) const;

    // Extract k-shingles (tokens) from text
    std::vector<std::string> extract_shingles(const std::string& text, int k = 2) const;

    // Compute hash for a single shingle (SIMD-optimized loop)
    uint32_t shingle_hash(const std::string& shingle, uint32_t seed) const;
};

} // namespace brain
