#include <pybind11/pybind11.h>
#include <pybind11/stl.h>
#include "chunker.h"
#include "minhash.h"
#include "embedding.h"
#include "utils.h"

namespace py = pybind11;
using namespace brain;

PYBIND11_MODULE(brain_cpp, m) {
    m.doc() = "Company Brain C++ optimization module for chunking, hashing, and embedding";

    // ===== Chunker Bindings =====
    py::class_<ChunkMetadata>(m, "ChunkMetadata")
        .def(py::init<>())
        .def_readwrite("chunk_index", &ChunkMetadata::chunk_index)
        .def_readwrite("total_chunks", &ChunkMetadata::total_chunks)
        .def_readwrite("char_start", &ChunkMetadata::char_start)
        .def_readwrite("char_end", &ChunkMetadata::char_end)
        .def_readwrite("token_count", &ChunkMetadata::token_count);

    py::class_<Chunk>(m, "Chunk")
        .def(py::init<>())
        .def_readwrite("text", &Chunk::text)
        .def_readwrite("metadata", &Chunk::metadata);

    py::class_<Chunker>(m, "Chunker")
        .def(py::init<int, int>(), py::arg("chunk_size") = 512, py::arg("overlap") = 102)
        .def("chunk", &Chunker::chunk,
             "Split text into overlapping chunks",
             py::arg("text"), py::arg("source"), py::arg("parent_doc_id"))
        .def_static("estimate_tokens", &Chunker::estimate_tokens,
                    "Estimate token count from text");

    // ===== MinHash Bindings =====
    py::class_<MinHash>(m, "MinHash")
        .def(py::init<int>(), py::arg("num_hashes") = 128)
        .def("compute_signature", &MinHash::compute_signature,
             "Compute MinHash signature from text",
             py::arg("text"))
        .def_static("jaccard_similarity", &MinHash::jaccard_similarity,
                    "Compute Jaccard similarity between two signatures",
                    py::arg("sig1"), py::arg("sig2"));

    // ===== EmbeddingBatcher Bindings =====
    py::class_<EmbeddingBatcher>(m, "EmbeddingBatcher")
        .def(py::init<const std::string&, bool>(),
             py::arg("model_path") = "", py::arg("use_gpu") = false)
        .def("embed_batch", &EmbeddingBatcher::embed_batch,
             "Embed a batch of texts (Phase 2: ONNX integration)",
             py::arg("texts"))
        .def_static("l2_normalize", &EmbeddingBatcher::l2_normalize,
                    "L2 normalize a vector in-place",
                    py::arg("vec"))
        .def_static("cosine_similarity", &EmbeddingBatcher::cosine_similarity,
                    "Compute cosine similarity between two vectors",
                    py::arg("vec1"), py::arg("vec2"));

    // ===== Utils Bindings =====
    m.def("sha256", &utils::sha256,
          "Compute SHA-256 hash of a string",
          py::arg("input"));

    m.def("tokenize", &utils::tokenize,
          "Tokenize text into words",
          py::arg("text"));

    m.def("count_tokens_fast", &utils::count_tokens_fast,
          "Fast token count estimation",
          py::arg("text"));

    m.def("iequals", &utils::iequals,
          "Case-insensitive string comparison",
          py::arg("a"), py::arg("b"));

    m.def("trim", &utils::trim,
          "Trim whitespace from both ends",
          py::arg("str"));

    m.def("split", &utils::split,
          "Split string by delimiter",
          py::arg("str"), py::arg("delimiter"));

    m.def("to_lower_utf8", &utils::to_lower_utf8,
          "Convert to lowercase (UTF-8 safe)",
          py::arg("str"));

    m.def("is_punctuation", &utils::is_punctuation,
          "Check if character is punctuation",
          py::arg("c"));

    m.def("is_whitespace", &utils::is_whitespace,
          "Check if character is whitespace",
          py::arg("c"));
}
