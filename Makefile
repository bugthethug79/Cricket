BINARY := cricket
OUT_DIR := out

GOOS := $(shell go env GOOS)
GOARCH := $(shell go env GOARCH)

EXT := $(if $(filter windows,$(GOOS)),.exe,)
OUTPUT := $(OUT_DIR)/$(BINARY)-$(GOOS)-$(GOARCH)$(EXT)

.PHONY: all build run test clean

all: build

build:
	@mkdir -p $(OUT_DIR)
	CGO_ENABLED=0 go -C src build -trimpath -ldflags="-s -w" -o ../$(OUTPUT) .

run:
	go -C src run .

test:
	go -C src test ./...

clean:
	rm -rf $(OUT_DIR)
