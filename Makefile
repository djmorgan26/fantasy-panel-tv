# Fantasy Panel for Google TV. Every target runs in Docker.
# Run `make` for the list. TV targets talk to the TV only through the adb container.

COMPOSE := docker compose --profile tools
# Use LOCAL=1 to drive the TV with an adb already installed and paired on this computer.
# The TV's port changes after reboots; find it on the network (scripts/find-tv.sh).
# Override with TV=ip:port. Pairing itself is permanent and never repeated.
TV ?= $(shell sh scripts/find-tv.sh 2>/dev/null)
export TV
ifeq ($(LOCAL),1)
TVCMD := sh scripts/tv.sh
else
TVCMD := $(COMPOSE) run --rm adb
endif

.DEFAULT_GOAL := help
.PHONY: tv-watch tv-find help preview test e2e shots shots-live brand apk hooks check-private \
        tv-pair tv-status tv-install tv-config tv-show tv-hide tv-open tv-shot tv-logs tv-uninstall setup down

help: ## Show this list
	@grep -hE '^[a-z-]+:.*## ' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  \033[1m%-15s\033[0m %s\n", $$1, $$2}'

preview: ## Live preview at http://localhost:8080/preview.html?demo=1 (add ?config=local after make preview ALLOW_LOCAL_CONFIG=1)
	ALLOW_LOCAL_CONFIG=$(ALLOW_LOCAL_CONFIG) docker compose up web

test: ## Unit tests for the scoring and win-probability maths
	$(COMPOSE) run --rm test

e2e: ## Playwright behaviour tests: scores tick, leagues rotate, big plays pop, proxy is locked down
	docker compose up -d --wait --force-recreate web
	$(COMPOSE) run --rm --no-deps e2e

shots: ## Playwright screenshots of the demo at 1920x1080 into docs/screenshots
	docker compose up -d --wait --force-recreate web
	$(COMPOSE) run --rm --no-deps shots

shots-live: ## Screenshots with YOUR leagues into .private/shots (never committed)
	ALLOW_LOCAL_CONFIG=1 docker compose up -d --wait --force-recreate web
	SHOOT_LIVE=1 $(COMPOSE) run --rm --no-deps shots; s=$$?; docker compose up -d --force-recreate web >/dev/null 2>&1; exit $$s

brand: ## Re-render the TV banner and icon from tools/brand/brand.html
	docker compose up -d --wait --force-recreate web
	BRAND=1 $(COMPOSE) run --rm --no-deps shots

apk: ## Build the Android TV app into dist/fantasy-panel.apk
	@mkdir -p .keystore
	$(COMPOSE) run --rm apk

hooks: ## Install the git hook that blocks personal data from commits
	@printf '#!/bin/sh\nexec sh scripts/check-private.sh\n' > .git/hooks/pre-commit && chmod +x .git/hooks/pre-commit
	@echo "pre-commit privacy check installed"

check-private: ## Scan every tracked file for values from config.local.json
	@sh scripts/check-private.sh --all

tv-pair: ## One time only: pair with the TV. make tv-pair PAIR=ip:port CODE=123456
	@mkdir -p .adb
	$(TVCMD) pair $(PAIR) $(CODE)

tv-find: ## Show the TV address found on the network
	@echo $(TV)

tv-status: ## What is on the TV: model, app installed, permission, panel state
	@$(TVCMD) status

tv-install: apk ## Build, install, grant the overlay permission, send your settings
	@$(TVCMD) install
	@$(TVCMD) config

tv-config: ## Re-send config.local.json to the TV
	@$(TVCMD) config

tv-show: ## Show the panel (MODE=mini for the score card)
	@MODE=$(MODE) $(TVCMD) show

tv-hide: ## Hide the panel
	@$(TVCMD) hide

tv-open: ## Toggle exactly like "Hey Google, open Fantasy Football" (MODE=mini: "Fantasy Scores")
	@MODE=$(MODE) $(TVCMD) open

tv-shot: ## Screenshot the TV into .private/shots
	@$(TVCMD) shot

tv-logs: ## Recent panel logs from the TV
	@$(TVCMD) logs

tv-watch: ## Stream panel events live while you try the voice commands
	@$(TVCMD) watch

tv-uninstall: ## Remove the app and everything it stored. Nothing else on the TV changes.
	@$(TVCMD) uninstall

setup: hooks ## First run: copy the example config and install the privacy hook
	@[ -f config.local.json ] || cp config.example.json config.local.json
	@echo "Edit config.local.json, then: make tv-pair PAIR=... CODE=... && make tv-install"

down: ## Stop the preview server
	docker compose down
