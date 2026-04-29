.PHONY: validate build-index check-index test help

help:  ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-20s\033[0m %s\n", $$1, $$2}'

validate:  ## Run all validations (links, frontmatter, orphans)
	node src/cli.js validate

build-index:  ## Rebuild the knowledge index
	node src/cli.js build-index

check-index:  ## Verify committed index is up to date
	node src/cli.js check-index

test:  ## Run JS tests
	node --test src/__tests__/*.test.js
