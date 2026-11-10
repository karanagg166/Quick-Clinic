"""Lease-based, ordered delivery of durable realtime notification intents."""

import logging
from datetime import timedelta
from uuid import uuid4

from sqlalchemy import and_, or_, select, update

from app.infrastructure.database import tables, utcnow

logger = logging.getLogger(__name__)


async def dispatch_outbox(db, limit=20):
    from app.infrastructure.realtime import publish_outbox

    outbox = tables["NotificationOutbox"]
    older = outbox.alias("older_outbox")
    now = utcnow()
    rows = (
        (
            await db.execute(
                select(outbox)
                .where(
                    outbox.c.status.in_(("PENDING", "PROCESSING", "FAILED")),
                    or_(outbox.c.leaseExpiresAt.is_(None), outbox.c.leaseExpiresAt <= now),
                    or_(outbox.c.nextAttemptAt.is_(None), outbox.c.nextAttemptAt <= now),
                    # One oldest undelivered intent per recipient prevents stale status replay
                    # from overtaking a newer update when multiple workers are active.
                    ~select(older.c.id)
                    .where(
                        older.c.targetUserId == outbox.c.targetUserId,
                        older.c.status != "DELIVERED",
                        or_(
                            older.c.createdAt < outbox.c.createdAt,
                            and_(older.c.createdAt == outbox.c.createdAt, older.c.id < outbox.c.id),
                        ),
                    )
                    .exists(),
                )
                .order_by(outbox.c.createdAt, outbox.c.id)
                .limit(limit)
                .with_for_update(skip_locked=True)
            )
        )
        .mappings()
        .all()
    )
    lease_owner = str(uuid4())
    ids = [row["id"] for row in rows]
    if not ids:
        return {"delivered": 0, "failed": 0}
    await db.execute(
        update(outbox)
        .where(outbox.c.id.in_(ids))
        .values(
            status="PROCESSING",
            leaseOwner=lease_owner,
            leaseExpiresAt=now + timedelta(seconds=30),
            attempts=outbox.c.attempts + 1,
            lastAttemptAt=now,
        )
    )
    await db.commit()
    result = {"delivered": 0, "failed": 0}
    for row in rows:
        try:
            await publish_outbox(row["channel"], row["targetUserId"], row["payload"])
            await db.execute(
                update(outbox)
                .where(outbox.c.id == row["id"], outbox.c.leaseOwner == lease_owner)
                .values(status="DELIVERED", deliveredAt=utcnow(), leaseOwner=None, leaseExpiresAt=None)
            )
            result["delivered"] += 1
        except Exception:
            logger.exception("Realtime outbox delivery failed for %s", row["id"])
            await db.execute(
                update(outbox)
                .where(outbox.c.id == row["id"], outbox.c.leaseOwner == lease_owner)
                .values(
                    status="FAILED",
                    lastError="Realtime delivery failed",
                    leaseOwner=None,
                    leaseExpiresAt=None,
                    nextAttemptAt=utcnow() + timedelta(seconds=30),
                )
            )
            result["failed"] += 1
        await db.commit()
    return result
