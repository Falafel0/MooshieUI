"""
Anima Artist Mixer — ComfyUI custom nodes for artist style mixing.

This package provides three node types:
1. AnimaArtistPack — packs artist names + base prompt into conditionings
2. AnimaArtistCrossAttn — patches model cross-attention for artist mixing
3. AnimaArtistAdapterMixer — post-adapter embedding-space mixing

Also includes helper nodes:
- AnimaArtistOptions — advanced options for cross-attn mixing
- AnimaArtistStructureOptions — structure control options
- AnimaArtistStyleBalance — style balance options
"""

from .anima_mixer import NODE_CLASS_MAPPINGS, NODE_DISPLAY_NAME_MAPPINGS
from .anima_mixer.nodes_embedding import AnimaArtistAdapterMixer
from .anima_mixer.nodes_core import AnimaArtistCrossAttn, AnimaArtistPack
from .anima_mixer.nodes_ui import (
    AnimaArtistOptions,
    AnimaArtistStructureOptions,
    AnimaArtistStyleBalance,
)

__all__ = [
    "NODE_CLASS_MAPPINGS",
    "NODE_DISPLAY_NAME_MAPPINGS",
    "AnimaArtistPack",
    "AnimaArtistCrossAttn",
    "AnimaArtistAdapterMixer",
    "AnimaArtistOptions",
    "AnimaArtistStructureOptions",
    "AnimaArtistStyleBalance",
]