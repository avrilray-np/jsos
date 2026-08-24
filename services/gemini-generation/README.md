# JSOS Gemini generation service

Private backend adapter for Gemini on Vertex AI. It accepts only JSOS generation operations and uses the Cloud Run service account through Application Default Credentials; it never stores a Google API key.

Required environment variables:

- `GOOGLE_CLOUD_PROJECT`
- `GOOGLE_CLOUD_LOCATION` (defaults to `global`)
- `GEMINI_MODEL` (defaults to `gemini-2.5-flash`)
- `JSOS_SERVICE_TOKEN` (a random secret shared only with the JSOS server)

Endpoints:

- `GET /healthz`
- `POST /v1/generate` with `X-JSOS-Service-Token`
