#pragma once

#include <string>
#include <vector>
#include <memory>

namespace brain {

struct ChunkMetadata {
    int chunk_index;
    int total_chunks;
    int char_start;
    int char_end;
    int token_count;
};

struct Chunk {
    std::string text;
    ChunkMetadata metadata;
};

class Chunker {
public:
    explicit Chunker(int chunk_size = 512, int overlap = 102);
    ~Chunker() = default;

    /**
     * Split text into overlapping chunks.
     *
     * @param text The input text to chunk
     * @param source The source identifier (email, notion, github, custom)
     * @param parent_doc_id The parent document ID for metadata
     * @return Vector of Chunk objects with character offsets and token counts
     */
    std::vector<Chunk> chunk(
        const std::string& text,
        const std::string& source,
        const std::string& parent_doc_id
    );

    /**
     * Estimate token count without full tokenization.
     * Uses the common heuristic: tokens ≈ chars / 4.
     */
    static int estimate_tokens(const std::string& text);

private:
    int chunk_size_;
    int overlap_;

    // Find the best split point (paragraph > newline > sentence > space)
    size_t find_best_split(
        const std::string& text,
        size_t start,
        size_t target_end
    ) const;

    // Split respecting source-specific boundaries (email, Notion headings, etc)
    std::vector<std::pair<size_t, size_t>> identify_boundaries(
        const std::string& text,
        const std::string& source
    ) const;

    // Check if character is a word boundary
    static bool is_word_boundary(char c);
};

} // namespace brain
