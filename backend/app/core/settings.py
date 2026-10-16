# ============================================================
# Imports
# ============================================================

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


# ============================================================
# Constants
# ============================================================

#: Where every versioned admin route is mounted - `main.py` reads it here, never
#: retypes it.
API_V1_PREFIX = "/api/v1"

#: Where the forward proxy listens. Loopback only, like the admin API: the
#: proxy decrypts the hosts it intercepts, so it is never offered to the network.
PROXY_HOST = "127.0.0.1"

#: How many request logs one project keeps. The log is a debugging aid, not an
#: archive: a client polling a mock in a loop would otherwise grow the table
#: without bound.
LOG_RETENTION_PER_PROJECT = 1000

#: How much of a request body the log keeps. An upload sent to a mock is the
#: caller's business; the log needs enough to recognise the request.
MAX_LOG_BODY_BYTES = 65536

#: The longest delay an endpoint may declare. A mock that sleeps longer holds a
#: worker and a client connection for no test anyone writes.
MAX_DELAY_MS = 30000

#: The largest real-server answer a recording keeps whole (in the body store),
#: so a binary or long answer - an image, a video segment - can be replayed.
#: Past it the exchange is logged but cannot be saved as an endpoint.
MAX_STORED_BODY_BYTES = 50 * 1024 * 1024

#: The schemes the engine can drive: the app is SQLite-only (aiosqlite).
DATABASE_URL_SCHEME = "sqlite+aiosqlite://"

#: The environments the app distinguishes.
ENVIRONMENTS = frozenset({"local", "test", "production"})


# ============================================================
# Classes
# ============================================================


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_name: str
    env: str
    database_url: str
    # Required, not defaulted: a Host allowlist that falls back to "accept
    # anything" is the vulnerability it exists to close.
    allowed_hosts: list[str]
    # The admin UI's origins. Unsafe admin requests from any other browser
    # origin are refused (CsrfProtection); the mocks are exempt.
    csrf_trusted_origins: list[str]
    items_per_user: int
    # `*` is safe here: there are no cookies or credentials to leak, and the
    # mocks exist to be called from whatever origin the app under test runs on.
    cors_origins: list[str] = ["*"]
    # The forward proxy: off in the test suite, which drives the proxy itself.
    proxy_enabled: bool = True
    proxy_port: int = 47822
    # Where mitmproxy keeps its CA - generated on first start, relative to backend/.
    proxy_confdir: str = "./data/mitmproxy"
    # Where recorded bodies too large or binary for the log live, relative to backend/.
    body_store_dir: str = "./data/bodies"

    @field_validator("env")
    @classmethod
    def validate_env(cls, value: str) -> str:
        if value not in ENVIRONMENTS:
            raise ValueError("env must be local|test|production")
        return value

    @field_validator("allowed_hosts")
    @classmethod
    def validate_allowed_hosts(cls, value: list[str]) -> list[str]:
        if len(value) == 0:
            raise ValueError("allowed_hosts must name at least one host")
        return value

    @field_validator("database_url")
    @classmethod
    def validate_database_url(cls, value: str) -> str:
        if not value.startswith(DATABASE_URL_SCHEME):
            raise ValueError(f"database_url must use the {DATABASE_URL_SCHEME} scheme")
        return value


settings = Settings()  # type: ignore[call-arg] - pydantic-settings reads the fields from the environment
