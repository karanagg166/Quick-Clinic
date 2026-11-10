"""Administrative operational and financial summary queries."""

from datetime import timedelta
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncConnection
from app.infrastructure.database import tables, utcnow


async def get_analytics(user: dict, db: AsyncConnection):
    users, doctor, appointment, payment, withdrawal, logs = (
        tables[key] for key in ("User", "Doctor", "Appointment", "Payment", "Withdrawal", "AuditLog")
    )

    async def count(table, *where):
        return (await db.execute(select(func.count()).select_from(table).where(*where))).scalar_one()

    totals = dict((await db.execute(select(users.c.role, func.count()).group_by(users.c.role))).all())
    states = dict(
        (await db.execute(select(appointment.c.status, func.count()).group_by(appointment.c.status))).all()
    )
    paid = (
        await db.execute(
            select(func.coalesce(func.sum(payment.c.amount), 0), func.count()).where(
                payment.c.status == "SUCCESS"
            )
        )
    ).one()
    withdrawn = (
        await db.execute(
            select(func.coalesce(func.sum(withdrawal.c.amount), 0), func.count()).where(
                withdrawal.c.status == "COMPLETED"
            )
        )
    ).one()
    active = (
        await db.execute(
            select(func.count())
            .select_from(doctor.join(users, doctor.c.userId == users.c.id))
            .where(users.c.isActive.is_(True))
        )
    ).scalar_one()
    return {
        "users": {
            "total": sum(totals.values()),
            "doctors": totals.get("DOCTOR", 0),
            "patients": totals.get("PATIENT", 0),
            "admins": totals.get("ADMIN", 0),
            "activeDoctors": active,
        },
        "appointments": {
            "total": sum(states.values()),
            "completed": states.get("COMPLETED", 0),
            "cancelled": states.get("CANCELLED", 0),
        },
        "activity": {
            "recentLogins24h": await count(
                logs, logs.c.action.ilike("%login%"), logs.c.createdAt >= utcnow() - timedelta(hours=24)
            )
        },
        "financials": {
            "grossTransactionVolumePaise": paid[0],
            "grossTransactionVolumeRupees": paid[0] / 100,
            "successfulPaymentsCount": paid[1],
            "totalWithdrawnPaise": withdrawn[0],
            "totalWithdrawnRupees": withdrawn[0] / 100,
            "approvedWithdrawalsCount": withdrawn[1],
        },
    }
