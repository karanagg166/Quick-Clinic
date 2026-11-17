"""Provider fallback model builder supporting tool binding and API error recovery."""

from collections.abc import Sequence
from typing import Any

import httpx
from langchain_core.runnables import Runnable

from .providers import get_model


def _fallback_exceptions() -> tuple[type[BaseException], ...]:
    """Collect transient, network, rate-limit, and quota exceptions across providers."""
    excs: list[type[BaseException]] = [
        TimeoutError,
        ConnectionError,
        httpx.TimeoutException,
        httpx.NetworkError,
        httpx.HTTPStatusError,
    ]
    for module_path, attr_names in (
        ("google.genai.errors", ("APIError", "ClientError", "ServerError")),
        ("langchain_google_genai.chat_models", ("ChatGoogleGenerativeAIError",)),
        ("groq", ("APIError", "RateLimitError", "APIConnectionError", "InternalServerError", "APIStatusError")),
        ("cohere.core.api_error", ("ApiError",)),
    ):
        try:
            mod = __import__(module_path, fromlist=list(attr_names))
            for attr in attr_names:
                cls = getattr(mod, attr, None)
                if isinstance(cls, type) and issubclass(cls, BaseException):
                    excs.append(cls)
        except Exception:
            pass
    return tuple(dict.fromkeys(excs))


class BindableFallbackChatModel:
    """Wrap ordered chat models so `.bind_tools(...)` binds each provider before `.with_fallbacks(...)`."""

    def __init__(self, models: Sequence[Any], provider_names: Sequence[str] = ()) -> None:
        if not models:
            raise ValueError("At least one approved AI provider is required")
        self._models = list(models)
        self._provider_names = list(provider_names)
        self.model = getattr(self._models[0], "model", self._provider_names[0] if self._provider_names else "fallback")
        self._exceptions = _fallback_exceptions()

    def _as_runnable(self, models: Sequence[Any]) -> Runnable:
        if len(models) == 1:
            return models[0]
        return models[0].with_fallbacks(
            list(models[1:]),
            exceptions_to_handle=self._exceptions,
        )

    def bind_tools(self, tools: Sequence[Any], **kwargs: Any) -> Runnable:
        bound = [m.bind_tools(tools, **kwargs) for m in self._models]
        return self._as_runnable(bound)

    async def ainvoke(self, input_val: Any, config: Any = None, **kwargs: Any) -> Any:
        return await self._as_runnable(self._models).ainvoke(input_val, config=config, **kwargs)

    def invoke(self, input_val: Any, config: Any = None, **kwargs: Any) -> Any:
        return self._as_runnable(self._models).invoke(input_val, config=config, **kwargs)


def get_fallback_model(
    allowed_providers: Sequence[str],
    *,
    model_factory=get_model,
) -> Any:
    """Build a bindable primary+fallback chat model from configured providers."""
    if not allowed_providers:
        raise ValueError("At least one approved AI provider is required")

    providers = list(dict.fromkeys(allowed_providers))
    models: list[Any] = []
    loaded_names: list[str] = []
    seen_ids: set[int] = set()
    last_err: Exception | None = None

    for provider in providers:
        try:
            m = model_factory(provider)
            if id(m) not in seen_ids:
                seen_ids.add(id(m))
                models.append(m)
                loaded_names.append(provider)
        except ValueError as exc:
            last_err = exc
            continue

    if not models:
        if last_err is not None:
            raise last_err
        raise ValueError("No approved AI providers are configured")

    if len(models) == 1:
        return models[0]
    return BindableFallbackChatModel(models, loaded_names)
