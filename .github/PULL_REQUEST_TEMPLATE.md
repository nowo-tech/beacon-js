## Description

Please include a concise summary of the changes and the related issue (if applicable).

Fixes # (issue number)

## Type of Change

- [ ] Bug fix (non-breaking change which fixes an issue)
- [ ] New feature (non-breaking change which adds functionality)
- [ ] Breaking change (fix or feature that would cause existing functionality to not work as expected)
- [ ] Documentation update

## Checklist

- [ ] I have performed a self-review of my code
- [ ] I have added tests (coverage stays at 100% per package)
- [ ] Lint, format, typecheck, unit, e2e, size and pack checks pass locally
- [ ] Public API changes regenerate `packages/*/etc/*.api.md`
- [ ] User-visible changes add a changeset (`pnpm changeset`)
- [ ] New or removed files under `packages/*/src/` update `specs/001-baseline/code-inventory.md`

## Testing

```sh
pnpm lint && pnpm typecheck && pnpm test
pnpm e2e:node && pnpm e2e:browser
```

## Additional Notes

Add any other notes about the PR here.
