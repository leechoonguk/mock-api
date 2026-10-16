"""Settings validation: a misconfigured process must refuse to start, not serve wrongly."""

import pytest
from pydantic import ValidationError

from app.core.settings import Settings


VALID = {
    "app_name": "Mock API",
    "env": "local",
    "database_url": "sqlite+aiosqlite:///./data/mock.db",
    "allowed_hosts": ["localhost"],
    "csrf_trusted_origins": ["http://localhost:5173"],
    "items_per_user": 20,
}


def _settings(**overrides: object) -> Settings:
    return Settings(_env_file=None, **{**VALID, **overrides})  # type: ignore[arg-type]


def test_valid_settings_default_cors_to_any_origin() -> None:
    """Without CORS_ORIGINS every origin may call the mocks, which is their purpose."""
    settings = _settings()
    assert settings.cors_origins == ["*"]
    assert settings.env == "local"


def test_unknown_environment_is_refused() -> None:
    """A typo in ENV would silently pick the wrong log renderer, so it stops startup."""
    with pytest.raises(ValidationError, match="env must be"):
        _settings(env="staging")


def test_empty_host_allowlist_is_refused() -> None:
    """An empty allowlist would refuse every request; a missing one must not open the app."""
    with pytest.raises(ValidationError, match="allowed_hosts"):
        _settings(allowed_hosts=[])


def test_non_sqlite_database_url_is_refused() -> None:
    """The engine and migrations are SQLite-only; another scheme would fail at first query."""
    with pytest.raises(ValidationError, match="database_url"):
        _settings(database_url="postgresql://db/app")


def test_required_fields_have_no_fallback() -> None:
    """A missing Host allowlist stops startup rather than defaulting to accept-anything."""
    with pytest.raises(ValidationError, match="allowed_hosts"):
        Settings(_env_file=None, **{k: v for k, v in VALID.items() if k != "allowed_hosts"})  # type: ignore[arg-type]
