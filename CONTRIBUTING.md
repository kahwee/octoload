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
   npm install
   # or
   pnpm install
   ```

3. **Run development mode:**
   ```bash
   npm run dev  # Watch mode for development
   # or
   pnpm dev
   ```

## Development Commands

```bash
# Build the project
npm run build

# Run tests
npm test

# Type checking
npm run typecheck

# Format code
npm run fix

# Full verification (before submitting PR)
npm run typecheck && npm run fix && npm test && npm run build
```

## Contribution Guidelines

### Code Style

- **TypeScript strict mode** - No `any` types allowed
- **Prettier formatting** - Use `bun run fix` to format
- **ESLint rules** - Follow existing patterns
- **Test coverage** - Add tests for new functionality

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