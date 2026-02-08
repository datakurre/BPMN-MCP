.PHONY: help install build typecheck lint check watch start clean prepare test test-watch coverage all

# Default target
help:
	@echo "Available targets:"
	@echo "  make install    - Install dependencies (npm install)"
	@echo "  make build      - Bundle with esbuild → dist/index.js"
	@echo "  make typecheck  - Type-check with tsc (no emit)"
	@echo "  make lint       - Lint with ESLint"
	@echo "  make check      - Run typecheck + lint"
	@echo "  make watch      - Rebuild on file changes"
	@echo "  make start      - Start the MCP server (node dist/index.js)"
	@echo "  make prepare    - Run prepare script (npm run build)"
	@echo "  make test       - Run tests (vitest)"
	@echo "  make test-watch - Run tests in watch mode"
	@echo "  make coverage   - Run tests with coverage report"
	@echo "  make clean      - Remove dist/ and node_modules/"
	@echo "  make all        - Install and build"

# Install dependencies
install:
	npm install

# Bundle the project
build:
	npm run build

# Type-check (no emit)
typecheck:
	npm run typecheck

# Lint with ESLint
lint:
	npm run lint

# Run all static checks (typecheck + lint)
check: typecheck lint

# Watch mode for development
watch:
	npm run watch

# Start the server
start:
	npm start

# Prepare (triggered by npm on install)
prepare:
	npm run prepare

# Run tests
test:
	npm test

# Run tests in watch mode
test-watch:
	npm run test:watch

# Run tests with coverage
coverage:
	npm run coverage

# Clean build artifacts
clean:
	rm -rf dist/
	rm -rf node_modules/

# Install and build
all: install build
