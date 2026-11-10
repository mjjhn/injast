GO ?= go

.PHONY: help install run api ui build unit integration test race coverage fuzz benchmark e2e checker checker-live restart lint typecheck verify verify-inputs clean-check performance startup
help:
	@echo 'install | api (run) | ui | build | unit | integration | test | race | coverage | fuzz | benchmark | e2e | checker | restart | verify'
install:
	cd backend && $(GO) mod download
	cd frontend && npm ci
run: api
api:
	cd backend && $(GO) run -buildvcs=false ./cmd/api
ui:
	cd frontend && npm run dev
build:
	cd backend && $(GO) build -buildvcs=false -o bin/api ./cmd/api
	cd frontend && npm run build
unit:
	cd backend && $(GO) test ./internal/domain ./internal/application
	cd frontend && npm test
integration:
	cd backend && $(GO) test ./internal/infrastructure/... ./internal/interfaces/... ./internal/bootstrap ./internal/platform/...
test: unit integration
race:
	cd backend && $(GO) test -race ./...
coverage:
	mkdir -p artifacts/evidence
	cd backend && $(GO) test -coverprofile=../artifacts/evidence/gin-coverage.out ./...
	cd backend && $(GO) tool cover -func=../artifacts/evidence/gin-coverage.out
fuzz:
	cd backend && $(GO) test ./internal/domain -run='^$$' -fuzz=FuzzDepositConservesMoney -fuzztime=5s -parallel=2
	cd backend && $(GO) test ./internal/interfaces/httpapi -run='^$$' -fuzz=FuzzStrictJSON -fuzztime=5s -parallel=2
benchmark:
	cd backend && $(GO) test ./internal/infrastructure/sqlite -run='^$$' -bench=BenchmarkSQLite -benchmem -benchtime=300ms
lint:
	cd backend && $(GO) vet ./...
	cd frontend && npm run lint
typecheck:
	cd frontend && npm run typecheck
e2e:
	cd backend && $(GO) build -buildvcs=false -o bin/api ./cmd/api
	python3 scripts/run_isolated.py e2e
checker:
	cd backend && $(GO) build -buildvcs=false -o bin/api ./cmd/api
	python3 scripts/run_isolated.py checker
checker-live:
	python3 check_api.py
restart:
	python3 scripts/check_restart.py
verify-inputs:
	python3 scripts/verify_inputs.py
verify: verify-inputs test race lint typecheck build coverage fuzz restart startup checker e2e

clean-check:
	GO=$(GO) python3 scripts/check_clean.py
performance:
	python3 scripts/check_performance.py

startup:
	cd backend && $(GO) build -buildvcs=false -o bin/api ./cmd/api
	python3 scripts/check_startup.py
