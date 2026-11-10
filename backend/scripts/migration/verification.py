"""Safe identifiers and order-independent fingerprints for exact migration checks."""

import hashlib
import json
from pathlib import Path


def identifier(value):
    if not isinstance(value, str) or not value or "\x00" in value:
        raise ValueError("Invalid PostgreSQL identifier")
    return '"' + value.replace('"', '""') + '"'


def fingerprint_query(table_names):
    parts = []
    for name in table_names:
        table = "public." + identifier(name)
        label = "'" + name.replace("'", "''") + "'"
        parts.append(
            f"SELECT {label} AS table_name, count(*)::integer AS row_count, "
            f"md5(coalesce(string_agg(md5(to_jsonb(r)::text), '' ORDER BY md5(to_jsonb(r)::text)),'')) AS fingerprint "
            f"FROM {table} r"
        )
    return " UNION ALL ".join(parts) + " ORDER BY table_name"


def write_private_json(path: Path, value):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    path.touch(mode=0o600, exist_ok=True)
    path.chmod(0o600)
    path.write_text(json.dumps(value, indent=2, default=str) + "\n")


def checksum(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()
