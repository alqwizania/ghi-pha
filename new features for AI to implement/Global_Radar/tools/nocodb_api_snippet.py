"""Local NocoDB API snippet placeholder.

Do not commit live API tokens or production URLs here. Use environment variables
or a private scratch file outside the repository for one-off API checks.
"""

import os

import requests


url = os.environ["NOCODB_SNIPPET_URL"]
headers = {"xc-token": os.environ["NOCODB_API_TOKEN"]}

response = requests.get(url, headers=headers, timeout=30)
response.raise_for_status()

print(response.text)
