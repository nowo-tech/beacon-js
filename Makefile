# Developer tasks in Docker (node:22 and the Playwright image), so that no local Node toolchain is needed.
# On a shared machine, run them under the workspace heavy-job lock. Plain `pnpm <script>` works on a host too.
NODE_IMAGE ?= node:22
PW_IMAGE ?= mcr.microsoft.com/playwright:v1.64.1-jammy
UID_GID := $(shell id -u):$(shell id -g)
RUN = docker run --rm --init -u $(UID_GID) -e HOME=/tmp -e COREPACK_HOME=/tmp/corepack -v $(CURDIR):/w -w /w
PNPM = npx -y pnpm@12.16.1

.PHONY: install build test test-browser e2e e2e-node e2e-browser size pack lint golden

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
