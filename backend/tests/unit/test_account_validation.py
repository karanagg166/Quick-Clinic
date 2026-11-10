"""Untrusted avatar URLs and medical text enforce service-layer boundaries."""

import pytest
from fastapi import HTTPException

from app.features.accounts.avatars import sanitize_avatar_url
from app.features.patients.service import validated_medical_fields


@pytest.mark.parametrize(
    "url",
    [
        None,
        42,
        "",
        "http://images.example.test/a.png",
        "javascript:alert(1)",
        "https://localhost/a.png",
        "https://127.0.0.1/a",
        "https://[::1]/a",
        "https://clinic.local/a",
        "https:///image.png",
        "https://[invalid/a",
    ],
)
def test_avatar_url_rejects_unusable_or_local_targets(url):
    assert sanitize_avatar_url(url) is None


def test_avatar_url_preserves_signed_query_after_trimming():
    url = "https://images.example.test/path/a.png?signature=abc&version=1"
    assert sanitize_avatar_url("  " + url + "  ") == url


@pytest.mark.parametrize("value", [None, 123, ["allergy"], "a" * 20001])
def test_medical_fields_reject_nontext_and_excessive_length(value):
    with pytest.raises(HTTPException) as error:
        validated_medical_fields({"allergies": value})
    assert error.value.status_code == 400


def test_medical_fields_allow_empty_and_maximum_text_but_drop_identity_fields():
    result = validated_medical_fields(
        {"medicalHistory": "a" * 20000, "allergies": "", "userId": "attacker", "role": "ADMIN"}
    )
    assert result == {"medicalHistory": "a" * 20000, "allergies": ""}
