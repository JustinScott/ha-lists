"""Bundle English strings for this custom integration without Core-only scripts."""

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
INTEGRATION = ROOT / "custom_components" / "ha_lists"


if __name__ == "__main__":
    source = json.loads((INTEGRATION / "strings.json").read_text(encoding="utf-8"))
    target = INTEGRATION / "translations" / "en.json"
    target.parent.mkdir(exist_ok=True)
    target.write_text(
        json.dumps(source, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
