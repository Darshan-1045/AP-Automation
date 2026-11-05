import os

from dotenv import load_dotenv
from groq import Groq
from django.conf import settings


load_dotenv(settings.BASE_DIR / ".env")

api_key = os.getenv("GROQ_API_KEY")

client = Groq(api_key=api_key) if api_key else None