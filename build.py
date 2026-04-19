#!/usr/bin/env python3
"""Preprocess the Thompson Motif Index JSON into smaller files the browser can load quickly.

Outputs into ./data:
  - metadata.json          dataset metadata + chapter summary
  - chapter-<LETTER>.json  all motifs for that chapter (full fields)
  - search.json            lean search index (id, name, chapter, section, lemmas, region)
"""

import json
from pathlib import Path
from collections import defaultdict

ROOT = Path(__file__).parent
SRC = ROOT / "thompson_motif_index_v1.2.json"
OUT = ROOT / "data"
OUT.mkdir(exist_ok=True)


def chapter_letter(ch: str) -> str:
    return ch.split(".", 1)[0].strip() if ch else ""


def main() -> None:
    with SRC.open() as f:
        data = json.load(f)

    motifs = data["motifs"]

    by_chapter: dict[str, list] = defaultdict(list)
    for m in motifs:
        letter = chapter_letter(m.get("chapter") or "")
        by_chapter[letter or "?"].append(m)

    chapter_summary = []
    for letter, items in sorted(by_chapter.items()):
        title = items[0].get("chapter", f"{letter}.")
        sections: dict[str, int] = defaultdict(int)
        for m in items:
            sec = m.get("section") or ""
            if sec:
                sections[sec] += 1
        chapter_summary.append(
            {
                "letter": letter,
                "title": title,
                "count": len(items),
                "sections": [
                    {"name": name, "count": count}
                    for name, count in sorted(sections.items())
                ],
            }
        )
        out_path = OUT / f"chapter-{letter}.json"
        with out_path.open("w") as f:
            json.dump(items, f, ensure_ascii=False, separators=(",", ":"))
        print(f"  chapter {letter}: {len(items):>5} motifs -> {out_path.name}")

    metadata_out = {
        "metadata": data.get("metadata", {}),
        "chapters": chapter_summary,
    }
    with (OUT / "metadata.json").open("w") as f:
        json.dump(metadata_out, f, ensure_ascii=False, separators=(",", ":"))

    search = [
        {
            "i": m.get("motif_id", ""),
            "n": m.get("name", ""),
            "c": chapter_letter(m.get("chapter") or ""),
            "s": m.get("section", ""),
            "l": m.get("lemmas") or [],
            "r": m.get("cultural_region") or [],
        }
        for m in motifs
    ]
    with (OUT / "search.json").open("w") as f:
        json.dump(search, f, ensure_ascii=False, separators=(",", ":"))

    print()
    print(f"Total motifs: {len(motifs)}")
    print(f"Chapters: {len(chapter_summary)}")
    print(f"Wrote data to {OUT}")


if __name__ == "__main__":
    main()
