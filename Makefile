# Developer tasks in Docker (node:22 and the Playwright image), so that no local Node toolchain is needed.
# On a shared machine, run them under the workspace heavy-job lock. Plain `pnpm <script>` works on a host too.
NODE_IMAGE ?= node:22
PW_IMAGE ?= mcr.microsoft.com/playwright:v1.64.1-jammy
UID_GID := $(shell id -u):$(shell id -g)
RUN = docker run --rm --init -u $(UID_GID) -e HOME=/tmp -e COREPACK_HOME=/tmp/corepack -v $(CURDIR):/w -w /w
PNPM = npx -y pnpm@12.16.1

.PHONY: install build test test-browser e2e e2e-node e2e-browser size pack lint golden \
	ensure-up release-check ts-coverage-percent setup-hooks check-no-cursor-coauthor check-open-prs \
	strip-cursor-coauthor-from-history

install:
	$(RUN) $(NODE_IMAGE) sh -c '$(PNPM) install'
build:
	$(RUN) $(NODE_IMAGE) sh -c '$(PNPM) build'
test:
	$(RUN) $(NODE_IMAGE) sh -c '$(PNPM) --filter "./packages/*" --filter "!@nowo-tech/beacon-browser" test && $(PNPM) test:mock'
test-browser:
	$(RUN) $(PW_IMAGE) sh -c '$(PNPM) --filter @nowo-tech/beacon-browser test'
e2e: e2e-node e2e-browser
e2e-node: build
	$(RUN) $(NODE_IMAGE) sh -c '$(PNPM) e2e:node'
e2e-browser: build
	$(RUN) $(PW_IMAGE) sh -c '$(PNPM) e2e:browser'
size: build
	$(RUN) $(NODE_IMAGE) sh -c '$(PNPM) size'
pack: build
	$(RUN) $(NODE_IMAGE) sh -c '$(PNPM) pack:check'
lint:
	$(RUN) $(NODE_IMAGE) sh -c '$(PNPM) lint && $(PNPM) format:check'
golden: build
	$(RUN) $(NODE_IMAGE) sh -c '$(PNPM) golden'

# Tasks run in throw-away `docker run` containers, so there is no long-lived stack to start: ensure-up only checks
# that Docker answers (REQ-MAKE-001).
ensure-up:
	@docker info >/dev/null 2>&1 || { echo "Docker is not available" >&2; exit 1; }

# REQ-TEST-009: one global TS coverage percentage from the last `make test` / `make test-browser` run.
ts-coverage-percent:
	@sh .scripts/ts-coverage-percent.sh

# REQ-MAKE-002: pre-release chain (the same gates as CI, plus the git hygiene checks). Never tags or publishes.
release-check:
	@$(MAKE) ensure-up
	@$(MAKE) check-no-cursor-coauthor
	@$(MAKE) check-open-prs
	@$(MAKE) install
	@$(MAKE) lint
	@$(MAKE) golden
	@git diff --exit-code -- fixtures/envelopes/golden 'packages/*/etc/*.api.md'
	@$(MAKE) test
	@$(MAKE) test-browser
	@$(MAKE) ts-coverage-percent
	@$(MAKE) e2e
	@$(MAKE) size
	@$(MAKE) pack

# REQ-MAKE-006 / REQ-GIT-001: versioned git hooks (commit-msg strips AI co-author trailers).
setup-hooks:
	@chmod +x .githooks/commit-msg
	@git config core.hooksPath .githooks
	@echo "Git hooks installed (.githooks)."

# REQ-GIT-001
check-no-cursor-coauthor:
	@sh .scripts/check-no-cursor-coauthor.sh HEAD

# REQ-REL-003
check-open-prs:
	@bash .scripts/check-open-prs.sh

strip-cursor-coauthor-from-history:
	@sh .scripts/strip-cursor-coauthor-from-history.sh main
