"""Stable application-service boundary for the doctors feature."""

from .schemas import SPECIALTIES, QUALIFICATIONS, profile_values
from .routing import route_metrics
from .repository import owned_doctor
from .discovery import search_doctors
from .profiles import create_doctor_profile, get_doctor_profile, update_doctor_profile
from .reviews import rating_summary, list_comments, submit_rating, create_comment
from .finances import get_balance, list_earnings, get_doctor_statistics, list_withdrawals, request_withdrawal

__all__ = [
    "SPECIALTIES",
    "QUALIFICATIONS",
    "profile_values",
    "route_metrics",
    "owned_doctor",
    "search_doctors",
    "create_doctor_profile",
    "get_doctor_profile",
    "update_doctor_profile",
    "rating_summary",
    "list_comments",
    "submit_rating",
    "create_comment",
    "get_balance",
    "list_earnings",
    "get_doctor_statistics",
    "list_withdrawals",
    "request_withdrawal",
]
