# ============================================================
# Imports
# ============================================================

from __future__ import annotations

from pydantic import BaseModel, ConfigDict

from app.core.timestamps import UtcDateTime


# ============================================================
# Classes
# ============================================================


class PassedHostResponse(BaseModel):
    """A host the proxy let through without intercepting: a candidate for a project."""

    model_config = ConfigDict(extra="forbid")

    host: str
    #: Connections seen since the proxy started.
    count: int
    last_seen: UtcDateTime


class ProxyStatusResponse(BaseModel):
    """Where to point a browser or app, and whether it can be pointed there yet.

    `listening` is false when the proxy is turned off or could not bind its
    port; `ca_ready` once the CA a client must trust has been generated.
    `passed_hosts` are the hosts it let through untouched, newest first - kept
    in memory, so a restart empties it.
    """

    model_config = ConfigDict(extra="forbid")

    enabled: bool
    listening: bool
    host: str
    port: int
    ca_ready: bool
    passed_hosts: list[PassedHostResponse]
