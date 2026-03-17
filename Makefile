SHELL := /bin/bash

.PHONY: help whoami workset-version pack-workset publish-workset publish-workset-dry-run alpha-version pack-alpha publish-alpha publish-alpha-dry-run release-version publish-release publish-release-dry-run

help:
	@printf "Local publish targets for %s\n" "$$(node -p "require('./package.json').name")"
	@printf "  make whoami\n"
	@printf "  make workset-version\n"
	@printf "  make pack-workset\n"
	@printf "  make publish-workset\n"
	@printf "  make publish-workset-dry-run\n"
	@printf "  make publish-alpha              # alias for publish-workset\n"
	@printf "  make publish-alpha-dry-run      # alias for publish-workset-dry-run\n"
	@printf "  make publish-release VERSION=0.3.1\n"
	@printf "  make publish-release-dry-run VERSION=0.3.1\n"

whoami:
	npm whoami

workset-version:
	npm version prerelease --preid workset --no-git-tag-version

pack-workset: workset-version
	bun run build
	npm pack

publish-workset: workset-version
	npm whoami >/dev/null
	bun run build
	npm publish --tag workset --access public

publish-workset-dry-run: workset-version
	npm whoami >/dev/null
	bun run build
	npm publish --tag workset --access public --dry-run

alpha-version: workset-version

pack-alpha: pack-workset

publish-alpha: publish-workset

publish-alpha-dry-run: publish-workset-dry-run

release-version:
	@test -n "$(VERSION)" || (echo "VERSION is required, e.g. make publish-release VERSION=0.3.1" && exit 1)
	npm version "$(VERSION)" --no-git-tag-version

publish-release: release-version
	npm whoami >/dev/null
	bun run build
	npm publish --tag latest --access public

publish-release-dry-run: release-version
	npm whoami >/dev/null
	bun run build
	npm publish --tag latest --access public --dry-run
