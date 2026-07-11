# Contributing

Thanks for helping improve Screen Spec MD.

## Before opening a pull request

1. Fork the repository and create a focused branch from `main`.
2. Keep changes small and update the README when behavior or setup changes.
3. Run the checks below using Node 22–24:

   ```sh
   npm ci
   npm run build
   npx --yes tsx scripts/selftest.ts
   ```

4. Describe the user-visible change and any Figma setup needed to verify it.

## Issues

Use the issue templates for reproducible bugs and well-scoped feature ideas. For security
issues, follow [SECURITY.md](SECURITY.md) instead of opening a public issue.
