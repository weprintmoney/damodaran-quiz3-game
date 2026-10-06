"""Validate questions.json: lesson alignment, schema, and chapter coverage.

Gated chapters must only hold questions tagged to Module 3 (lessons 20-26).
Exit 1 on any problem.
"""
import json
import sys
from collections import Counter
from pathlib import Path

CHAPTER_LESSONS = {
    "warmup": {17, 18, 19},
    "l20": {20},
    "l21": {21},
    "l22": {22},
    "l23": {23},
    "l24-25": {24, 25},
    "l26": {26},
}
MIN_PER_CHAPTER = 5

bank = json.loads((Path(__file__).parent.parent / "questions.json").read_text())
errors = []
ids = Counter(q["id"] for q in bank)
errors += [f"duplicate id {i}" for i, n in ids.items() if n > 1]

for q in bank:
    qid = q.get("id", "?")
    ch, lesson = q.get("chapter"), q.get("lesson")
    if ch not in CHAPTER_LESSONS:
        errors.append(f"{qid}: unknown chapter {ch!r}")
        continue
    if lesson not in CHAPTER_LESSONS[ch]:
        errors.append(f"{qid}: lesson {lesson} doesn't belong in chapter {ch}")
    if ch == "warmup" and q.get("holdout"):
        errors.append(f"{qid}: warm-up questions can't be holdouts")
    for k in ("context", "steps", "intuition"):
        if not q.get(k):
            errors.append(f"{qid}: missing {k}")
    src, basis = q.get("source"), q.get("basis")
    if src is not None and not str(src.get("url", "")).startswith("https://"):
        errors.append(f"{qid}: source needs an https url")
    if src is None and not (basis and basis.get("label")):
        errors.append(f"{qid}: no professor source (needs source or basis)")
    if basis and basis.get("url") and not basis["url"].startswith("https://"):
        errors.append(f"{qid}: basis url must be https")
    for i, s in enumerate(q.get("steps", [])):
        if not (s.get("explain_simple") or "").strip():
            errors.append(f"{qid} step {i}: missing explain_simple (from-scratch explanation)")
        if s.get("kind") == "numeric":
            if not isinstance(s.get("answer"), (int, float)):
                errors.append(f"{qid} step {i}: numeric answer missing")
        elif s.get("kind") == "choice":
            ch_list = s.get("choices") or []
            if not (2 <= len(ch_list) <= 5) or not isinstance(s.get("correct"), int) or not 0 <= s["correct"] < len(ch_list):
                errors.append(f"{qid} step {i}: bad choices/correct")
        else:
            errors.append(f"{qid} step {i}: kind must be numeric or choice")

play = Counter(q["chapter"] for q in bank if not q.get("holdout"))
for ch in CHAPTER_LESSONS:
    if play[ch] < MIN_PER_CHAPTER:
        errors.append(f"chapter {ch}: only {play[ch]} playable questions (need {MIN_PER_CHAPTER})")

hold = Counter(q["chapter"] for q in bank if q.get("holdout"))
print("chapter    play  holdout  past-paper  lecture/review")
for ch in CHAPTER_LESSONS:
    qs = [q for q in bank if q["chapter"] == ch]
    past = sum(1 for q in qs if q.get("source"))
    print(f"{ch:<10} {play[ch]:>4}  {hold[ch]:>7}  {past:>10}  {len(qs) - past:>8}")

if errors:
    print("\n".join(["", "FAILED:"] + errors))
    sys.exit(1)
print("\nOK")
