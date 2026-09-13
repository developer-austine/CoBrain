#include "chunker.h"
#include "utils.h"
#include <algorithm>
#include <cctype>

namespace brain {

Chunker::Chunker(int chunk_size, int overlap)
    : chunk_size_(chunk_size), overlap_(overlap) {}

std::vector<Chunk> Chunker::chunk(
    const std::string& text,
    const std::string& source,
    const std::string& parent_doc_id) {

    std::vector<Chunk> chunks;
    if (text.empty()) {
        return chunks;
    }

    // Identify natural boundaries (paragraphs, headings, etc)
    auto boundaries = identify_boundaries(text, source);

    size_t current_pos = 0;
    int chunk_index = 0;

    while (current_pos < text.length()) {
        // Calculate target end position (chunk_size tokens forward)
        size_t target_end = current_pos;
        int tokens_so_far = 0;

        while (target_end < text.length() && tokens_so_far < chunk_size_) {
            if (text[target_end] == ' ') {
                tokens_so_far++;
            }
            target_end++;
        }

        // Find best split point near target_end
        size_t split_pos = find_best_split(text, current_pos, target_end);

        // Skip to the next non-whitespace character
        while (split_pos < text.length() && is_word_boundary(text[split_pos])) {
            split_pos++;
        }

        // Extract chunk
        std::string chunk_text = text.substr(current_pos, split_pos - current_pos);
        if (!chunk_text.empty()) {
            Chunk chunk;
            chunk.text = chunk_text;
            chunk.metadata.chunk_index = chunk_index;
            chunk.metadata.char_start = current_pos;
            chunk.metadata.char_end = split_pos;
            chunk.metadata.token_count = estimate_tokens(chunk_text);

            chunks.push_back(chunk);
            chunk_index++;
        }

        // Move current_pos back by overlap amount for next iteration
        if (split_pos + overlap_ < text.length()) {
            current_pos = split_pos - (overlap_ * 4); // Rough char-based overlap
            if (current_pos < 0) current_pos = split_pos;
        } else {
            break; // Reached end of text
        }
    }

    // Update total_chunks for all chunks
    for (auto& chunk : chunks) {
        chunk.metadata.total_chunks = chunks.size();
    }

    return chunks;
}

int Chunker::estimate_tokens(const std::string& text) {
    // Heuristic: tokens ≈ chars / 4 for English text
    return std::max(1, static_cast<int>(text.length() / 4));
}

size_t Chunker::find_best_split(
    const std::string& text,
    size_t start,
    size_t target_end) const {

    // Clamp target_end to text bounds
    target_end = std::min(target_end, text.length());

    // Try to split on paragraph boundary (double newline)
    size_t pos = text.rfind("\n\n", target_end);
    if (pos != std::string::npos && pos > start) {
        return pos + 2;
    }

    // Try single newline
    pos = text.rfind('\n', target_end);
    if (pos != std::string::npos && pos > start) {
        return pos + 1;
    }

    // Try sentence boundary (. followed by space)
    pos = target_end;
    while (pos > start && pos < text.length()) {
        if (text[pos] == '.' && pos + 1 < text.length() && is_whitespace(text[pos + 1])) {
            return pos + 1;
        }
        pos--;
    }

    // Fall back to space boundary
    pos = text.rfind(' ', target_end);
    if (pos != std::string::npos && pos > start) {
        return pos;
    }

    // If no boundary found, just return target_end
    return target_end;
}

std::vector<std::pair<size_t, size_t>> Chunker::identify_boundaries(
    const std::string& text,
    const std::string& source) const {

    std::vector<std::pair<size_t, size_t>> boundaries;
    boundaries.push_back({0, text.length()});

    // Source-specific boundary detection
    if (source == "email") {
        // Detect email separators (---, ===, etc)
        size_t pos = 0;
        while ((pos = text.find("\n---", pos)) != std::string::npos) {
            boundaries.push_back({pos, pos + 4});
            pos += 4;
        }
    } else if (source == "notion") {
        // Detect Notion heading markers (#, ##, ###)
        size_t pos = 0;
        while ((pos = text.find("#", pos)) != std::string::npos) {
            if (pos == 0 || is_whitespace(text[pos - 1])) {
                boundaries.push_back({pos, pos + 1});
            }
            pos++;
        }
    }

    return boundaries;
}

bool Chunker::is_word_boundary(char c) {
    return is_whitespace(c) || c == '\n' || c == '\r';
}

} // namespace brain
