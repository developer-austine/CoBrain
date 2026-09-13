import sys
from pathlib import Path

# `m_learning` is imported as a top-level package (from m_learning.config import
# CFG), so its parent must be on the path when tests run from anywhere.
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
