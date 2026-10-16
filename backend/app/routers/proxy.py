# ============================================================
# Imports
# ============================================================

from __future__ import annotations

from fastapi import APIRouter, Response

from app.core.exceptions import NotFoundError
from app.core.proxy import ca_certificate
from app.core.settings import PROXY_HOST, settings
from app.dependencies.core import InterceptingProxyDep
from app.schemas.proxy import PassedHostResponse, ProxyStatusResponse


# ============================================================
# Constants
# ============================================================

#: What a downloaded CA certificate is served as, and the name it is saved under:
#: `.crt`, which Windows opens in its certificate installer on a double click.
CA_MEDIA_TYPE = "application/x-x509-ca-cert"
CA_FILENAME = "mock-api-ca.crt"

#: How many passed-through hosts the status lists - the screen's page of candidates.
PASSED_HOSTS_SHOWN = 100


# ============================================================
# Router
# ============================================================

# The forward proxy the API runs beside: where to point a client, and the CA
# certificate it must trust before the proxy can read its HTTPS.
router = APIRouter(prefix="/proxy", tags=["proxy"])


@router.get("/")
async def get_proxy_status(intercepting_proxy: InterceptingProxyDep) -> ProxyStatusResponse:
    """The proxy's address, whether it listens, its CA, and the hosts it let through."""
    address = None if intercepting_proxy is None else intercepting_proxy.address
    sightings = (
        []
        if intercepting_proxy is None
        else intercepting_proxy.sightings.recent(PASSED_HOSTS_SHOWN)
    )
    return ProxyStatusResponse(
        enabled=settings.proxy_enabled,
        listening=address is not None,
        host=PROXY_HOST if address is None else address[0],
        port=settings.proxy_port if address is None else address[1],
        ca_ready=ca_certificate(settings.proxy_confdir) is not None,
        passed_hosts=[
            PassedHostResponse(host=seen.host, count=seen.count, last_seen=seen.last_seen)
            for seen in sightings
        ],
    )


@router.get("/ca")
async def get_proxy_ca() -> Response:
    """The CA certificate (PEM) to install as trusted; 404 until the proxy first started."""
    certificate = ca_certificate(settings.proxy_confdir)
    if certificate is None:
        raise NotFoundError(CA_FILENAME)
    return Response(
        content=certificate,
        media_type=CA_MEDIA_TYPE,
        headers={"Content-Disposition": f'attachment; filename="{CA_FILENAME}"'},
    )
