"""Log rendering: machine-readable JSON in production, readable console lines elsewhere."""

import structlog

from app.core.logging import configure_logging


def _renderer() -> object:
    return structlog.get_config()["processors"][-1]


def test_production_logs_render_as_json() -> None:
    """A log shipper parses production output, so each event is one JSON object."""
    configure_logging("production")
    assert isinstance(_renderer(), structlog.processors.JSONRenderer)


def test_local_logs_render_for_the_console() -> None:
    """A developer reads local output directly, so it is the coloured console format."""
    configure_logging("local")
    assert isinstance(_renderer(), structlog.dev.ConsoleRenderer)
