"""Isolated test infrastructure; no configured external database or services."""

# ruff: noqa: E402 -- credentials must be isolated before importing the application

import os
import ipaddress
import socket
from uuid import uuid4

# Override before importing application modules: collection must never load a
# developer's Neon, Redis, mail or payment credentials from the local .env.
for _key, _value in {
    "DATABASE_URL": "sqlite+aiosqlite://",
    "JWT_SECRET": "isolated-test-signing-secret-32-characters",
    "NODE_ENV": "test",
    "FRONTEND_URL": "http://localhost:3000",
    "BACKEND_PUBLIC_URL": "http://localhost:4000",
    "DOCUMENT_STORAGE_BACKEND": "local",
    "CRON_SECRET": "isolated-test-cron-secret",
    "INTERNAL_API_SECRET": "isolated-test-internal-secret",
    "SUPER_ADMIN_CODE": "isolated-test-super-admin-code",
    "REDIS_URL": "",
    "RESEND_API_KEY": "",
    "RAZORPAY_KEY_ID": "",
    "RAZORPAY_KEY_SECRET": "",
    "RAZORPAY_WEBHOOK_SECRET": "",
    "SUPABASE_URL": "",
    "SUPABASE_SECRET_KEY": "",
    "OPENROUTESERVICE_API_KEY": "",
}.items():
    os.environ[_key] = _value

import httpx
import pytest
import pytest_asyncio
from sqlalchemy import insert, text
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy.engine import make_url

from app.core.config import get_settings
from app.infrastructure.database import get_db, metadata, new_id, tables
from app.features.auth.passwords import hash_password


def pytest_addoption(parser):
    parser.addoption(
        "--run-live", action="store_true", help="Enable explicitly selected read-only live probes"
    )


def pytest_collection_modifyitems(config, items):
    for item in items:
        parts = item.path.parts
        for category in ("unit", "features", "integration", "security", "performance", "smoke", "live"):
            if category in parts:
                item.add_marker(getattr(pytest.mark, "feature" if category == "features" else category))
        if "test_postgres" in item.path.name:
            item.add_marker(pytest.mark.integration)
            item.add_marker(pytest.mark.postgres)
        if "live" in parts and not config.getoption("--run-live"):
            item.add_marker(pytest.mark.skip(reason="Read-only live probes require --run-live"))


@pytest.fixture(autouse=True)
def isolated_runtime(monkeypatch, tmp_path, request):
    settings = get_settings()
    for field, value in {
        "jwt_secret": "isolated-test-signing-secret-32-characters",
        "node_env": "test",
        "redis_url": "",
        "resend_api_key": "",
        "cron_secret": "isolated-test-cron-secret",
        "internal_api_secret": "isolated-test-internal-secret",
        "super_admin_code": "isolated-test-super-admin-code",
        "razorpay_key_id": "",
        "razorpay_key_secret": "",
        "razorpay_webhook_secret": "",
        "supabase_url": "",
        "supabase_secret_key": "",
        "openrouteservice_api_key": "",
        "document_storage_dir": tmp_path / "documents",
        "document_storage_backend": "local",
        "frontend_url": "http://localhost:3000",
        "backend_public_url": "http://localhost:4000",
    }.items():
        monkeypatch.setattr(settings, field, value)
    from app.core.middleware import _rate_windows

    _rate_windows.clear()
    # Mock transports and loopback sockets work; accidental paid/provider traffic
    # fails immediately. The disposable PostgreSQL hostname is the sole exception.
    allowed = set()
    raw = os.environ.get("QC_TEST_DATABASE_URL")
    if raw:
        host = make_url(raw).host
        if host:
            allowed.update(row[4][0] for row in socket.getaddrinfo(host, None))
    if request.node.get_closest_marker("live") and request.config.getoption("--run-live"):
        from urllib.parse import urlsplit

        for key in ("QC_LIVE_BACKEND_URL", "QC_LIVE_FRONTEND_URL"):
            host = urlsplit(os.environ.get(key, "")).hostname
            if host:
                allowed.update(row[4][0] for row in socket.getaddrinfo(host, None))
    original = socket.socket.connect

    def guarded_connect(sock, address):
        if sock.family in (socket.AF_INET, socket.AF_INET6):
            host = address[0]
            try:
                local = ipaddress.ip_address(host).is_loopback
            except ValueError:
                local = host == "localhost"
            if not local and host not in allowed:
                raise AssertionError("External network disabled in isolated tests; mock the provider")
        return original(sock, address)

    monkeypatch.setattr(socket.socket, "connect", guarded_connect)
    yield
    _rate_windows.clear()


