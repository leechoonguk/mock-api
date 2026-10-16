"""Host patterns: which project's hosts a request's host falls under decides who handles it."""

from app.engine.hosts import best_host_pattern, host_problem, normalize_host


def test_normalize_host_spells_one_form() -> None:
    """A typed host is compared trimmed, lower-case and without a trailing dot."""
    assert normalize_host("  WWW.YouTube.com. ") == "www.youtube.com"


def test_host_problem_takes_names_and_wildcards_only_where_allowed() -> None:
    """A scheme, port, path or bad label is refused; `*.` only where patterns are allowed."""
    assert host_problem("api.example.com", wildcard=False) is None
    assert host_problem("*.example.com", wildcard=True) is None
    assert host_problem("*.example.com", wildcard=False) is not None
    for bad in ("https://example.com", "example.com:443", "example.com/x", "-a.com", "a..com", ""):
        assert host_problem(bad, wildcard=True) is not None, bad
    assert host_problem("a" * 254, wildcard=False) is not None


def test_wildcard_claims_subdomains_but_not_the_bare_domain() -> None:
    """`*.ytimg.com` covers `i.ytimg.com` and deeper names, never `ytimg.com` or a lookalike."""
    assert best_host_pattern(["*.ytimg.com"], "i.ytimg.com") == "*.ytimg.com"
    assert best_host_pattern(["*.ytimg.com"], "a.b.ytimg.com") == "*.ytimg.com"
    assert best_host_pattern(["*.ytimg.com"], "ytimg.com") is None
    assert best_host_pattern(["*.ytimg.com"], "evilytimg.com") is None
    assert best_host_pattern(["youtube.com"], "youtube.com") == "youtube.com"
    assert best_host_pattern(["youtube.com"], "www.youtube.com") is None


def test_best_host_pattern_prefers_exact_then_longest_wildcard() -> None:
    """An exact name beats a wildcard, a narrower wildcard a wider one; no claim is None."""
    patterns = ["*.example.com", "*.api.example.com", "api.example.com"]
    assert best_host_pattern(patterns, "api.example.com") == "api.example.com"
    assert best_host_pattern(patterns, "v1.api.example.com") == "*.api.example.com"
    assert best_host_pattern(patterns, "www.example.com") == "*.example.com"
    assert best_host_pattern(patterns, "example.org") is None
