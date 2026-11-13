
from collections.abc import Sequence

import httpx

from langchain_core.runnables import Runnable

from .providers import get_model


def get_fallback_model(
    allowed_providers: Sequence[str],
) -> Runnable:

    if not allowed_providers:
        raise ValueError("At least one approved AI provider is required")

    providers = list(dict.fromkeys(allowed_providers))

    models = [get_model(provider) for provider in providers]

    primary_model = models[0]
    fallback_models = models[1:]

    return primary_model.with_fallbacks(
        fallback_models,
        exceptions_to_handle=(
            TimeoutError,
            ConnectionError,
            httpx.TimeoutException,
            httpx.NetworkError,
        ),
    )
