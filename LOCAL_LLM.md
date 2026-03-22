# Local LLM Integration

Telerithm's AI Query Engine translates natural language into ClickHouse SQL queries. By default it falls back to a heuristic parser, but you can connect a local LLM for much better results — no cloud API keys needed.

## How It Works

The backend uses the OpenAI SDK, which supports any OpenAI-compatible API. Point it at a local server and the AI Query Engine uses your own model instead of OpenAI's cloud.

## Quick Setup

### 1. Run a Local Model

Any OpenAI-compatible server works. We recommend [llama.cpp](https://github.com/ggerganov/llama.cpp) with a small model:

```bash
# Download a model (Qwen 4B is a good balance of speed and quality)
mkdir -p ~/models && cd ~/models
wget https://huggingface.co/Qwen/Qwen3.5-4B-GGUF/resolve/main/Qwen3.5-4B-Q4_K_M.gguf

# Start the server
llama-server \
  -m ~/models/Qwen3.5-4B-Q4_K_M.gguf \
  --host 0.0.0.0 \
  --port 8000 \
  --ctx-size 16384 \
  --threads 4 \
  --parallel 2
```

Verify it's running:

```bash
curl http://localhost:8000/v1/models
```

### 2. Configure Telerithm

Add these environment variables to your `.env.production`:

```bash
OPENAI_API_KEY=sk-local-dummy
```

And in `docker-compose.traefik.yml`, add to the backend service environment:

```yaml
environment:
  OPENAI_API_KEY: ${OPENAI_API_KEY}
  OPENAI_BASE_URL: http://172.17.0.1:8000/v1  # Docker host IP
```

> **Note:** `172.17.0.1` is the default Docker bridge gateway. The backend container uses this IP to reach the llama-server running on the host. If your Docker bridge uses a different IP, check with `ip route | grep docker0`.

### 3. Restart Backend

```bash
docker compose -f docker-compose.traefik.yml --env-file .env.production up -d --no-deps --build backend
```

Check the logs for confirmation:

```bash
docker compose -f docker-compose.traefik.yml logs --tail=10 backend | grep -i "ai service"
# Expected: "AI Service initialized with OpenAI LLM support"
```

## Recommended Models

| Model | Size | RAM | Quality | Speed |
|-------|------|-----|---------|-------|
| Qwen3.5-4B-Q4_K_M | 2.7GB | ~4GB | Good for SQL generation | Fast |
| Qwen2.5-7B-Q4_K_M | 4.4GB | ~6GB | Better accuracy | Moderate |
| Llama-3.1-8B-Q4_K_M | 4.7GB | ~6GB | Good all-round | Moderate |

For SQL generation, smaller models work well because the output format is constrained (valid SQL only).

## Alternative Servers

Any server exposing an OpenAI-compatible `/v1/chat/completions` endpoint works:

- **[llama.cpp](https://github.com/ggerganov/llama.cpp)** — C++, minimal dependencies (recommended)
- **[Ollama](https://ollama.ai)** — Easy setup, automatic model management
- **[vLLM](https://github.com/vllm-project/vllm)** — High throughput, GPU optimized
- **[LocalAI](https://localai.io)** — Drop-in OpenAI replacement

### Ollama Example

```bash
# Install and run
ollama run qwen2.5:7b

# Configure (Ollama uses port 11434)
OPENAI_BASE_URL: http://172.17.0.1:11434/v1
```

## Verification

Test the AI Query Engine after setup:

```bash
# From inside the backend container
docker compose -f docker-compose.traefik.yml exec backend \
  node -e "
    const OpenAI = require('openai');
    const client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      baseURL: process.env.OPENAI_BASE_URL
    });
    client.chat.completions.create({
      model: 'Qwen3.5-4B-Q4_K_M.gguf',
      messages: [{ role: 'user', content: 'SELECT 1' }],
      max_tokens: 10
    }).then(r => console.log('LLM OK:', r.choices[0].message.content))
      .catch(e => console.error('LLM Error:', e.message));
  "
```

## Fallback Behavior

If the LLM is unreachable or returns an error, the AI Query Engine automatically falls back to heuristic parsing. This means:

- **LLM available** → Natural language queries are translated to precise ClickHouse SQL
- **LLM unavailable** → Basic keyword extraction (level, service name) still works
- **No API key set** → Heuristic mode only, no LLM calls attempted

The system is always functional — the LLM just makes it smarter.
