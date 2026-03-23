COMPOSE=docker compose

backend:
	cd backend && npm run dev

frontend:
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
	@echo "Local npm dev servers: make backend / make frontend"
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
