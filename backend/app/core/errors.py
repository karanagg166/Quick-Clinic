"""Consistent API errors without leaking request values, database details or secrets."""

import logging
from fastapi import FastAPI, HTTPException, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from sqlalchemy.exc import DBAPIError, IntegrityError

logger = logging.getLogger(__name__)


async def http_error(request: Request, exception: HTTPException):
    payload = exception.detail if isinstance(exception.detail, dict) else {"error": exception.detail}
    return JSONResponse(
        jsonable_encoder(payload), status_code=exception.status_code, headers=exception.headers
    )


async def validation_error(request: Request, exception: RequestValidationError):
    return JSONResponse(
        {
            "error": "Invalid request",
            "details": [{"loc": item["loc"], "msg": item["msg"]} for item in exception.errors()],
        },
        status_code=400,
    )


async def conflict_error(request: Request, exception: IntegrityError):
    return JSONResponse({"error": "The request conflicts with an existing record"}, status_code=409)


async def database_error(request: Request, exception: DBAPIError):
    logger.error("Database operation failed (%s)", type(exception).__name__)
    return JSONResponse(
        {"error": "Database temporarily unavailable", "code": "DATABASE_UNAVAILABLE"}, status_code=503
    )


async def malformed_error(request: Request, exception: ValueError):
    return JSONResponse({"error": "Invalid request"}, status_code=400)


async def unexpected_error(request: Request, exception: Exception):
    logger.error("Request failed (%s)", type(exception).__name__)
    return JSONResponse({"error": "Internal server error"}, status_code=500)


def register_error_handlers(application: FastAPI):
    for exception, handler in (
        (HTTPException, http_error),
        (RequestValidationError, validation_error),
        (IntegrityError, conflict_error),
        (DBAPIError, database_error),
        (ValueError, malformed_error),
        (Exception, unexpected_error),
    ):
        application.add_exception_handler(exception, handler)
