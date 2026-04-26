#!/usr/bin/env python3
"""Preprocess source files into smaller files the browser can load quickly.

Sources (committed alongside this script):
  - thompson_motif_index_v1.2.json  (the integrated motif compilation)
  - atu_index_v1.csv                (ATU tale-type index, 1,584 rows)

Outputs into ./data:
  - metadata.json          dataset metadata + chapter & category summaries
  - chapter-<LETTER>.json  all motifs for that Thompson chapter
  - search.json            lean search index (id, name, chapter, section,
                           lemmas, region) used for the motif search box
  - atu.json               ATU tales + category summary
"""

import csv
import json
import re
from collections import defaultdict
from datetime import date
from pathlib import Path

ROOT = Path(__file__).parent
SRC_MOTIFS = ROOT / "thompson_motif_index_v1.2.json"
SRC_ATU = ROOT / "atu_index_v1.csv"
OUT = ROOT / "data"
OUT.mkdir(exist_ok=True)


# ---------- Thompson motifs ----------


def chapter_letter(ch: str) -> str:
    return ch.split(".", 1)[0].strip() if ch else ""


def build_motifs() -> tuple[list, list]:
    """Returns (chapter_summary, search_items)."""
    with SRC_MOTIFS.open() as f:
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

    print(f"  motifs total: {len(motifs)}")
    return chapter_summary, data.get("metadata", {})


# ---------- ATU tales ----------

# Statuses that should appear in random-pick pools and the browse list.
# `merged`/`retired` are deliberately excluded; `unassigned` are
# placeholder ranges (e.g. "10-14") with no real entry.
INCLUDED_STATUSES = {"active", "uncertain"}


def split_list(s: str) -> list[str]:
    """Split a semicolon-separated cell into a clean list. Empty/dash entries dropped."""
    if not s:
        return []
    parts = [p.strip() for p in s.split(";")]
    return [p for p in parts if p and p != "—" and p != "-"]


URL_RE = re.compile(r"https?://\S+")


def split_urls(s: str) -> list[str]:
    """Source URLs are sometimes semicolon-separated, sometimes just space-separated."""
    if not s:
        return []
    urls = URL_RE.findall(s)
    if urls:
        return [u.rstrip(".,;) ") for u in urls]
    return split_list(s)


def build_atu() -> dict:
    """Returns metadata about the ATU build (count, categories)."""
    with SRC_ATU.open(newline="") as f:
        reader = csv.DictReader(f)
        rows = list(reader)

    tales = []
    cat_to_subs: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))

    for r in rows:
        status = (r.get("Status") or "").strip().lower()
        if status not in INCLUDED_STATUSES:
            continue
        atu_id = (r.get("ATU_Number") or "").strip()
        title = (r.get("Title") or "").strip()
        if not atu_id or not title:
            continue
        category = (r.get("Category") or "").strip()
        subsection = (r.get("Subsection") or "").strip()
        notes = (r.get("Notes") or "").strip()
        if notes in ("—", "-"):
            notes = ""

        tales.append(
            {
                "atu_id": atu_id,
                "title": title,
                "category": category,
                "subsection": subsection,
                "status": status,
                "exemplars": split_list(r.get("Exemplar_Tales") or ""),
                "notes": notes,
                "sources": split_urls(r.get("Sources") or ""),
            }
        )
        if category:
            cat_to_subs[category][subsection or ""] += 1

    categories = []
    for name, subs in sorted(cat_to_subs.items()):
        categories.append(
            {
                "name": name,
                "count": sum(subs.values()),
                "subsections": [
                    {"name": s_name, "count": s_count}
                    for s_name, s_count in sorted(subs.items())
                ],
            }
        )

    out = {
        "metadata": {
            "total_tales": len(tales),
            "categories": len(categories),
            "source": SRC_ATU.name,
            "included_statuses": sorted(INCLUDED_STATUSES),
            "generated": date.today().isoformat(),
        },
        "categories": categories,
        "tales": tales,
    }
    with (OUT / "atu.json").open("w") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))

    print(f"  ATU tales: {len(tales)} ({len(categories)} categories)")
    return out


# ---------- main ----------


def main() -> None:
    print("Building motifs...")
    chapter_summary, motif_meta = build_motifs()

    print("\nBuilding ATU tales...")
    atu = build_atu()

    metadata_out = {
        "motifs": {
            "metadata": motif_meta,
            "chapters": chapter_summary,
        },
        "atu": {
            "metadata": atu["metadata"],
            "categories": atu["categories"],
        },
        "generated": date.today().isoformat(),
    }
    with (OUT / "metadata.json").open("w") as f:
        json.dump(metadata_out, f, ensure_ascii=False, separators=(",", ":"))

    print(f"\nWrote data to {OUT}")


if __name__ == "__main__":
    main()
