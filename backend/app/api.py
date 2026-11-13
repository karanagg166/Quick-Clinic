
"""Composition root: middleware, errors and feature routers."""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .core.config import get_settings
from .core.errors import register_error_handlers
from .core.lifespan import lifespan
from .core.middleware import request_guards
from .core.serialization import utc_endpoint

from .features.accounts.router import router as accounts
from .features.admin.router import router as administration
from .features.ai_agent.router import router as ai_agent
from .features.auth.router import router as authentication
from .features.booking.router import router as booking
from .features.doctors.router import router as doctors
from .features.documents.router import router as documents
from .features.health.router import router as health
from .features.messaging.router import router as messaging
from .features.operations.router import router as operations
from .features.patients.router import router as patients
from .features.payments.router import router as payments
from .features.scheduling.router import router as scheduling


def create_api() -> FastAPI:
    application = FastAPI(
        title="Quick-Clinic API",
        version="1.0.0",
        lifespan=lifespan,
    )

    application.add_middleware(
        CORSMiddleware,
        allow_origins=get_settings().cors_origins,
        allow_credentials=True,
        allow_methods=[
            "GET",
            "POST",
            "PUT",
            "PATCH",
            "DELETE",
            "OPTIONS",
        ],
        allow_headers=[
            "Authorization",
            "Content-Type",
            "Idempotency-Key",
            "X-Request-ID",
        ],
    )

    application.middleware("http")(request_guards)
    register_error_handlers(application)

    for feature in (
        health,
        authentication,
        accounts,
        administration,
        documents,
        patients,
        doctors,
        scheduling,
        messaging,
        booking,
        payments,
        operations,
        ai_agent,
    ):
        for route in feature.routes:
            route.endpoint = utc_endpoint(route.endpoint)

        application.include_router(feature)

    return application
