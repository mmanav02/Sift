from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    port: int = 8000
    h4h_api_key: str = "h4h-sift"
    h4h_base_url: str = "http://165.245.139.104:443/v1"
    tavily_api_key: str = ""
    agent_interval_minutes: int = 20

    class Config:
        env_file = ".env"


@lru_cache
def get_settings() -> Settings:
    return Settings()
