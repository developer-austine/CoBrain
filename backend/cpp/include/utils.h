#pragma once

#include <string>
#include <vector>
#include <cstdint>

namespace brain {
namespace utils {

/**
 * SHA-256 content hashing (used for deduplication in Python)
 * Delegates to OpenSSL for security-critical operations.
 */
std::string sha256(const std::string& input);

/**
 * Fast string tokenization for token counting.
 * Splits on whitespace and punctuation.
 */
std::vector<std::string> tokenize(const std::string& text);

/**
 * Count tokens using fast heuristic (for efficiency).
 * Heuristic: tokens ≈ word_count (more accurate than char-based)
 */
int count_tokens_fast(const std::string& text);

/**
 * Case-insensitive string comparison.
 */
bool iequals(const std::string& a, const std::string& b);

/**
 * Strip whitespace from both ends.
 */
std::string trim(const std::string& str);

/**
 * Split string by delimiter.
 */
std::vector<std::string> split(const std::string& str, char delimiter);

/**
 * Convert UTF-8 string to lowercase (handles multi-byte chars).
 */
std::string to_lower_utf8(const std::string& str);

/**
 * Check if character is punctuation.
 */
bool is_punctuation(char c);

/**
 * Check if character is whitespace.
 */
bool is_whitespace(char c);

} // namespace utils
} // namespace brain
