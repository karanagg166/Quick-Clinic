"""Import one already-exported legacy file without calling the retired search service.

Usage: uv run python -m scripts.import_document DOCUMENT_ID /secure/export/file.pdf
Export files and keep backups before running this explicitly; no imports run on startup.
"""

import asyncio
import hashlib
import sys
from pathlib import Path
from sqlalchemy import select, update
from app.infrastructure.database import engine, tables
from app.features.documents.storage import validate_file
from app.features.documents import files


async def main(document_id: str, source: Path):
    documents = tables["MedicalDocument"]
    async with engine.begin() as db:
        row = (
            (await db.execute(select(documents).where(documents.c.id == document_id).with_for_update()))
            .mappings()
            .one()
        )
        if row["storagePath"].startswith(("local/", "cloudinary/")):
            raise SystemExit("Document is already managed by application storage")
        data = source.read_bytes()
        validate_file(data, row["mimeType"])
        if len(data) != row["fileSize"]:
            raise SystemExit("File size does not match document metadata")
        relative = files.upload_key(row["patientId"], document_id, hashlib.sha256(data).hexdigest())
        await files.write_file(relative, data, row["fileName"], row["mimeType"])
        try:
            await db.execute(
                update(documents).where(documents.c.id == document_id).values(storagePath=relative)
            )
        except BaseException:
            await files.remove_file(relative)
            raise
    await engine.dispose()


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit("Usage: uv run python -m scripts.import_document DOCUMENT_ID FILE")
    asyncio.run(main(sys.argv[1], Path(sys.argv[2])))
