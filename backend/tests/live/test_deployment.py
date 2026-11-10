"""Explicitly opt-in GET/OPTIONS probes; no accounts, uploads or clinical data."""

import os
from urllib.parse import urlsplit

import httpx
import pytest

pytestmark = [pytest.mark.live, pytest.mark.smoke]


@pytest.fixture
def deployments():
    urls = {}
    for name in ("BACKEND", "FRONTEND"):
        raw = os.environ.get(f"QC_LIVE_{name}_URL", "").rstrip("/")
        parsed = urlsplit(raw)
        assert (
            parsed.scheme == "https"
            and parsed.hostname
            and not parsed.username
            and not parsed.query
            and parsed.path == ""
        ), "Live probes require explicit HTTPS deployment origins"
        urls[name.lower()] = raw
    return urls


@pytest.mark.parametrize(
    "target,path", [("backend", "/api/health"), ("backend", "/api/ready"), ("frontend", "/api/health")]
)
async def test_deployed_backend_and_frontend_proxy_are_healthy(deployments, target, path):
    async with httpx.AsyncClient(timeout=45, trust_env=False) as client:
        response = await client.get(deployments[target] + path)
    assert response.status_code == 200
    assert response.json()["service"] == "quick-clinic-backend"
    assert response.json()["status"] in ("ok", "ready")


@pytest.mark.parametrize("target", ["backend", "frontend"])
async def test_deployment_does_not_expose_private_files_without_authentication(deployments, target):
    async with httpx.AsyncClient(timeout=45, trust_env=False) as client:
        response = await client.get(deployments[target] + "/api/patients/me/medical-documents")
    assert response.status_code == 401
    assert "documents" not in response.json()
    assert "no-store" in response.headers["cache-control"]


async def test_socket_transport_is_served_by_the_same_backend(deployments):
    async with httpx.AsyncClient(timeout=45, trust_env=False) as client:
        response = await client.get(deployments["backend"] + "/socket.io/?EIO=4&transport=polling")
    assert response.status_code == 200
    assert response.text.startswith('0{"sid":')
    # This is an unauthenticated Engine.IO handshake, never a chat room join.


async def test_frontend_login_renders(deployments):
    async with httpx.AsyncClient(timeout=45, trust_env=False) as client:
        response = await client.get(deployments["frontend"] + "/auth/login")
    assert response.status_code == 200
    assert 'type="password"' in response.text
    assert 'id="email"' in response.text
