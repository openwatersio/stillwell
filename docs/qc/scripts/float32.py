"""Whether a level rounded to 0.1 mm survives the trip through a 32-bit
float (the store's FLOAT level_m) and the 0.1 mm rounding level() applies on
reading back, by elevation band. Needs numpy.

    python -I docs/qc/scripts/float32.py
"""

import numpy as np

rng = np.random.default_rng(0)
for lo, hi in [(0, 10), (100, 200), (500, 1000), (1000, 1100), (1500, 1600), (2000, 2100), (3800, 3900)]:
    x = np.round(rng.uniform(lo, hi, 200_000) * 1e4) / 1e4
    back = np.round(x.astype(np.float32).astype(np.float64) * 1e4) / 1e4
    print(f"{lo} to {hi} m: {np.mean(np.abs(back - x) > 1e-9):.1%} come back changed, by up to {np.max(np.abs(back - x)) * 1000:.2f} mm")
