# Contributing to Octoload

Thank you for your interest in contributing to Octoload! We welcome contributions from the community.

## Development Setup

1. **Clone the repository:**
   ```bash
   git clone https://github.com/kahwee/octoload.git
   cd octoload
   ```

2. **Install dependencies:**
   ```bash
   pnpm install
   ```

3. **Run development mode:**
   ```bash
   pnpm run dev  # Watch mode for development
   ```

## Development Commands

```bash
# Build the project
pnpm run build

# Run tests
pnpm test

# Type checking
pnpm run typecheck

# Lint and formatting checks
pnpm run lint
pnpm run format:check

# Coverage report
pnpm run test:coverage

# Check the README's TypeScript and JSON examples
pnpm run test:docs

# Check built package exports and generated scaffolds (after build)
pnpm run test:package

# Full verification (before submitting PR)
pnpm run typecheck && pnpm run lint && pnpm run format:check && pnpm run test:docs && pnpm run test:coverage && pnpm run build && pnpm run test:package
```

## Contribution Guidelines

### Code Style

- **TypeScript strict mode** - No `any` types allowed
- **Biome formatting** - Use `pnpm run format` to format
- **Biome lint rules** - Follow existing patterns
- **Test coverage** - Add behavior tests for new functionality and regressions. Run `pnpm run test:coverage` to find untested paths.

### Pull Request Process

1. **Fork the repository** and create your feature branch from `main`
2. **Make your changes** following the coding standards
3. **Add tests** for any new functionality
4. **Run the full verification** command above
5. **Update documentation** if needed
6. **Submit a pull request** with a clear description

### Commit Messages

Use clear, descriptive commit messages:

```
feat: add support for Azure Blob Storage
fix: handle multipart upload edge cases
docs: update React Router integration guide
test: add coverage for error scenarios
```

### Areas for Contribution

We welcome contributions in these areas:

1. **Framework Adapters**
   - Express.js integration
   - Hono framework support
   - Fastify integration

2. **Storage Adapters**
   - Azure Blob Storage
   - Google Cloud Storage
   - MinIO compatibility

3. **Documentation**
   - More usage examples
   - Video tutorials
   - Migration guides

4. **Testing**
   - Integration tests
   - Performance benchmarks
   - Edge case coverage

5. **CLI Improvements**
   - Better error messages
   - Progress indicators
   - Interactive prompts

### Reporting Issues

When reporting bugs, please include:

- **Environment details** (OS, Node.js version, etc.)
- **Steps to reproduce** the issue
- **Expected vs actual behavior**
- **Error messages** and stack traces
- **Minimal reproduction** example if possible

### Questions and Discussion

- **GitHub Discussions** for general questions
- **GitHub Issues** for bug reports and feature requests
- **Twitter @kahwee** for quick questions

## Code of Conduct

We are committed to providing a welcoming and inclusive environment for all contributors. Please be respectful and professional in all interactions.

## Recognition

Contributors will be recognized in:
- GitHub contributors list
- Release notes for significant contributions
- Documentation acknowledgments

Thank you for helping make Octoload better!
