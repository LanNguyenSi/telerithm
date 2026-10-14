COMPOSE=docker compose

.PHONY: setup backend frontend build up down logs init dev deploy deploy-backend deploy-frontend prod-logs

# One-time setup for running backend and frontend outside Docker: starts the
# datastores (this also creates the ClickHouse tables from
# backend/clickhouse/init.sql), copies the example env files when missing,
# installs dependencies and applies the Postgres schema. See CONTRIBUTING.md.
setup:
	$(COMPOSE) up -d --wait postgres clickhouse redis
	test -f backend/.env || cp backend/.env.example backend/.env
	test -f frontend/.env.local || cp frontend/.env.local.example frontend/.env.local
	cd backend && npm install && npm run db:push
	cd frontend && npm install
	@echo "Set REGISTRATION_MODE=open (or ADMIN_EMAIL to your address) in backend/.env before you sign up."
	@echo "Then run make backend and make frontend in two shells."

backend:
	@test -f backend/.env || echo "backend/.env is missing: run 'make setup' once first (datastores, .env files, schema)."
	cd backend && npm run dev

frontend:
	@test -f frontend/.env.local || echo "frontend/.env.local is missing: run 'make setup' once first (datastores, .env files, schema)."
	cd frontend && npm run dev

build:
	$(COMPOSE) build

up:
	$(COMPOSE) up -d

down:
	$(COMPOSE) down

logs:
	$(COMPOSE) logs --tail=200 -f

init:
	$(COMPOSE) build
	$(COMPOSE) up -d
	@echo "Telerithm is starting at http://localhost:3000"
	@echo "API docs at http://localhost:4000/docs"

dev:
	@echo "Local npm dev servers: make setup once, then make backend / make frontend"
	@echo "Docker stack: make init"

# ── Production Deploy (Stone's VPS) ──────────────────────────────────────────
PROD_COMPOSE=docker-compose.traefik.yml
PROD_ENV=.env.production

deploy:
	git stash || true
	git pull origin master
	docker compose -f $(PROD_COMPOSE) --env-file $(PROD_ENV) build --no-cache
	docker compose -f $(PROD_COMPOSE) --env-file $(PROD_ENV) up -d --force-recreate
	@echo "✅ Deployed. Check https://demo.telerithm.cloud"

deploy-backend:
	git stash || true
	git pull origin master
	docker compose -f $(PROD_COMPOSE) --env-file $(PROD_ENV) build --no-cache backend
	docker compose -f $(PROD_COMPOSE) --env-file $(PROD_ENV) up -d --no-deps --force-recreate backend
	@echo "✅ Backend deployed"

deploy-frontend:
	git stash || true
	git pull origin master
	docker compose -f $(PROD_COMPOSE) --env-file $(PROD_ENV) build --no-cache frontend
	docker compose -f $(PROD_COMPOSE) --env-file $(PROD_ENV) up -d --no-deps --force-recreate frontend
	@echo "✅ Frontend deployed"

prod-logs:
	docker compose -f $(PROD_COMPOSE) --env-file $(PROD_ENV) logs --tail=200 -f
