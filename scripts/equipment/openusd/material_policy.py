"""Explicit browser replacements for unsupported USD shading defaults.
These are authored PBR approximations, not reconstructed NVIDIA MDL shaders.
Non-default imported colors are preserved. No texture or network access occurs.
"""
from __future__ import annotations
import re
POLICY = "smart-factory-pbr-v1"
DESCRIPTION = "Unsupported default-gray USD shading is replaced with documented name-based PBR approximations; original MDL shading and textures are not reproduced."

def adapt_material(name: str, color: list[float], metallic: float, roughness: float):
    rgba = list(color)
    if len(rgba) != 4 or any(abs(v - 0.8) > 1e-5 for v in rgba[:3]) or abs(metallic) > 1e-5 or abs(roughness - 0.5) > 1e-5:
        return rgba, metallic, roughness, None
    key = re.sub(r"\.\d+$", "", name.lower().removeprefix("browser_").removeprefix("m_"))
    if "__rubber__" in key:
        values, metal, rough, reason = [0.012, 0.015, 0.018], 0.0, 0.7, "rubber replacement"
    elif "__metal__painted_unique_rack" in key:
        values, metal, rough, reason = [0.025, 0.08, 0.18], 0.15, 0.48, "painted rack replacement"
    elif "__metal__" in key:
        values, metal, rough, reason = [0.38, 0.42, 0.48], 0.78, 0.34, "metal replacement"
    elif "__plastic__" in key:
        palette = {
            "black": [0.018, 0.022, 0.028], "white": [0.52, 0.55, 0.58],
            "grey": [0.16, 0.18, 0.21], "gray": [0.16, 0.18, 0.21],
            "green": [0.012, 0.22, 0.035], "red": [0.38, 0.015, 0.012],
            "orange": [0.6, 0.12, 0.012], "yellow": [0.65, 0.38, 0.015],
            "blue": [0.018, 0.07, 0.28], "screen": [0.012, 0.025, 0.04],
        }
        shade = next((k for k in palette if k in key), None)
        values, metal, rough, reason = palette.get(shade, [0.18, 0.2, 0.23]), 0.0, 0.5, "plastic replacement"
    else:
        values, metal, rough, reason = [0.25, 0.27, 0.3], 0.0, 0.5, "neutral replacement"
    return values + [rgba[3]], metal, rough, reason
