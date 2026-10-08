from __future__ import annotations

import re


_TURKISH_CASE_TRANSLATION = str.maketrans({"I": "ı", "İ": "i"})


def normalize_for_match(value: str) -> str:
    """Normalize casing without losing Turkish dotted/dotless i semantics."""
    return value.translate(_TURKISH_CASE_TRANSLATION).casefold()


def word_tokens(value: str) -> list[str]:
    return re.findall(r"[^\W_]+", normalize_for_match(value), flags=re.UNICODE)


def matching_tokens(value: str) -> set[str]:
    """Return source tokens plus conservative Turkish inflection variants for retrieval."""
    tokens = set(word_tokens(value))
    variants = set(tokens)
    suffixes = (
        "larımız",
        "lerimiz",
        "larınız",
        "leriniz",
        "ları",
        "leri",
        "lar",
        "ler",
        "dan",
        "den",
        "dır",
        "dir",
        "dur",
        "dür",
        "tır",
        "tir",
        "tur",
        "tür",
        "ın",
        "in",
        "un",
        "ün",
        "ı",
        "i",
        "u",
        "ü",
    )
    frontier = set(tokens)
    for _ in range(2):
        next_frontier: set[str] = set()
        for token in frontier:
            for suffix in suffixes:
                if token.endswith(suffix) and len(token) - len(suffix) >= 4:
                    variant = token[: -len(suffix)]
                    if variant not in variants:
                        variants.add(variant)
                        next_frontier.add(variant)
                    break
        frontier = next_frontier
    return variants


def status_label(value: str) -> str:
    return {"active": "geçerli", "stale": "yeniden incelenmeli", "reversed": "tersine döndü", "weakening": "zayıflıyor", "invalidated": "geçersiz"}.get(value, value)
