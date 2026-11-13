
from langchain_core.language_models.chat_models import BaseChatModel

from app.core.config import get_settings


def get_model(provider: str = "google") -> BaseChatModel:
    settings = get_settings()

    if provider == "google":
        from langchain_google_genai import ChatGoogleGenerativeAI

        if not settings.google_api_key:
            raise ValueError("GOOGLE_API_KEY is not configured")

        return ChatGoogleGenerativeAI(
            model="gemini-3.1-flash-lite",
            google_api_key=settings.google_api_key,
            temperature=0,
        )

    if provider == "groq":
        from langchain_groq import ChatGroq

        if not settings.groq_api_key:
            raise ValueError("GROQ_API_KEY is not configured")

        return ChatGroq(
            model="openai/gpt-oss-120b",
            api_key=settings.groq_api_key,
            temperature=0,
        )

    if provider == "cohere":
        from langchain_cohere import ChatCohere

        if not settings.cohere_api_key:
            raise ValueError("COHERE_API_KEY is not configured")

        return ChatCohere(
            model="command-a-03-2025",
            cohere_api_key=settings.cohere_api_key,
            temperature=0,
        )

    raise ValueError(f"Unsupported AI provider: {provider}")