@pytest_asyncio.fixture
async def db():
    engine = create_async_engine("sqlite+aiosqlite://")
    async with engine.connect() as connection:
        await connection.execute(text("PRAGMA foreign_keys=ON"))
        await connection.commit()
        await connection.run_sync(metadata.create_all)
        await connection.commit()
        yield connection
        await connection.rollback()
    await engine.dispose()


@pytest_asyncio.fixture
async def client(db):
    from app.main import api

    async def isolated_connection():
        # Persist explicit fixture setup before exercising request rollback.
        await db.commit()
        try:
            yield db
            await db.commit()
        except BaseException:
            await db.rollback()
            raise

    api.dependency_overrides[get_db] = isolated_connection
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=api), base_url="http://test") as http:
        yield http
    api.dependency_overrides.pop(get_db, None)


@pytest_asyncio.fixture
async def seed_user(db):
    async def seed(role="PATIENT", user_id=None, profile=None, **values):
        user_id = user_id or new_id()
        location = tables["Location"]
        from sqlalchemy import select

        if not (await db.execute(select(location.c.pincode).where(location.c.pincode == 110001))).first():
            await db.execute(insert(location).values(pincode=110001, city="Delhi", state="Delhi"))
        user = dict(
            id=user_id,
            email=f"{user_id}@example.test",
            name="Test User",
            phoneNo="9999999999",
            password=hash_password("password123"),
            age=30,
            gender="MALE",
            role=role,
            address="Test street",
            pinCode=110001,
            isActive=True,
            emailVerified=True,
        )
        user.update(values)
        await db.execute(insert(tables["User"]).values(**user))
        model = {"PATIENT": "Patient", "DOCTOR": "Doctor", "ADMIN": "Admin"}[role]
        child = dict(id=new_id(), userId=user_id)
        if role == "DOCTOR":
            child.update(specialty="GENERAL_PHYSICIAN", fees=500, balance=0)
        child.update(profile or {})
        await db.execute(insert(tables[model]).values(**child))
        return {**user, f"{model.lower()}Id": child["id"]}

    return seed


@pytest_asyncio.fixture
async def pg_engine():
    """Opt-in real PostgreSQL with a unique schema per test and no shared rows.

    QC_TEST_DATABASE_URL must explicitly name a disposable test database. The
    ordinary DATABASE_URL is never used by this fixture.
    """
    raw = os.environ.get("QC_TEST_DATABASE_URL")
    if not raw:
        if os.environ.get("QC_REQUIRE_POSTGRES") == "true":
            pytest.fail("Required PostgreSQL integration tests need QC_TEST_DATABASE_URL")
        pytest.skip("QC_TEST_DATABASE_URL is not configured")
    url = make_url(raw)
    if not url.drivername.startswith("postgresql") or "test" not in (url.database or "").lower():
        pytest.fail("QC_TEST_DATABASE_URL must point to a PostgreSQL database with 'test' in its name")
    query = dict(url.query)
    mode = query.pop("sslmode", None)
    query.pop("channel_binding", None)
    if mode and mode != "disable":
        query["ssl"] = "require"
    url = url.set(drivername="postgresql+asyncpg", query=query)
    schema_name = "qc_test_" + uuid4().hex
    admin_engine = create_async_engine(url)
    engine = None
    async with admin_engine.begin() as connection:
        await connection.execute(text(f'CREATE SCHEMA "{schema_name}"'))
    try:
        engine = create_async_engine(url, connect_args={"server_settings": {"search_path": schema_name}})
        async with engine.begin() as connection:
            await connection.run_sync(metadata.create_all)
        yield engine
    finally:
        if engine is not None:
            await engine.dispose()
        async with admin_engine.begin() as connection:
            await connection.execute(text(f'DROP SCHEMA "{schema_name}" CASCADE'))
        await admin_engine.dispose()
