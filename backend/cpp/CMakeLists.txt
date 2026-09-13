cmake_minimum_required(VERSION 3.12)
project(brain_cpp)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS} -O3 -march=native -fPIC")

# Find required packages
find_package(pybind11 REQUIRED)
find_package(OpenSSL REQUIRED)

# Include directories
include_directories(${CMAKE_CURRENT_SOURCE_DIR}/include)

# Source files
set(SOURCES
    src/chunker.cpp
    src/minhash.cpp
    src/embedding.cpp
    src/utils.cpp
    bindings/brain_cpp.cpp
)

# Create the shared library
pybind11_add_module(brain_cpp ${SOURCES})

# Link libraries
target_link_libraries(brain_cpp PRIVATE OpenSSL::Crypto)

# Set output directory
set_target_properties(brain_cpp PROPERTIES
    LIBRARY_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/lib"
)
