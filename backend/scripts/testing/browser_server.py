"""Run a local browser-test server with synthetic rows in an explicit test DB."""

import asyncio
import os
from pathlib import Path
from tempfile import TemporaryDirectory

from sqlalchemy import delete, insert, select
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import create_async_engine


async def prepare(raw):
    from app.features.auth.passwords import hash_password
    from app.infrastructure.database import metadata, tables

    engine = create_async_engine(raw)
    try:
        async with engine.begin() as db:
            await db.run_sync(metadata.create_all)
            # Previous failed runs can leave synthetic metadata after their temporary files were removed.
            await db.execute(
                delete(tables["MedicalDocument"]).where(
                    tables["MedicalDocument"].c.patientId == "browser-profile"
                )
            )
            if not (
                await db.execute(select(tables["User"].c.id).where(tables["User"].c.id == "browser-patient"))
            ).first():
                await db.execute(
                    insert(tables["Location"]).values(pincode=110001, city="Synthetic", state="Synthetic")
                )
                await db.execute(
                    insert(tables["User"]).values(
                        id="browser-patient",
                        email="browser@example.test",
                        name="Browser Patient",
                        phoneNo="9999999999",
                        password=hash_password("browser-test-password"),
                        age=30,
                        gender="MALE",
                        role="PATIENT",
                        address="Test",
                        pinCode=110001,
                        isActive=True,
                        emailVerified=True,
                    )
                )
                await db.execute(
                    insert(tables["Patient"]).values(id="browser-profile", userId="browser-patient")
                )
    finally:
        await engine.dispose()


def main():
    raw = os.environ.get("QC_BROWSER_TEST_DATABASE_URL", "")
    url = make_url(raw) if raw else None
    if not url or url.host not in {"localhost", "127.0.0.1"} or url.database != "quickclinic_e2e_test":
        raise RuntimeError("Browser tests require a local disposable quickclinic_e2e_test database")
    raw = url.set(drivername="postgresql+asyncpg").render_as_string(hide_password=False)
    os.environ.update(
        DATABASE_URL=raw,
        NODE_ENV="test",
        JWT_SECRET="browser-isolated-signing-secret-at-least-32-characters",
        REDIS_URL="",
        RESEND_API_KEY="",
        RAZORPAY_KEY_ID="",
        RAZORPAY_KEY_SECRET="",
        SUPABASE_URL="",
        SUPABASE_SECRET_KEY="",
        DOCUMENT_STORAGE_BACKEND="local",
        FRONTEND_URL="http://localhost:3100",
        BACKEND_PUBLIC_URL="http://localhost:4100",
    )
    with TemporaryDirectory(prefix="quick-clinic-browser-") as directory:
        os.environ["DOCUMENT_STORAGE_DIR"] = str(Path(directory) / "documents")
        asyncio.run(prepare(raw))
        import uvicorn

        uvicorn.run("app.main:app", host="127.0.0.1", port=4100)


if __name__ == "__main__":
    main()
