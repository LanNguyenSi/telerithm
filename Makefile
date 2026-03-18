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

dev:
	@echo "Local npm dev servers: make backend / make frontend"
	@echo "Docker stack: make init"
